// scripts/fulltext-enrichment/audit-exhausted-recovery.js
//
// One-shot audit: sample N random phase2f_exhausted rows and re-run them
// through the (fixed) strategy chain to measure how much signal was burned by
// the silent-429 bug.
//
// Usage:
//   node scripts/fulltext-enrichment/audit-exhausted-recovery.js [sample_size]
//
// The audit is read-only: it does NOT update research_articles. It prints a
// report at the end with per-strategy recovery rate, transient rate, and the
// PMIDs that would have been recovered. Use this output to decide whether to
// reset the full exhausted population back to abstract_only for re-processing.
import 'dotenv/config';
import pg from 'pg';
import { fetchForPmcid } from './lib/fetch-pmcid-jats.js';
import { fetchForDoi as fetchCore } from './lib/fetch-core-doi.js';
import { fetchForDoi as fetchSpringer } from './lib/fetch-springer-oa.js';
import { fetchForDoi as fetchWiley } from './lib/fetch-wiley-tdm.js';
import { fetchForDoi as fetchS2 } from './lib/fetch-s2-pdf.js';
import { fetchForDoi as fetchOpenAlex } from './lib/fetch-openalex-oa.js';
import { fetchForDoi as fetchCrossRef } from './lib/fetch-crossref-links.js';
import { fetchForDoi as fetchIA } from './lib/fetch-ia-scholar.js';
import { fetchForDoi as fetchEuropePmc } from './lib/fetch-europepmc.js';
import { fetchForDoi as fetchUnpaywall } from './lib/fetch-unpaywall.js';

const STRATEGIES = [
  { name: 'pmcid',     fn: (row) => fetchForPmcid(row.doi, row), needsPdf: false },
  { name: 'core',      fn: (row) => fetchCore(row.doi),          needsPdf: false },
  { name: 'springer',  fn: (row) => fetchSpringer(row.doi),      needsPdf: false },
  { name: 's2',        fn: (row) => fetchS2(row.doi),            needsPdf: true  },
  { name: 'openalex',  fn: (row) => fetchOpenAlex(row.doi),      needsPdf: true  },
  { name: 'crossref',  fn: (row) => fetchCrossRef(row.doi),      needsPdf: true  },
  { name: 'ia',        fn: (row) => fetchIA(row.doi),            needsPdf: true  },
  { name: 'europepmc', fn: (row) => fetchEuropePmc(row.doi),     needsPdf: false },
  { name: 'unpaywall', fn: (row) => fetchUnpaywall(row.doi),     needsPdf: true  },
  { name: 'wiley',     fn: (row) => fetchWiley(row.doi),         needsPdf: true  },
];

const SAMPLE_SIZE = parseInt(process.argv[2] ?? '200', 10);

const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 5,
  keepAlive: true,
});

async function main() {
  console.log(`[audit] sampling ${SAMPLE_SIZE} phase2f_exhausted rows...`);
  const { rows } = await _pool.query(
    `SELECT pmid, doi,
            source_metadata->>'pmcid' AS pmcid
       FROM research_articles
      WHERE content_source = 'phase2f_exhausted'
        AND doi IS NOT NULL
      ORDER BY random()
      LIMIT $1`,
    [SAMPLE_SIZE]
  );
  console.log(`[audit] got ${rows.length} rows; ${rows.filter(r => r.pmcid).length} have PMCID`);

  const tally = new Map(); // strategy -> { hits, misses, transient, errors }
  const recoveries = []; // { pmid, doi, strategy, textLen }

  let done = 0;
  for (const row of rows) {
    let recovered = false;
    for (const { name, fn } of STRATEGIES) {
      let m = tally.get(name);
      if (!m) { m = { hits: 0, misses: 0, transient: 0, errors: 0 }; tally.set(name, m); }
      try {
        const result = await fn(row);
        if (result && (result.text || result.pdfUrl || result.pdfBuffer)) {
          m.hits++;
          recoveries.push({
            pmid: row.pmid.toString(),
            doi: row.doi,
            strategy: name,
            textLen: result.text?.length || (result.pdfUrl ? 'pdfUrl' : 'pdfBuffer'),
          });
          recovered = true;
          break; // first hit wins
        } else {
          m.misses++;
        }
      } catch (err) {
        if (err && err.transient) m.transient++;
        else m.errors++;
      }
    }
    done++;
    if (done % 25 === 0) {
      console.log(`[audit] progress ${done}/${rows.length} — recovered=${recoveries.length}`);
    }
  }

  // Report
  console.log('\n=== AUDIT REPORT ===');
  console.log(`sample size:      ${rows.length}`);
  console.log(`recoveries:       ${recoveries.length} (${((recoveries.length / rows.length) * 100).toFixed(1)}%)`);
  console.log('\nper-strategy:');
  for (const [name, m] of tally) {
    const total = m.hits + m.misses + m.transient + m.errors;
    if (!total) continue;
    console.log(`  ${name.padEnd(10)} hits=${m.hits} miss=${m.misses} transient=${m.transient} errors=${m.errors}  hitRate=${((m.hits / total) * 100).toFixed(1)}%`);
  }
  console.log('\nrecovery distribution by winning strategy:');
  const byStrategy = new Map();
  for (const r of recoveries) byStrategy.set(r.strategy, (byStrategy.get(r.strategy) || 0) + 1);
  for (const [s, n] of [...byStrategy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(10)} ${n} (${((n / recoveries.length) * 100).toFixed(1)}% of recoveries)`);
  }

  console.log('\nfirst 10 recovered PMIDs:');
  for (const r of recoveries.slice(0, 10)) {
    console.log(`  ${r.pmid} via ${r.strategy} doi=${r.doi}`);
  }

  await _pool.end();
}

main().catch((err) => { console.error('[audit] FATAL', err); process.exit(1); });
