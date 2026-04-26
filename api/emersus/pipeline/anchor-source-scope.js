// api/emersus/pipeline/anchor-source-scope.js
//
// Resolves the searchable scope for an anchor's verification step.
// For a given pmid, returns { chunk, full_text, abstract } — chunk is
// always present (passed in by the caller as the retrieved excerpt),
// abstract comes from research_articles.abstract, full_text comes from
// research_articles.full_text only when has_full_text=true.
//
// The resolver caches per-pmid lookups within a single instance, so
// multiple anchors citing the same source incur a single Supabase call
// per chat-verification pass.

import { supabaseAdmin } from "../../lib/clients.js";

export function buildSourceScopeResolver({ supabase = supabaseAdmin } = {}) {
  const cache = new Map();

  async function resolve({ pmid, fallbackChunk }) {
    const chunk = fallbackChunk || "";
    if (pmid == null) {
      return { chunk, full_text: null, abstract: null };
    }
    let row = cache.get(pmid);
    if (!row) {
      try {
        const { data, error } = await supabase
          .from("research_articles")
          .select("pmid,abstract,full_text,has_full_text")
          .in("pmid", [pmid]);
        if (error) {
          console.warn(`[anchor-source-scope] fetch error for pmid ${pmid}: ${error.message}`);
          row = { abstract: null, full_text: null, has_full_text: false };
        } else {
          row = data?.[0] || { abstract: null, full_text: null, has_full_text: false };
        }
      } catch (err) {
        console.warn(`[anchor-source-scope] threw for pmid ${pmid}: ${err.message}`);
        row = { abstract: null, full_text: null, has_full_text: false };
      }
      cache.set(pmid, row);
    }
    return {
      chunk,
      full_text: row.has_full_text ? (row.full_text || null) : null,
      abstract: row.abstract || null,
    };
  }

  return { resolve };
}
