// jobs/classify-candidates.js
// LLM classifier: takes a batch of 25 DiscoveredItems and uses gpt-5-mini
// in JSON mode to decide:
//   - is this about exercise science?
//   - what's the canonical topic_key?
//   - what confidence does the classifier assign?
//   - what PubMed-style query would find more papers on this topic?
//
// High-confidence results (confidence >= 0.6) get upserted into
// topic_candidates. Duplicates are merged by topic_key — source_urls
// are array_cat'd and confidence is GREATEST.
//
// Dependency injection: the default export uses the shared openai client
// from api/lib/clients.js. Tests pass a mock via createClassifier().

import { openai as defaultOpenai } from "../api/lib/clients.js";

const MODEL = process.env.OPENAI_EMERSUS_MODEL ?? "gpt-5-mini";
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Build the classifier prompt for a batch of N items.
 * @param {{url: string, title: string, abstract: string|null}[]} items
 */
export function buildClassifierPrompt(items) {
  const numbered = items.map((it, i) =>
    `${i + 1}. TITLE: ${it.title}\n   ABSTRACT: ${(it.abstract ?? "(none)").slice(0, 800)}`
  ).join("\n\n");

  return {
    system: "You are a research topic classifier for an evidence-based exercise science corpus. Given article titles and abstracts, you identify which ones are relevant to exercise science (resistance training, endurance, nutrition, recovery, sports medicine, rehab, biomechanics, physiology) and extract a canonical topic keyword + a PubMed-style boolean query that would find more papers on that topic. You respond with JSON only.",
    user: `Classify the following ${items.length} articles. For each one, return an object with:
- is_exercise_science (boolean): is this article about exercise/sport/training science?
- topic_key (string|null): a snake_case slug like "blood_flow_restriction" or null if not relevant
- raw_term (string|null): a human-readable topic term like "Blood Flow Restriction Training" or null
- confidence (number 0-1): how confident you are
- rationale (string): one sentence explaining your decision
- suggested_query (string|null): a PubMed-style boolean query string like "(blood flow restriction) AND (hypertrophy OR strength)", or null if not relevant

Return a JSON object with shape: {"results": [ /* ${items.length} objects */ ]}. Order must match the input.

Articles:

${numbered}`,
  };
}

/**
 * Create a classify-candidates handler with a specific openai client.
 * Useful for testing — pass a mock client instead of the real one.
 *
 * @param {{ openaiClient: object }} deps
 * @returns {(ctx: object, deps: {sql: Function}) => Promise<{inserted: number, updated: number, skipped: number}>}
 */
export function createClassifier({ openaiClient }) {
  return async function classifyCandidatesHandler(ctx, { sql }) {
    const { items, feedId } = ctx.data;

    if (!openaiClient) {
      throw new Error("OPENAI client not configured — set OPENAI_API_KEY");
    }

    if (!items || items.length === 0) {
      await ctx.progress("no items to classify");
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    await ctx.progress(`classifying ${items.length} items from ${feedId}`);

    const prompt = buildClassifierPrompt(items);
    const resp = await openaiClient.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user",   content: prompt.user },
      ],
    });

    const content = resp.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`classifier returned invalid JSON: ${err.message}`);
    }
    const results = parsed.results ?? [];
    if (results.length !== items.length) {
      await ctx.progress(`warn: classifier returned ${results.length} results for ${items.length} items`, "warn");
    }

    let inserted = 0, updated = 0, skipped = 0;

    for (let i = 0; i < Math.min(results.length, items.length); i++) {
      const r = results[i];
      const item = items[i];

      if (!r.is_exercise_science || r.confidence < CONFIDENCE_THRESHOLD || !r.topic_key) {
        skipped += 1;
        continue;
      }

      // Skip if already in research_topics (human already accepted)
      const alreadyInTopics = await sql`
        SELECT 1 FROM research_topics WHERE topic_key = ${r.topic_key}
      `;
      if (alreadyInTopics.rows.length > 0) {
        skipped += 1;
        continue;
      }

      // Upsert: on conflict, keep higher confidence and merge source_urls
      const upsert = await sql`
        INSERT INTO topic_candidates (
          topic_key, raw_term, suggested_query, confidence, rationale, source_urls, discovery_feed
        ) VALUES (
          ${r.topic_key},
          ${r.raw_term},
          ${r.suggested_query},
          ${r.confidence},
          ${r.rationale},
          ${[item.url]},
          ${feedId}
        )
        ON CONFLICT (topic_key) DO UPDATE
          SET confidence = GREATEST(topic_candidates.confidence, EXCLUDED.confidence),
              source_urls = (
                SELECT array_agg(DISTINCT u)
                FROM unnest(topic_candidates.source_urls || EXCLUDED.source_urls) AS u
              ),
              raw_term = COALESCE(topic_candidates.raw_term, EXCLUDED.raw_term),
              suggested_query = COALESCE(topic_candidates.suggested_query, EXCLUDED.suggested_query),
              rationale = COALESCE(topic_candidates.rationale, EXCLUDED.rationale)
        RETURNING xmax = 0 AS was_insert
      `;
      if (upsert.rows[0].was_insert) inserted += 1;
      else updated += 1;
    }

    await ctx.progress(`classified: ${inserted} new, ${updated} updated, ${skipped} skipped`);
    return { inserted, updated, skipped };
  };
}

/**
 * Handler entry point invoked by the worker's registerHandlers.
 * Uses the default shared openai client from api/lib/clients.js.
 *
 * @param {{data: {items: object[], feedId: string}, progress: Function}} ctx
 * @param {{sql: Function}} deps
 */
export const classifyCandidatesHandler = createClassifier({ openaiClient: defaultOpenai });
