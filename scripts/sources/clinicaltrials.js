// scripts/sources/clinicaltrials.js
// Ingestion adapter for ClinicalTrials.gov (https://clinicaltrials.gov).
//
// CT.gov has ~500k registered trials with structured protocol data. Free
// REST v2 API at https://clinicaltrials.gov/api/v2/studies — no API key
// required, no documented rate limit (we use 5 RPS to be polite).
//
// These are TRIAL PROTOCOLS, not peer-reviewed papers. They give us:
//   - "Active research" signal (e.g. "phase-3 trial of X reading out Q3")
//   - Structured outcome targets and intervention details
//   - Coverage of protocols that never publish or publish years later
//
// Adapter ID: `clinicaltrials`. external_id = NCT number. peer_reviewed=false.
//
// Query syntax: the v2 API's `query.term` accepts free-text plus
// AND/OR — but parens and quoted phrases are flaky. We sanitize the
// boolean query down to plain keywords joined by spaces, which CT.gov
// treats as implicit AND (good for precision).

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://clinicaltrials.gov/api/v2/studies";
const PAGE_SIZE = 100; // max per CT.gov v2 docs
const MAX_PAGES = 10;  // hard cap on a single topic — protects against runaway pagination

const waitSlot = createLimiter(5);

/**
 * CT.gov accepts free-text but trips on parens / quoted phrases. Strip
 * boolean operators and quoting, leave the bare keywords. CT.gov treats
 * adjacent keywords as implicit AND.
 */
export function sanitizeToKeywords(query) {
  if (!query || typeof query !== "string") return "";
  return query
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    .replace(/["']/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchUrl(query, pageToken) {
  const params = new URLSearchParams({
    "query.term": sanitizeToKeywords(query),
    pageSize: String(PAGE_SIZE),
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, pageToken) {
  await waitSlot();
  const resp = await fetchWithTimeoutAndUA(buildSearchUrl(query, pageToken), {
    accept: "application/json",
    timeoutMs: 20_000,
  });
  return resp.json();
}

function normalize(study) {
  const ps = study?.protocolSection ?? {};
  const ident = ps.identificationModule ?? {};
  const status = ps.statusModule ?? {};
  const desc = ps.descriptionModule ?? {};
  const cond = ps.conditionsModule ?? {};
  const arms = ps.armsInterventionsModule ?? {};
  const sponsor = ps.sponsorCollaboratorsModule ?? {};
  const design = ps.designModule ?? {};

  const nctId = ident.nctId;
  if (!nctId) return null;

  const title = (ident.briefTitle || ident.officialTitle || "").trim();
  if (!title) return null;

  // Compose the abstract from briefSummary; detailedDescription is often
  // 5–10× longer and dominates the embedding budget for marginal gain.
  const abstract = (desc.briefSummary || "").trim() || null;

  const dateStr = status.startDateStruct?.date
    || status.studyFirstPostDateStruct?.date
    || null;
  const publishedAt = dateStr ? new Date(dateStr) : null;

  const investigator = sponsor.responsibleParty?.investigatorFullName
    || sponsor.leadSponsor?.name
    || null;
  const authors = investigator ? [investigator] : [];

  return {
    externalId: nctId,
    source: "clinicaltrials",
    title,
    abstract,
    doi: null, // CT.gov registrations don't carry DOIs
    publishedAt,
    journal: "ClinicalTrials.gov",
    authors,
    peerReviewed: false,
    sourceMetadata: {
      nct_id: nctId,
      overall_status: status.overallStatus ?? null,
      phases: design.phases ?? null,
      conditions: cond.conditions ?? null,
      interventions: (arms.interventions ?? []).map((i) => ({
        name: i.name,
        type: i.type,
      })),
      lead_sponsor: sponsor.leadSponsor?.name ?? null,
      enrollment: design.enrollmentInfo?.count ?? null,
    },
  };
}

export const clinicaltrials = {
  id: "clinicaltrials",
  name: "ClinicalTrials.gov",
  peerReviewed: false,

  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let pageToken = null;
    let yielded = 0;
    let pagesFetched = 0;

    while (yielded < target && pagesFetched < MAX_PAGES) {
      const body = await searchPage(query, pageToken);
      pagesFetched += 1;

      const studies = Array.isArray(body?.studies) ? body.studies : [];
      if (studies.length === 0) return;

      for (const s of studies) {
        if (opts?.signal?.aborted) return;
        const paper = normalize(s);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      pageToken = body?.nextPageToken ?? null;
      if (!pageToken) return;
    }
  },
};

registerIngestion(clinicaltrials);
