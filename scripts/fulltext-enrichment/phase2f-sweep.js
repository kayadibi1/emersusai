// scripts/fulltext-enrichment/phase2f-sweep.js
import 'dotenv/config';
import { mkdir, writeFile, unlink, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { withPg } from '../abstract-enrichment/lib/pg.js';
import { downloadPdf } from './lib/proxy-http.js';
import { processPdf } from './lib/grobid-client.js';
import { parseTeiFullText } from './lib/tei-parser.js';
import { buildBodyChunks } from './lib/fulltext-chunker.js';
import { fetchForDoi as fetchCore } from './lib/fetch-core-doi.js';
import { fetchForDoi as fetchS2 } from './lib/fetch-s2-pdf.js';
import { fetchForDoi as fetchOpenAlex } from './lib/fetch-openalex-oa.js';
import { fetchForDoi as fetchCrossRef } from './lib/fetch-crossref-links.js';
import { fetchForDoi as fetchIA } from './lib/fetch-ia-scholar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CHUNKS_FILE = join(DATA_DIR, 'chunks-phase2f.jsonl');
const BATCH_SIZE = 50;
const MIN_TEXT_LEN = 1000;

// Strategies in priority order. needsPdf=false means the fn returns text directly.
const STRATEGIES = [
  { fn: fetchCore,     needsPdf: false },
  { fn: fetchS2,       needsPdf: true },
  { fn: fetchOpenAlex, needsPdf: true },
  { fn: fetchCrossRef, needsPdf: true },
  { fn: fetchIA,       needsPdf: true },
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

async function processRow(row, pg) {
  for (const { fn, needsPdf } of STRATEGIES) {
    let result;
    try { result = await fn(row.doi, pg); } catch { continue; }
    if (!result) continue;

    if (!needsPdf) {
      if (!result.text || result.text.length < MIN_TEXT_LEN) continue;
      const sections = [{ title: null, type: 'body_other', text: result.text }];
      const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: result.source });
      return { fullText: result.text, chunks, source: result.source, via: 'direct' };
    }

    let download;
    try {
      download = await downloadPdf(result.pdfUrl, { doi: row.doi });
    } catch (err) {
      if (err.code === 'PROXY_BLOCKED') {
        await pg.query(
          `UPDATE research_articles
             SET content_source = 'phase2f_proxy_blocked'
           WHERE pmid = $1`,
          [row.pmid]
        );
        return null;
      }
      continue;
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

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  let lastPmid = BigInt(process.argv[2] ?? 0);
  let totalProcessed = 0;
  let totalSucceeded = 0;

  await withPg(async (pg) => {
    while (true) {
      const { rows } = await pg.query(
        `SELECT pmid, doi FROM research_articles
          WHERE pmid > $1
            AND has_full_text = false
            AND doi IS NOT NULL
            AND content_source LIKE 'phase2%'
            AND content_source NOT LIKE 'phase2f%'
          ORDER BY pmid
          LIMIT $2`,
        [lastPmid, BATCH_SIZE]
      );
      if (!rows.length) break;

      for (const row of rows) {
        lastPmid = row.pmid;
        totalProcessed++;

        const result = await processRow(row, pg);

        if (result) {
          totalSucceeded++;
          await pg.query(
            `UPDATE research_articles
                SET full_text = $1, has_full_text = true, content_source = $2
              WHERE pmid = $3`,
            [result.fullText, result.source, row.pmid]
          );
          for (const chunk of result.chunks) {
            await appendFile(CHUNKS_FILE, JSON.stringify(chunk) + '\n');
          }
          console.log(`[phase2f] OK pmid=${row.pmid} source=${result.source} via=${result.via} chunks=${result.chunks.length}`);
        } else {
          // Only mark exhausted if not already tagged by processRow (e.g. proxy_blocked)
          const { rows: [cur] } = await pg.query(
            `SELECT content_source FROM research_articles WHERE pmid = $1`, [row.pmid]
          );
          if (!cur?.content_source?.startsWith('phase2f_')) {
            await pg.query(
              `UPDATE research_articles SET content_source = 'phase2f_exhausted' WHERE pmid = $1`,
              [row.pmid]
            );
          }
          console.log(`[phase2f] EXHAUSTED pmid=${row.pmid}`);
        }

        if (totalProcessed % 100 === 0) {
          console.log(`[phase2f] progress processed=${totalProcessed} succeeded=${totalSucceeded} lastPmid=${lastPmid}`);
        }
      }
    }
  });

  console.log(`[phase2f] DONE total=${totalProcessed} succeeded=${totalSucceeded}`);
}

main().catch((err) => { console.error('[phase2f] FATAL', err); process.exit(1); });
