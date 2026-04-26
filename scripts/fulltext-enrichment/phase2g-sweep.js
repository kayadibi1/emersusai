// scripts/fulltext-enrichment/phase2g-sweep.js
//
// Retroactive sweep over phase2f_exhausted rows using additional legitimate
// OA sources: Unpaywall (preprints + author manuscripts) and Europe PMC
// (Wellcome/EU-funded full text). Runs in parallel with phase2f.
//
// Set UNPAYWALL_EMAIL in env before running. REDIS_URL enables cluster-shared
// rate limiting (recommended when running alongside phase2f shards).
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
import { fetchForDoi as fetchUnpaywall } from './lib/fetch-unpaywall.js';
import { fetchForDoi as fetchEuropePmc } from './lib/fetch-europepmc.js';
import { checkQuality } from './lib/quality-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CHUNKS_FILE = join(DATA_DIR, 'chunks-phase2g.jsonl');
const METRICS_FILE = join(DATA_DIR, 'phase2g-strategy-metrics.jsonl');
const BATCH_SIZE = 100;
const CONCURRENCY = 5;
const MIN_TEXT_LEN = 1000;

const STRATEGIES = [
  { name: 'europepmc', fn: fetchEuropePmc, needsPdf: false },
  { name: 'unpaywall', fn: fetchUnpaywall, needsPdf: true  },
];

const metrics = new Map();
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
  if (lines.length) console.log('[phase2g] strategy metrics:\n' + lines.join('\n'));
}

async function pdfToChunks(buffer, { pmid, source }) {
  // Reject non-PDF buffers before they hit Grobid (HTML-disguised-as-PDF
  // takes 5-10s for Grobid to fail on with BAD_INPUT_DATA).
  if (!buffer || buffer.length < 4 || !buffer.slice(0, 4).toString().startsWith('%PDF')) {
    return null;
  }
  const tmpPath = join(tmpdir(), `phase2g-${randomBytes(8).toString('hex')}.pdf`);
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

// Sequential strategies (only 2; PDF-second). Tracks per-strategy outcomes.
// Returns same shape as phase2f's processRow.
async function processRow(row) {
  const transients = [];

  for (const { name, fn, needsPdf } of STRATEGIES) {
    let result;
    const t0 = Date.now();
    try {
      result = await fn(row.doi, row);
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
      continue;
    }
    const ms = Date.now() - t0;
    if (!result) {
      bumpMetric(name, 'misses');
      emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'miss', ms });
      continue;
    }
    bumpMetric(name, 'hits');
    emitMetric({ ts: Date.now(), pmid: row.pmid.toString(), strategy: name, outcome: 'hit', ms });

    if (!needsPdf) {
      if (!result.text || result.text.length < MIN_TEXT_LEN) continue;
      const sections = result.sections ?? [{ title: null, type: 'body_other', text: result.text }];
      const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: result.source });
      return { fullText: result.text, sections, chunks, source: result.source, via: 'direct', strategy: name };
    }

    let download;
    if (result.pdfBuffer) {
      download = { buffer: result.pdfBuffer, via: 'direct' };
    } else {
      try {
        download = await downloadPdf(result.pdfUrl, { doi: row.doi });
      } catch (err) {
        if (err.code === 'PROXY_BLOCKED') {
          return { proxyBlocked: true };
        }
        continue;
      }
    }

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

function gateResult(result) {
  const sections = result.sections ?? [{ title: null, type: 'body_other', text: result.fullText }];
  const q = checkQuality({ text: result.fullText, sections });
  return q.ok ? null : q.reason;
}

async function writeResult(row, result, pgClient, chunkLines) {
  if (result && result.proxyBlocked) {
    await pgClient.query(
      `UPDATE research_articles SET content_source = 'phase2g_proxy_blocked' WHERE pmid = $1`,
      [row.pmid]
    );
    console.log(`[phase2g] PROXY_BLOCKED pmid=${row.pmid}`);
    return false;
  }
  if (result && result.transient) {
    console.log(`[phase2g] TRANSIENT pmid=${row.pmid} retry-eligible=${result.transients.join(',')}`);
    return false;
  }
  if (result) {
    const reject = gateResult(result);
    if (reject) {
      await pgClient.query(
        `UPDATE research_articles
            SET content_source = 'phase2g_quality_reject',
                fulltext_reject_reason = $2
          WHERE pmid = $1`,
        [row.pmid, reject]
      );
      console.log(`[phase2g] QUALITY_REJECT pmid=${row.pmid} reason=${reject} source=${result.source}`);
      return false;
    }
    const safeText = Buffer.from(result.fullText, 'utf8').toString('utf8').replace(/�/g, '').replace(/\0/g, '');
    await pgClient.query(
      `UPDATE research_articles SET full_text = $1, has_full_text = true, content_source = $2 WHERE pmid = $3`,
      [safeText, result.source, row.pmid]
    );
    for (const c of result.chunks) chunkLines.push(JSON.stringify(c));
    console.log(`[phase2g] OK pmid=${row.pmid} source=${result.source} via=${result.via} chunks=${result.chunks.length}`);
    return true;
  } else {
    await pgClient.query(
      `UPDATE research_articles SET content_source = 'phase2g_exhausted' WHERE pmid = $1`,
      [row.pmid]
    );
    console.log(`[phase2g] EXHAUSTED pmid=${row.pmid}`);
    return false;
  }
}

async function main() {
  if (!process.env.UNPAYWALL_EMAIL) {
    console.warn('[phase2g] UNPAYWALL_EMAIL not set — Unpaywall strategy will be skipped');
  }

  await mkdir(DATA_DIR, { recursive: true });

  let lastPmid = BigInt(process.argv[2] ?? 0);
  let totalProcessed = 0;
  let totalSucceeded = 0;

  await withPg(async (pg) => {
    while (true) {
      const { rows } = await pg.query(
        `SELECT pmid, doi, source_metadata->>'pmcid' as pmcid
           FROM research_articles
           WHERE pmid > $1
             AND has_full_text = false
             AND doi IS NOT NULL
             AND content_source IN ('phase2f_exhausted', 'phase2e_exhausted')
           ORDER BY pmid
           LIMIT $2`,
        [lastPmid, BATCH_SIZE]
      );
      if (!rows.length) break;

      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);

        const chunkResults = await Promise.all(
          chunk.map((row) => processRow(row))
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

      console.log(`[phase2g] batch done lastPmid=${lastPmid} processed=${totalProcessed} succeeded=${totalSucceeded}`);
      logSummary();
    }
  });

  console.log(`[phase2g] DONE total=${totalProcessed} succeeded=${totalSucceeded}`);
  logSummary();
}

main().catch((err) => { console.error('[phase2g] FATAL', err); process.exit(1); });
