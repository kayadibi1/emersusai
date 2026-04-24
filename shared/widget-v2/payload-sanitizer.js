// Widget payload grounding sanitizer — runs after strict-schema validation,
// before the payload reaches toolResults. Scope: evidence-family types that
// carry per-study citation rows.
//
// Built for the 2026-04-23 diagnostic finding: 23/100 widgets emitted
// plausible-sounding author-year citations with null n/effect_size. The
// prose-path grounding verifier doesn't touch tool args, so this closes
// that gap at the tool-arg boundary.
//
// Behavior per type:
//   study_matrix         — drop rows whose citation doesn't match retrieval.
//                          Drop widget if < 2 grounded rows remain.
//                          Drop widget if no row has BOTH non-null n AND
//                          non-null effect_size.
//   effect_size_forest   — drop rows whose label doesn't match retrieval.
//                          Drop widget if < 2 rows remain or any row has
//                          null effect / ci_low / ci_high.
//   forest_plot          — same label-match as effect_size_forest on
//                          fp_studies. Drop if < 2 studies remain.
//   citation_timeline    — drop rows whose citation doesn't match retrieval.
//                          Keep-or-drop the widget at < 3 rows remaining.
//   study_quality_matrix — drop rows (quality_studies) whose citation
//                          doesn't match retrieval. Drop widget < 2.
//   study_beeswarm       — drop beeswarm_dots whose label doesn't match.
//                          Drop widget < 3.
//   meta_regression_line — leave alone; it plots dose vs effect without
//                          per-study citations.
//   evidence_strength_card — leave alone; GRADE-style qualitative.
//   butterfly_comparison — leave alone; pros/cons not citation rows.
//   ci_ladder            — drop ladder_protocols whose label doesn't match.
//                          Drop widget < 2.

// Parse "FirstAuthor et al. YYYY (Journal)" / "FirstAuthor YYYY" / "Smith
// et al. 2024" style strings into {author, year, journal?}.
function parseCitation(str) {
  if (typeof str !== "string") return null;
  // Author-year capture. Tolerates "et al.", commas, parens around year.
  const m = str.match(/([A-Z][A-Za-z'\-]+)(?:\s+(?:et\s*al\.?|&\s+[A-Z][A-Za-z'\-]+))?\s*[.,(]?\s*(\d{4})/);
  if (!m) return null;
  // Journal in parens
  const jm = str.match(/\(([^)]+)\)/);
  return {
    author: m[1].toLowerCase(),
    year: m[2],
    journal: jm ? jm[1].toLowerCase() : null,
  };
}

// Extract PMIDs / DOIs embedded in free-form citation strings.
function extractIds(str) {
  if (typeof str !== "string") return {};
  const pmidMatch = str.match(/pmid[:\s]*(\d{5,10})/i);
  const doiMatch = str.match(/(10\.\d{4,}[^\s,)]+)/i);
  return {
    pmid: pmidMatch ? Number(pmidMatch[1]) : null,
    doi: doiMatch ? doiMatch[1].toLowerCase().replace(/[.,)]$/, "") : null,
  };
}

// Is `citation` plausibly grounded in `items`? Returns true if any item
// matches. Matching priority: PMID > DOI > author+year.
function isCitationGrounded(citation, items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const ids = extractIds(citation);
  for (const item of items) {
    if (ids.pmid && Number(item.pmid) === ids.pmid) return true;
    if (ids.doi && item.doi && String(item.doi).toLowerCase() === ids.doi) return true;
  }
  const parsed = parseCitation(citation);
  if (!parsed) return false;
  for (const item of items) {
    const year = String(item.publication_year || "");
    if (year !== parsed.year) continue;
    const title = String(item.title || "").toLowerCase();
    const journal = String(item.journal || "").toLowerCase();
    // Author surname appears in title (first-author convention) or matches journal.
    if (title.includes(parsed.author)) return true;
    if (parsed.journal && journal.includes(parsed.journal.split(/\s/)[0])) return true;
  }
  return false;
}

function filterRows(rows, keyFn, items) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const citation = keyFn(row);
    return isCitationGrounded(citation, items);
  });
}

// Per-type sanitization. Mutates a fresh clone; returns {data, dropped}.
function sanitizeEvidence(payload, items) {
  const data = JSON.parse(JSON.stringify(payload.data || {}));
  const type = payload.type;
  const drops = [];

  const hasBothN = (s) => s && s.n != null && s.effect_size != null;

  switch (type) {
    case "study_matrix": {
      const before = Array.isArray(data.studies) ? data.studies.length : 0;
      data.studies = filterRows(data.studies, (s) => s.citation, items);
      if (data.studies.length < 2) return { drop: `study_matrix: <2 grounded rows (had ${before})` };
      if (!data.studies.some(hasBothN)) {
        return { drop: `study_matrix: no grounded row has both n and effect_size` };
      }
      if (before - data.studies.length > 0) drops.push(`study_matrix: dropped ${before - data.studies.length} ungrounded rows`);
      break;
    }
    case "effect_size_forest": {
      const before = Array.isArray(data.rows) ? data.rows.length : 0;
      data.rows = filterRows(data.rows, (r) => r.label, items).filter((r) =>
        r.effect != null && r.ci_low != null && r.ci_high != null,
      );
      if (data.rows.length < 2) return { drop: `effect_size_forest: <2 grounded rows (had ${before})` };
      if (before - data.rows.length > 0) drops.push(`effect_size_forest: dropped ${before - data.rows.length} rows`);
      break;
    }
    case "forest_plot": {
      const before = Array.isArray(data.fp_studies) ? data.fp_studies.length : 0;
      data.fp_studies = filterRows(data.fp_studies, (s) => s.label || s.citation, items);
      if (data.fp_studies.length < 2) return { drop: `forest_plot: <2 grounded studies (had ${before})` };
      if (before - data.fp_studies.length > 0) drops.push(`forest_plot: dropped ${before - data.fp_studies.length} ungrounded`);
      break;
    }
    case "citation_timeline": {
      const before = Array.isArray(data.timeline_studies) ? data.timeline_studies.length : 0;
      data.timeline_studies = filterRows(data.timeline_studies, (s) => s.citation || s.label, items);
      if (data.timeline_studies.length < 3) return { drop: `citation_timeline: <3 grounded (had ${before})` };
      if (before - data.timeline_studies.length > 0) drops.push(`citation_timeline: dropped ${before - data.timeline_studies.length}`);
      break;
    }
    case "study_quality_matrix": {
      const before = Array.isArray(data.quality_studies) ? data.quality_studies.length : 0;
      data.quality_studies = filterRows(data.quality_studies, (s) => s.citation || s.label, items);
      if (data.quality_studies.length < 2) return { drop: `study_quality_matrix: <2 grounded (had ${before})` };
      if (before - data.quality_studies.length > 0) drops.push(`study_quality_matrix: dropped ${before - data.quality_studies.length}`);
      break;
    }
    case "study_beeswarm": {
      const before = Array.isArray(data.beeswarm_dots) ? data.beeswarm_dots.length : 0;
      data.beeswarm_dots = filterRows(data.beeswarm_dots, (d) => d.label || d.citation, items);
      if (data.beeswarm_dots.length < 3) return { drop: `study_beeswarm: <3 grounded dots (had ${before})` };
      if (before - data.beeswarm_dots.length > 0) drops.push(`study_beeswarm: dropped ${before - data.beeswarm_dots.length}`);
      break;
    }
    case "ci_ladder": {
      const before = Array.isArray(data.ladder_protocols) ? data.ladder_protocols.length : 0;
      data.ladder_protocols = filterRows(data.ladder_protocols, (p) => p.label || p.citation, items);
      if (data.ladder_protocols.length < 2) return { drop: `ci_ladder: <2 grounded (had ${before})` };
      if (before - data.ladder_protocols.length > 0) drops.push(`ci_ladder: dropped ${before - data.ladder_protocols.length}`);
      break;
    }
    default:
      // evidence_strength_card / butterfly_comparison / meta_regression_line:
      // no per-study citation rows to sanitize.
      break;
  }

  return { data: { ...payload, data }, drops };
}

/**
 * Top-level entry. Runs after the strict-schema validator, before the
 * payload lands in toolResults.
 * @param {string} toolName  e.g. "emit_evidence_widget"
 * @param {object} payload   validated widget payload
 * @param {object} ctx       pipeline context (expects ctx.evidence?.items)
 * @returns {{ valid: true, data: object, drops?: string[] } | { valid: false, errors: string[] }}
 */
export function sanitizeWidgetPayload(toolName, payload, ctx) {
  if (toolName !== "emit_evidence_widget") {
    return { valid: true, data: payload };
  }
  const items = Array.isArray(ctx?.evidence?.items) ? ctx.evidence.items : [];
  if (items.length === 0) {
    // No retrieval to ground against — drop the widget rather than render fabricated citations.
    return { valid: false, errors: ["grounding: no retrieval items to match against"] };
  }
  const result = sanitizeEvidence(payload, items);
  if (result.drop) {
    return { valid: false, errors: [`grounding: ${result.drop}`] };
  }
  return { valid: true, data: result.data, drops: result.drops };
}

// Also export internals for tests.
export const _test = { parseCitation, extractIds, isCitationGrounded };
