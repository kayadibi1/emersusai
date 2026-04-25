// scripts/fulltext-enrichment/phase2f-sweep.js
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
  max: 10, // bumped for concurrency
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
import { fetchForPmcid } from './lib/fetch-pmcid-jats.js';
import { fetchForDoi as fetchCore } from './lib/fetch-core-doi.js';
import { fetchForDoi as fetchS2 } from './lib/fetch-s2-pdf.js';
import { fetchForDoi as fetchOpenAlex } from './lib/fetch-openalex-oa.js';
import { fetchForDoi as fetchCrossRef } from './lib/fetch-crossref-links.js';
import { fetchForDoi as fetchIA } from './lib/fetch-ia-scholar.js';
import { fetchForDoi as fetchSpringer } from './lib/fetch-springer-oa.js';
import { fetchForDoi as fetchWiley } from './lib/fetch-wiley-tdm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CHUNKS_FILE = join(DATA_DIR, 'chunks-phase2f.jsonl');
const BATCH_SIZE = 100;  // larger batches for concurrent processing
const CONCURRENCY = 5;   // rows processed in parallel
const MIN_TEXT_LEN = 1000;

// Strategies in priority order. All fns receive (doi, row) — extra args ignored by most.
// needsPdf=false  → fn returns { text, sections?, source }
// needsPdf=true   → fn returns { pdfUrl, source } OR { pdfBuffer, source }
const STRATEGIES = [
  { fn: fetchForPmcid, needsPdf: false },  // S0: fastest for PMC articles (uses row.pmcid)
  { fn: fetchCore,     needsPdf: false },
  { fn: fetchSpringer, needsPdf: false },
  { fn: fetchWiley,    needsPdf: true  },
  { fn: fetchS2,       needsPdf: true  },
  { fn: fetchOpenAlex, needsPdf: true  },
  { fn: fetchCrossRef, needsPdf: true  },
  { fn: fetchIA,       needsPdf: true  },
];

async function pdfToChunks(buffer, { pmid, source }) {
  const tmpPath = join(tmpdir(), `phase2f-${randomBytes(8).toString('hex')}.pdf`);
  try {
    await writeFile(tmpPath, buffer);
    const tei = await processPdf(tmpPath, { fs });
    const parsed = parseTeiFullText(tei);
    if (!parsed || parsed.text.length < MIN_TEXT_LEN) return null;
    const chunks = buildBodyChunks({ pmid, sections: parsed.sections, provenance: source });
    return { text: parsed.text, chunks };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function processRow(row, pgClient) {
  for (const { fn, needsPdf } of STRATEGIES) {
    let result;
    try { result = await fn(row.doi, row); } catch { continue; }
    if (!result) continue;

    if (!needsPdf) {
      if (!result.text || result.text.length < MIN_TEXT_LEN) continue;
      const sections = result.sections ?? [{ title: null, type: 'body_other', text: result.text }];
      const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: result.source });
      return { fullText: result.text, chunks, source: result.source, via: 'direct' };
    }

    let download;
    if (result.pdfBuffer) {
      download = { buffer: result.pdfBuffer, via: 'direct' };
    } else {
      try {
        download = await downloadPdf(result.pdfUrl, { doi: row.doi });
      } catch (err) {
        if (err.code === 'PROXY_BLOCKED') {
          await pgClient.query(
            `UPDATE research_articles SET content_source = 'phase2f_proxy_blocked' WHERE pmid = $1`,
            [row.pmid]
          );
          return null;
        }
        continue;
      }
    }

    const grobid = await pdfToChunks(download.buffer, {
      pmid: row.pmid,
      source: result.source,
    }).catch(() => null);

    if (!grobid) continue;
    return { fullText: grobid.text, chunks: grobid.chunks, source: result.source, via: download.via };
  }
  return null;
}

async function writeResult(row, result, pgClient, chunkLines) {
  if (result) {
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

// Pass 1 targets abstract_only rows first (synthetic PMIDs ≥ 10^10, most have PMCIDs).
// Pass 2 covers all remaining eligible rows, skipping abstract_only and already-processed.
const QUERY_PASSES = [
  {
    label: 'abstract_only',
    sql: `SELECT pmid, doi, source_metadata->>'pmcid' as pmcid
            FROM research_articles
            WHERE pmid > $1
              AND has_full_text = false
              AND doi IS NOT NULL
              AND content_source = 'abstract_only'
            ORDER BY pmid LIMIT $2`,
  },
  {
    label: 'others',
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

  let totalProcessed = 0;
  let totalSucceeded = 0;

  await withPg(async (pg) => {
    for (const { label, sql } of QUERY_PASSES) {
      let lastPmid = BigInt(0);
      console.log(`[phase2f] === pass: ${label} ===`);

      while (true) {
        const { rows } = await pg.query(sql, [lastPmid, BATCH_SIZE]);
        if (!rows.length) break;

        // Process CONCURRENCY rows in parallel within each chunk
        for (let i = 0; i < rows.length; i += CONCURRENCY) {
          const chunk = rows.slice(i, i + CONCURRENCY);

          // Run processRow in parallel, each with its own pg connection
          const chunkResults = await Promise.all(
            chunk.map((row) => withPg((pgClient) => processRow(row, pgClient)))
          );

          // Write results sequentially to avoid JSONL interleaving
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
      }

      console.log(`[phase2f] pass complete: ${label} processed=${totalProcessed} succeeded=${totalSucceeded}`);
    }
  });

  console.log(`[phase2f] DONE total=${totalProcessed} succeeded=${totalSucceeded}`);
}

main().catch((err) => { console.error('[phase2f] FATAL', err); process.exit(1); });
