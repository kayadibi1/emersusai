// Retroactive reparse of the existing ~210k pubmed_articles rows to
// populate the XML-derived enrichment fields that were added after
// initial ingest:
//
//   is_retracted, retraction_notes  — from <CommentsCorrectionsList
//                                       RefType="RetractionIn">
//   abstract_sections                — structured abstract sections
//   publication_country              — from <MedlineJournalInfo><Country>
//
// Idempotent via the metadata_reparsed_at column — selects rows where
// it IS NULL and marks them with now() on successful update. Safe to
// re-run after interruption.
//
// Usage:
//   node scripts/reparse-pubmed-enrichment.js                # full backfill
//   node scripts/reparse-pubmed-enrichment.js --max-batches=1 # smoke test
//   node scripts/reparse-pubmed-enrichment.js --batch-size=100
//
// Data source: NCBI efetch (db=pubmed, retmode=xml). NCBI_API_KEY is
// read from the environment; with a valid key the rate limit is
// 10 req/sec, without it's 3 req/sec — default pause_ms is tuned
// accordingly in parseArgs().
//
// Missing/deleted PMIDs: if a PMID is no longer in PubMed, it won't
// appear in the efetch response. We still mark every PMID in the
// batch as reparsed (even those that weren't returned), so the
// script doesn't retry them forever. Their enrichment fields stay
// at their defaults (is_retracted=false, others NULL).

import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";
import {
  splitPubmedArticles,
  extractPmid,
  parseRetractionStatus,
  parseStructuredAbstract,
  parsePublicationCountry,
} from "./lib/pubmed-xml.js";

const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const DEFAULT_BATCH_SIZE = 200;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 4;

function parseArgs(argv) {
  const hasApiKey = Boolean(process.env.NCBI_API_KEY);
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    // With API key: 10 req/sec, so 120ms/request is safe (8 req/sec).
    // Without:        3 req/sec, so 400ms/request (2.5 req/sec).
    pauseMs: hasApiKey ? 150 : 400,
    maxBatches: Infinity,
  };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--batch-size") args.batchSize = Number(value) || DEFAULT_BATCH_SIZE;
    else if (key === "--pause-ms") args.pauseMs = Number(value) || args.pauseMs;
    else if (key === "--max-batches") args.maxBatches = Number(value) || Infinity;
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildEfetchUrl(pmids) {
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
  });
  if (process.env.NCBI_API_KEY) {
    params.set("api_key", process.env.NCBI_API_KEY);
  }
  return `${EFETCH_URL}?${params.toString()}`;
}

async function fetchEfetchWithRetry(pmids) {
  const url = buildEfetchUrl(pmids);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/xml" },
      });
      if (response.status === 429) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `efetch HTTP ${response.status} ${response.statusText}`
        );
      }
      return await response.text();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError || new Error("efetch: retries exhausted");
}

async function fetchNextPmidPage(cursor, limit) {
  let query = supabaseAdmin
    .from("pubmed_articles")
    .select("pmid")
    .is("metadata_reparsed_at", null)
    .order("pmid", { ascending: true })
    .limit(limit);
  if (cursor != null) query = query.gt("pmid", cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase select failed: ${error.message}`);
  return data || [];
}

/**
 * Parse a multi-article efetch response into per-PMID update payloads.
 * Returns a Map<pmid, payload>. Called by main() after each batch.
 */
function parseEfetchBody(xml) {
  const byPmid = new Map();
  for (const articleXml of splitPubmedArticles(xml)) {
    const pmid = extractPmid(articleXml);
    if (pmid === null) continue;
    const retraction = parseRetractionStatus(articleXml);
    byPmid.set(pmid, {
      pmid,
      is_retracted: retraction.isRetracted,
      retraction_notes: retraction.retractionNotes,
      abstract_sections: parseStructuredAbstract(articleXml),
      publication_country: parsePublicationCountry(articleXml),
    });
  }
  return byPmid;
}

async function main() {
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  const args = parseArgs(process.argv.slice(2));
  const hasApiKey = Boolean(process.env.NCBI_API_KEY);
  console.log(
    `[reparse] batch_size=${args.batchSize} pause_ms=${args.pauseMs} max_batches=${args.maxBatches} api_key=${hasApiKey ? "yes" : "no"}`
  );

  let cursor = null;
  let batchNum = 0;
  let totalSeen = 0;
  let totalMatched = 0;
  let totalMissing = 0;
  let totalRetracted = 0;
  const startedAt = Date.now();

  while (batchNum < args.maxBatches) {
    const page = await fetchNextPmidPage(cursor, args.batchSize);
    if (page.length === 0) {
      console.log("[reparse] no more rows with metadata_reparsed_at IS NULL");
      break;
    }

    const pmids = page.map((row) => row.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalSeen += pmids.length;

    const xml = await fetchEfetchWithRetry(pmids);
    const parsedByPmid = parseEfetchBody(xml);

    // Build the full update payload: one entry per PMID in the batch,
    // even for those that efetch didn't return (so they still get
    // metadata_reparsed_at set and don't get re-tried forever).
    const updates = pmids.map((pmid) => {
      const parsed = parsedByPmid.get(pmid);
      if (parsed) {
        if (parsed.is_retracted) totalRetracted++;
        totalMatched++;
        return parsed;
      }
      totalMissing++;
      return {
        pmid,
        is_retracted: false,
        retraction_notes: null,
        abstract_sections: null,
        publication_country: null,
      };
    });

    const { error } = await supabaseAdmin.rpc(
      "update_pubmed_enrichment_batch",
      { updates }
    );
    if (error) {
      throw new Error(`update_pubmed_enrichment_batch failed: ${error.message}`);
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[reparse] batch=${batchNum} seen=${totalSeen} matched=${totalMatched} missing=${totalMissing} retracted=${totalRetracted} elapsed=${elapsedSec}s last_pmid=${cursor}`
    );

    await sleep(args.pauseMs);
  }

  console.log(
    `[reparse] finished. seen=${totalSeen} matched=${totalMatched} missing=${totalMissing} retracted=${totalRetracted}`
  );
}

main().catch((err) => {
  console.error("[reparse] FAILED:", err);
  process.exit(1);
});
