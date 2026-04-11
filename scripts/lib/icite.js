// Pure helpers for the NIH iCite API.
// Docs: https://icite.od.nih.gov/api
//
// The API is free, requires no authentication, and accepts up to 1000
// PMIDs per GET request. Response shape:
//
//   { "meta": {...}, "data": [
//     { "pmid": 12345, "relative_citation_ratio": 1.23, ... },
//     { "pmid": 67890, "relative_citation_ratio": null,  ... }
//   ] }
//
// Some articles (especially very recent ones, or non-research article
// types) have null RCR values — the NIH computes RCR only after a few
// years of citation accrual. We filter those out of the update payload
// so we can distinguish "not yet backfilled" from "backfilled, no RCR".

export const ICITE_ENDPOINT = "https://icite.od.nih.gov/api/pubs";
export const ICITE_MAX_PMIDS_PER_REQUEST = 1000;

/**
 * Build the iCite GET URL for a set of PMIDs.
 * Throws if the input is empty or exceeds the per-request cap.
 */
export function buildIciteUrl(pmids) {
  if (!Array.isArray(pmids) || pmids.length === 0) {
    throw new Error("buildIciteUrl: pmids must be a non-empty array");
  }
  if (pmids.length > ICITE_MAX_PMIDS_PER_REQUEST) {
    throw new Error(
      `buildIciteUrl: iCite accepts at most ${ICITE_MAX_PMIDS_PER_REQUEST} PMIDs per request, got ${pmids.length}`
    );
  }
  return `${ICITE_ENDPOINT}?pmids=${pmids.join(",")}`;
}

/**
 * Parse an iCite JSON response body into an array of
 *   { pmid: number, rcr: number }
 * records, ready to pass to the update_pubmed_rcr_batch RPC.
 *
 * Rows with missing/null RCR are dropped — we only want to update DB
 * rows where the API has a real value for us. Malformed items are
 * silently ignored.
 */
export function parseIciteResponse(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    return [];
  }
  const out = [];
  for (const item of body.data) {
    if (!item || typeof item !== "object") continue;
    const pmid = Number(item.pmid);
    const rcr =
      item.relative_citation_ratio === null ||
      item.relative_citation_ratio === undefined
        ? null
        : Number(item.relative_citation_ratio);
    if (!Number.isFinite(pmid)) continue;
    if (rcr === null || !Number.isFinite(rcr)) continue;
    out.push({ pmid, rcr });
  }
  return out;
}
