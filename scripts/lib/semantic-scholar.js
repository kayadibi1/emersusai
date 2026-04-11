// Pure helpers for the Semantic Scholar Graph API (v1).
// Docs: https://api.semanticscholar.org/api-docs/graph
//
// The batch endpoint (paper/batch) accepts up to 500 paper IDs per POST
// request and returns the results in the same order as the request. If
// a paper isn't found, its slot in the response array is `null`.
//
// We request papers by PMID using the "PMID:12345" prefix form, and
// include externalIds in the response so we can robustly map each
// result back to its PMID (defensive — if order is ever perturbed by
// a server-side bug, we still reconstruct correctly).
//
// Without an API key the free tier is ~100 requests per 5 minutes. The
// backfill script inserts a pause between batches to respect that.

export const S2_BATCH_ENDPOINT =
  "https://api.semanticscholar.org/graph/v1/paper/batch";
export const S2_MAX_IDS_PER_REQUEST = 500;
export const S2_FIELDS = "externalIds,citationCount,influentialCitationCount";

/**
 * Build the querystring-tagged batch URL. Callers POST the ID list as
 * the request body.
 */
export function buildSemanticScholarBatchUrl() {
  return `${S2_BATCH_ENDPOINT}?fields=${encodeURIComponent(S2_FIELDS)}`;
}

/**
 * Turn an array of numeric PMIDs into the { ids: ["PMID:123", ...] }
 * body shape that Semantic Scholar's batch endpoint expects.
 */
export function buildSemanticScholarBatchBody(pmids) {
  if (!Array.isArray(pmids) || pmids.length === 0) {
    throw new Error(
      "buildSemanticScholarBatchBody: pmids must be a non-empty array"
    );
  }
  if (pmids.length > S2_MAX_IDS_PER_REQUEST) {
    throw new Error(
      `Semantic Scholar accepts at most ${S2_MAX_IDS_PER_REQUEST} IDs per request, got ${pmids.length}`
    );
  }
  return { ids: pmids.map((pmid) => `PMID:${pmid}`) };
}

/**
 * Parse a Semantic Scholar batch response into an array of
 *   { pmid: number, citation_count: number, influential_citation_count: number }
 * objects ready for update_pubmed_citations_batch.
 *
 * The response is an array of paper objects or null (for not-found).
 * We identify each non-null entry's PMID via externalIds.PubMed so we
 * do not depend on position alignment with the requested list.
 *
 * Papers with missing citation counts are dropped — we only update
 * rows where S2 actually returned useful numbers. `influentialCitationCount`
 * is treated as optional and may be left null.
 */
export function parseSemanticScholarResponse(body) {
  if (!Array.isArray(body)) return [];
  const out = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const pmidRaw =
      item.externalIds && typeof item.externalIds === "object"
        ? item.externalIds.PubMed ||
          item.externalIds.Pubmed ||
          item.externalIds.pmid ||
          null
        : null;
    // Guard against Number(null)===0 sneaking through as a valid PMID.
    if (pmidRaw === null || pmidRaw === undefined || pmidRaw === "") continue;
    const pmid = Number(pmidRaw);
    if (!Number.isFinite(pmid) || pmid <= 0) continue;

    if (item.citationCount === null || item.citationCount === undefined) continue;
    const citation = Number(item.citationCount);
    if (!Number.isFinite(citation)) continue; // drop rows with no real count

    const influentialRaw = item.influentialCitationCount;
    let influential = null;
    if (influentialRaw !== null && influentialRaw !== undefined) {
      const n = Number(influentialRaw);
      if (Number.isFinite(n)) influential = n;
    }
    out.push({
      pmid,
      citation_count: citation,
      influential_citation_count: influential,
    });
  }
  return out;
}
