// scripts/fulltext-enrichment/phase2f-sweep.js
//
// Usage:
//   node phase2f-sweep.js [pass0_start_pmid]
//
// Environment switches:
//   PASS1_START_PMID    BigInt — pass 1 cursor (used by supervisor for sharding)
//   PASS1_END_PMID      BigInt — pass 1 hard upper bound (clean exit on cross)
//   SKIP_PASS0=1        skip pass 0 (PMCID batch via NCBI)
//   SKIP_PASS1=1        skip pass 1 (no-PMCID, CORE-only)
//   SKIP_PASS2=1        skip pass 2 (others) — also implied by SKIP_OTHERS_PASS=1 (legacy)
//   REDIS_URL           if set, all upstream API rate limiters share buckets
//                       across processes via Redis (prevents 5-shard × 10 RPS
//                       compounding into upstream 429 cascade)
import 'dotenv/config';
import { mkdir, writeFile, unlink, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
});
async function withPg(fn) {
  const client = await _pool.connect();
  try { return await fn(client); } finally { client.release(); }
}
import { downloadPdf } from './lib/proxy-http.js';
import { processPdf } from './lib/grobid-client.js';
import { parseTeiFullText } from './lib/tei-parser.js';
import { buildBodyChunks } from './lib/fulltext-chunker.js';
import { fetchForPmcid, fetchBatchForPmcids } from './lib/fetch-pmcid-jats.js';
import { fetchForDoi as fetchCore } from './lib/fetch-core-doi.js';
import { fetchForDoi as fetchS2 } from './lib/fetch-s2-pdf.js';
import { fetchForDoi as fetchOpenAlex } from './lib/fetch-openalex-oa.js';
import { fetchForDoi as fetchCrossRef } from './lib/fetch-crossref-links.js';
import { fetchForDoi as fetchIA } from './lib/fetch-ia-scholar.js';
import { fetchForDoi as fetchSpringer } from './lib/fetch-springer-oa.js';
import { fetchForDoi as fetchWiley } from './lib/fetch-wiley-tdm.js';
import { fetchForDoi as fetchEuropePmc } from './lib/fetch-europepmc.js';
import { fetchForDoi as fetchUnpaywall } from './lib/fetch-unpaywall.js';
import { getRateLimiter } from './lib/rate-limiter-redis.js';
import { checkQuality } from './lib/quality-gate.js';

// Unpaywall — Redis-shared bucket so inline prefilter and lib fetch don't
// double-count against the 10 RPS budget across processes.
const unpaywallLimiter = getRateLimiter('unpaywall', { rps: 10 });

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CHUNKS_FILE = join(DATA_DIR, 'chunks-phase2f.jsonl');
const METRICS_FILE = join(DATA_DIR, 'phase2f-strategy-metrics.jsonl');
const BATCH_SIZE = 500;
// CONCURRENCY = 10 (was 20) — Grobid is the bottleneck. With 16 cores and
// PDFs averaging 5-15s of CPU, sustainable Grobid throughput is ~3 PDFs/s.
// CONCURRENCY 20 was queueing 8-15 PDFs simultaneously, thrashing Grobid
// and increasing per-row latency. 10 keeps the in-flight set under Grobid's
// capacity and reduces wall time.
const CONCURRENCY = 10;
const PMCID_BATCH_SIZE = 20; // articles per NCBI efetch call in pass 0
const MIN_TEXT_LEN = 1000;
const UNPAYWALL_BASE = 'https://api.unpaywall.org/v2';

const STRATEGIES = [
  { name: 'pmcid',    fn: fetchForPmcid, needsPdf: false },
  { name: 'core',     fn: fetchCore,     needsPdf: false },
  { name: 'springer', fn: fetchSpringer, needsPdf: false },
  { name: 'wiley',    fn: fetchWiley,    needsPdf: true  },
  { name: 's2',       fn: fetchS2,       needsPdf: true  },
  { name: 'openalex', fn: fetchOpenAlex, needsPdf: true  },
  { name: 'crossref', fn: fetchCrossRef, needsPdf: true  },
  { name: 'ia',       fn: fetchIA,       needsPdf: true  },
  { name: 'europepmc',fn: fetchEuropePmc, needsPdf: false },
  { name: 'unpaywall',fn: fetchUnpaywall, needsPdf: true  },
];

// Pass 1 (no PMCID): keeping core (text-direct), s2 (arXiv preprints), and
// openalex (mixed). Dropped crossref — observed real-recovery rate of ~2%
// against significant PDF download + Grobid time on publisher-gated URLs
// that mostly return anti-bot HTML. Net: ~8% loss of recoveries for ~25%
// throughput gain.
const STRATEGIES_PASS1 = [
  { name: 'core',     fn: fetchCore,     needsPdf: false },
  { name: 's2',       fn: fetchS2,       needsPdf: true  },
  { name: 'openalex', fn: fetchOpenAlex, needsPdf: true  },
];

// Per-strategy outcome counters for periodic stderr summary.
const metrics = new Map(); // strategyName -> { hits, misses, transient, errors }
function bumpMetric(name, kind) {
  let m = metrics.get(name);
  if (!m) { m = { hits: 0, misses: 0, transient: 0, errors: 0 }; metrics.set(name, m); }
  m[kind]++;
}

async function emitMetric(rec) {
  try { await appendFile(METRICS_FILE, JSON.stringify(rec) + '\n'); } catch {}
}

function logSummary() {
  const lines = [];
  for (const [name, m] of metrics) {
    const total = m.hits + m.misses + m.transient + m.errors;
    if (!total) continue;
    const hitRate = ((m.hits / total) * 100).toFixed(1);
    lines.push(`  ${name.padEnd(10)} hits=${m.hits} miss=${m.misses} transient=${m.transient} errors=${m.errors} hitRate=${hitRate}%`);
  }
  if (lines.length) console.log('[phase2f] strategy metrics:\n' + lines.join('\n'));
}

async function pdfToChunks(buffer, { pmid, source }) {
  // Reject non-PDF buffers before they hit Grobid. Many "pdfUrls" from
  // openalex/crossref turn out to be anti-bot HTML landing pages disguised
  // with .pdf extensions; Grobid takes 5-10s to fail on those (BAD_INPUT_DATA).
  if (!buffer || buffer.length < 4 || !buffer.slice(0, 4).toString().startsWith('%PDF')) {
    return null;
  }
  const tmpPath = join(tmpdir(), `phase2f-${randomBytes(8).toString('hex')}.pdf`);
  try {
    await writeFile(tmpPath, buffer);
    const tei = await processPdf(tmpPath, { fs });
    const parsed = parseTeiFullText(tei);
    if (!parsed || parsed.text.length < MIN_TEXT_LEN) return null;
    const chunks = buildBodyChunks({ pmid, sections: parsed.sections, provenance: source });
    return { text: parsed.text, sections: parsed.sections, chunks };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

// Build OA prefilter using cached OpenAlex metadata first, Unpaywall fallback.
// Rows with stored is_oa avoid an API call entirely (~30% of corpus).
// Unpaywall results are persisted back to source_metadata so subsequent runs
// short-circuit without paying the API call again.
// Returns Map<pmid (BigInt), { isOa: bool, pdfUrl: string|null }>.
async function bulkUnpaywallPrefilter(rows) {
  const email = process.env.UNPAYWALL_EMAIL;
  const out = new Map();
  const fallback = [];

  for (const row of rows) {
    if (row.is_oa === 'false') {
      out.set(row.pmid, { isOa: false, pdfUrl: null });
    } else if (row.is_oa === 'true') {
      out.set(row.pmid, { isOa: true, pdfUrl: row.oa_url || null });
    } else {
      fallback.push(row);
    }
  }

  if (!email || !fallback.length) return out;

  const entries = await Promise.all(fallback.map(async (row) => {
    if (!row.doi) return [row.pmid, null, null];
    await unpaywallLimiter.take();
    try {
      const resp = await fetch(
        `${UNPAYWALL_BASE}/${encodeURIComponent(row.doi)}?email=${encodeURIComponent(email)}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
      );
      if (!resp.ok) return [row.pmid, null, null];
      const data = await resp.json();
      const pdfLoc = (data?.oa_locations ?? []).find(l => l.url_for_pdf);
      const result = { isOa: !!data?.is_oa, pdfUrl: pdfLoc?.url_for_pdf ?? null };
      return [row.pmid, result, { is_oa: result.isOa, oa_url: result.pdfUrl }];
    } catch { return [row.pmid, null, null]; }
  }));

  // Persist what we learned so subsequent runs skip the API call.
  const toPersist = entries.filter(e => e[2] !== null);
  if (toPersist.length) {
    await withPg(async (pgClient) => {
      for (const [pmid, _result, persist] of toPersist) {
        await pgClient.query(
          `UPDATE research_articles
              SET source_metadata = COALESCE(source_metadata, '{}'::jsonb) || $2::jsonb
            WHERE pmid = $1`,
          [pmid, JSON.stringify({ is_oa: persist.is_oa ? 'true' : 'false', oa_url: persist.oa_url })]
        );
      }
    });
  }

  for (const [pmid, val] of entries) out.set(pmid, val);
  return out;
}

// Run all strategies for a row in parallel. Tracks per-strategy outcomes
// (hit / miss / transient / error) for metrics + transient-aware writeResult.
//
// Returns one of:
//   { fullText, chunks, source, via }              — success
//   { transient: true, transients: [strategyName] } — every strategy missed
//                                                    AND >=1 was transient
//                                                    (don't mark exhausted)
//   null                                            — definitive miss
async function processRow(row, prefilter, strategies = STRATEGIES) {
  if (prefilter) {
    const pre = prefilter.get(row.pmid);
    if (pre && !pre.isOa && !pre.pdfUrl) {
      bumpMetric('prefilter', 'misses');
      return null;
    }
  }

  const transients = [];
  const settled = await Promise.all(strategies.map(async ({ name, fn, needsPdf }) => {
    const t0 = Date.now();
    try {
      const result = await fn(row.doi, row);
      const ms = Date.now() - t0;
      if (result) {
        bumpMetric(name, 'hits');
        emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'hit', ms });
        return { result, needsPdf, name };
      }
      bumpMetric(name, 'misses');
      emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'miss', ms });
      return null;
    } catch (err) {
      const ms = Date.now() - t0;
      if (err && err.transient) {
        transients.push(name);
        bumpMetric(name, 'transient');
        emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'transient', status: err.status || null, ms });
      } else {
        bumpMetric(name, 'errors');
        emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'error', error: err?.message?.slice(0, 200) || 'unknown', ms });
      }
      return null;
    }
  }));

  // Prefer text-direct hits (no PDF download / Grobid needed)
  for (const item of settled) {
    if (!item || item.needsPdf) continue;
    const { result, name } = item;
    if (!result.text || result.text.length < MIN_TEXT_LEN) continue;
    const sections = result.sections ?? [{ title: null, type: 'body_other', text: result.text }];
    const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: result.source });
    return { fullText: result.text, sections, chunks, source: result.source, via: 'direct', strategy: name };
  }

  // Fallback: PDF strategies (sequential because Grobid + downloads are heavy)
  for (const item of settled) {
    if (!item || !item.needsPdf) continue;
    const { result, name } = item;
    let download;
    if (result.pdfBuffer) {
      download = { buffer: result.pdfBuffer, via: 'direct' };
    } else if (result.pdfUrl) {
      try {
        download = await downloadPdf(result.pdfUrl, { doi: row.doi });
      } catch (err) {
        if (err.code === 'PROXY_BLOCKED') {
          // Defer the UPDATE to the caller (lazy pg) — return a sentinel.
          return { proxyBlocked: true };
        }
        continue;
      }
    } else continue;

    const grobid = await pdfToChunks(download.buffer, {
      pmid: row.pmid,
      source: result.source,
    }).catch(() => null);
    if (!grobid) continue;
    return { fullText: grobid.text, sections: grobid.sections, chunks: grobid.chunks, source: result.source, via: download.via, strategy: name };
  }

  if (transients.length) return { transient: true, transients };
  return null;
}

// Apply quality gate to a successful result; returns null+reason if rejected.
function gateResult(result) {
  const sections = result.sections ?? [{ title: null, type: 'body_other', text: result.fullText }];
  const q = checkQuality({ text: result.fullText, sections });
  return q.ok ? null : q.reason;
}

async function writeResult(row, result, pgClient, chunkLines) {
  // Sentinel: proxy-blocked PDF path
  if (result && result.proxyBlocked) {
    await pgClient.query(
      `UPDATE research_articles SET content_source = 'phase2f_proxy_blocked' WHERE pmid = $1`,
      [row.pmid]
    );
    console.log(`[phase2f] PROXY_BLOCKED pmid=${row.pmid}`);
    return false;
  }
  // Sentinel: all strategies missed but some were transient — don't burn signal
  if (result && result.transient) {
    console.log(`[phase2f] TRANSIENT pmid=${row.pmid} retry-eligible=${result.transients.join(',')}`);
    return false;
  }
  if (result) {
    const reject = gateResult(result);
    if (reject) {
      await pgClient.query(
        `UPDATE research_articles
            SET content_source = 'phase2f_quality_reject',
                fulltext_reject_reason = $2
          WHERE pmid = $1`,
        [row.pmid, reject]
      );
      console.log(`[phase2f] QUALITY_REJECT pmid=${row.pmid} reason=${reject} source=${result.source}`);
      return false;
    }
    const safeText = Buffer.from(result.fullText, 'utf8').toString('utf8').replace(/�/g, '').replace(/\0/g, '');
    await pgClient.query(
      `UPDATE research_articles SET full_text = $1, has_full_text = true, content_source = $2 WHERE pmid = $3`,
      [safeText, result.source, row.pmid]
    );
    for (const c of result.chunks) chunkLines.push(JSON.stringify(c));
    console.log(`[phase2f] OK pmid=${row.pmid} source=${result.source} via=${result.via} chunks=${result.chunks.length}`);
    return true;
  } else {
    const { rows: [cur] } = await pgClient.query(
      `SELECT content_source FROM research_articles WHERE pmid = $1`, [row.pmid]
    );
    if (!cur?.content_source?.startsWith('phase2f_')) {
      await pgClient.query(
        `UPDATE research_articles SET content_source = 'phase2f_exhausted' WHERE pmid = $1`,
        [row.pmid]
      );
    }
    console.log(`[phase2f] EXHAUSTED pmid=${row.pmid}`);
    return false;
  }
}

// Pass 0: batch NCBI efetch — 20 articles per HTTP call instead of 1.
// Rows not found in batch response are marked exhausted (PMCID strategy is
// the strongest signal; other sources rarely recover these misses).
async function runBatchPmcidPass(pg, sql, label, startPmid, totalProcessed, totalSucceeded) {
  let lastPmid = startPmid;
  console.log(`[phase2f] === pass: ${label} (batch mode, size=${PMCID_BATCH_SIZE}) start=${startPmid} ===`);

  while (true) {
    const { rows } = await pg.query(sql, [lastPmid, BATCH_SIZE]);
    if (!rows.length) break;

    for (let i = 0; i < rows.length; i += PMCID_BATCH_SIZE) {
      const batch = rows.slice(i, i + PMCID_BATCH_SIZE);

      // One NCBI call for the entire sub-batch
      let batchMap;
      let batchTransient = false;
      try {
        batchMap = await fetchBatchForPmcids(batch);
      } catch (err) {
        if (err && err.transient) {
          batchTransient = true;
          batchMap = new Map();
        } else {
          batchMap = new Map();
        }
      }

      const chunkLines = [];
      await withPg(async (pgClient) => {
        for (const row of batch) {
          lastPmid = row.pmid;
          totalProcessed++;

          const hit = batchMap.get(row.pmid);
          let rowResult = null;
          if (hit) {
            const sections = hit.sections ?? [{ title: null, type: 'body_other', text: hit.text }];
            const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: hit.source });
            rowResult = { fullText: hit.text, sections, chunks, source: hit.source, via: 'batch' };
            bumpMetric('pmcid_batch', 'hits');
          } else if (batchTransient) {
            rowResult = { transient: true, transients: ['pmcid_batch'] };
            bumpMetric('pmcid_batch', 'transient');
          } else {
            bumpMetric('pmcid_batch', 'misses');
          }

          const succeeded = await writeResult(row, rowResult, pgClient, chunkLines);
          if (succeeded) totalSucceeded++;
        }
      });

      if (chunkLines.length) {
        await appendFile(CHUNKS_FILE, chunkLines.join('\n') + '\n');
      }
    }

    console.log(`[phase2f] batch done pass=${label} lastPmid=${lastPmid} processed=${totalProcessed} succeeded=${totalSucceeded}`);
    logSummary();
  }

  console.log(`[phase2f] pass complete: ${label} processed=${totalProcessed} succeeded=${totalSucceeded}`);
  return { totalProcessed, totalSucceeded };
}

// Passes in priority order:
//   0. abstract_only WITH pmcid — batch NCBI efetch, ~20x faster than single-row
//   1. abstract_only WITHOUT pmcid — individual strategy pipeline
//   2. all other eligible rows
const QUERY_PASSES = [
  {
    label: 'abstract_only_with_pmcid',
    batch: true,
    skipEnv: 'SKIP_PASS0',
    sql: `SELECT pmid, doi, source_metadata->>'pmcid' as pmcid
            FROM research_articles
            WHERE pmid > $1
              AND has_full_text = false
              AND doi IS NOT NULL
              AND content_source = 'abstract_only'
              AND source_metadata->>'pmcid' IS NOT NULL
            ORDER BY pmid LIMIT $2`,
  },
  {
    label: 'abstract_only_no_pmcid',
    batch: false,
    skipEnv: 'SKIP_PASS1',
    sql: `SELECT pmid, doi,
                 source_metadata->>'pmcid' as pmcid,
                 source_metadata->>'is_oa' as is_oa,
                 source_metadata->>'oa_url' as oa_url
            FROM research_articles
            WHERE pmid > $1
              AND has_full_text = false
              AND doi IS NOT NULL
              AND content_source = 'abstract_only'
              AND source_metadata->>'pmcid' IS NULL
            ORDER BY pmid LIMIT $2`,
  },
  {
    label: 'others',
    batch: false,
    skipEnv: 'SKIP_PASS2',
    sql: `SELECT pmid, doi, source_metadata->>'pmcid' as pmcid
            FROM research_articles
            WHERE pmid > $1
              AND has_full_text = false
              AND doi IS NOT NULL
              AND content_source != 'abstract_only'
              AND content_source NOT LIKE 'phase2f%'
              AND content_source NOT LIKE 'phase2a_notfound%'
              AND content_source NOT LIKE 'phase2a_drop%'
              AND content_source NOT LIKE 'phase2a_qreject%'
            ORDER BY pmid LIMIT $2`,
  },
];

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  // Optional: start pass 0 from a specific pmid (for parallel instances)
  const pass0Start = BigInt(process.argv[2] ?? 0);
  // Optional: skip pass 1 to a specific pmid (e.g. 25_000_000 for post-OA-mandate).
  const pass1Start = BigInt(process.env.PASS1_START_PMID ?? 0);
  // Optional: hard upper bound — exit pass 1 cleanly once cursor crosses this.
  const pass1End = process.env.PASS1_END_PMID
    ? BigInt(process.env.PASS1_END_PMID)
    : null;

  let totalProcessed = 0;
  let totalSucceeded = 0;

  // Legacy env: SKIP_OTHERS_PASS=1 means skip pass 2.
  const legacySkipOthers = process.env.SKIP_OTHERS_PASS === '1';

  await withPg(async (pg) => {
    for (const { label, batch, sql, skipEnv } of QUERY_PASSES) {
      if (process.env[skipEnv] === '1' || (legacySkipOthers && label === 'others')) {
        console.log(`[phase2f] ${skipEnv}=1 — skipping pass: ${label}`);
        continue;
      }
      const startPmid =
        label === 'abstract_only_with_pmcid' ? pass0Start :
        label === 'abstract_only_no_pmcid' ? pass1Start :
        BigInt(0);

      if (batch) {
        ({ totalProcessed, totalSucceeded } = await runBatchPmcidPass(
          pg, sql, label, startPmid, totalProcessed, totalSucceeded
        ));
        continue;
      }

      let lastPmid = startPmid;
      const isPass1 = label === 'abstract_only_no_pmcid';
      console.log(`[phase2f] === pass: ${label} ===`);

      while (true) {
        if (isPass1 && pass1End !== null && lastPmid >= pass1End) {
          console.log(`[phase2f] reached pass1End=${pass1End} on ${label}, exiting pass`);
          break;
        }
        const { rows } = await pg.query(sql, [lastPmid, BATCH_SIZE]);
        if (!rows.length) break;

        // Pass 1 (no PMCID): bulk-prefilter via Unpaywall is_oa to skip closed-access rows,
        // and trim strategies to CORE only (empirically the only one that hits).
        const prefilter = isPass1 ? await bulkUnpaywallPrefilter(rows) : null;
        const strategies = isPass1 ? STRATEGIES_PASS1 : STRATEGIES;

        for (let i = 0; i < rows.length; i += CONCURRENCY) {
          const chunk = rows.slice(i, i + CONCURRENCY);
          // Lazy pg: processRow doesn't hold a pool connection — only acquires
          // one for the rare proxy-blocked UPDATE via writeResult.
          const chunkResults = await Promise.all(
            chunk.map((row) => processRow(row, prefilter, strategies))
          );

          const chunkLines = [];
          for (let j = 0; j < chunk.length; j++) {
            lastPmid = chunk[j].pmid;
            totalProcessed++;
            const succeeded = await writeResult(chunk[j], chunkResults[j], pg, chunkLines);
            if (succeeded) totalSucceeded++;
          }

          if (chunkLines.length) {
            await appendFile(CHUNKS_FILE, chunkLines.join('\n') + '\n');
          }
        }

        console.log(`[phase2f] batch done pass=${label} lastPmid=${lastPmid} processed=${totalProcessed} succeeded=${totalSucceeded}`);
        logSummary();
      }

      console.log(`[phase2f] pass complete: ${label} processed=${totalProcessed} succeeded=${totalSucceeded}`);
    }
  });

  console.log(`[phase2f] DONE total=${totalProcessed} succeeded=${totalSucceeded}`);
  logSummary();
}

main().catch((err) => { console.error('[phase2f] FATAL', err); process.exit(1); });
