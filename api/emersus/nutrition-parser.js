// api/emersus/nutrition-parser.js
//
// Separate OpenAI call for parsing natural-language food/supplement
// descriptions into structured log entries. Deterministic (temp 0),
// function-schema output, cheaper model than the main chat completion.
//
// Pipeline:
//   1. OpenAI parse with strict JSON schema → [{description, amount, amount_unit, kind, meal_slot?, confidence}]
//   2. For each parsed item, call foods_search RPC to resolve to a food_id
//   3. Return { items: [...], unresolved: [...] }

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PARSER_MODEL = process.env.OPENAI_EMERSUS_PARSER_MODEL || "gpt-4.1-mini";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const PARSER_SYSTEM_PROMPT = `
You are a nutrition parsing module. Given a free-form message describing what
someone ate or took, extract individual items with canonical amounts.

RULES:
- For FOODS: always produce amount in grams. Convert common household units:
    1 cup cooked white rice = 195 g
    1 medium banana = 118 g
    1 slice bread = 28 g
    1 large egg = 50 g
    1 tbsp olive oil = 14 g
    1 oz chicken = 28 g
  Set amount_unit = "g".
- For POWDER or MASS-MEASURED SUPPLEMENTS (creatine, whey, BCAA, caffeine powder,
  collagen): produce amount in grams and set amount_unit = "g".
- For DISCRETE-UNIT SUPPLEMENTS (vitamin D3 capsules, omega-3 softgels,
  magnesium tablets, multivitamin, probiotic capsules): produce the COUNT
  of units taken and set amount_unit = "serving".
- Distinguish foods vs supplements in the "kind" field.
- If the user named a brand ("Quest bar", "Chobani yogurt", "Trader Joe's
  frozen burrito"), PRESERVE it verbatim in the description so the matcher
  can look it up against the branded USDA catalog.
- If the user did NOT name a brand, keep the description generic.
- Do not invent items the user didn't mention.
- If you cannot determine a canonical amount, set confidence below 0.5 so the
  user can correct it in the confirmation widget.
- meal_slot is one of: breakfast, mid_morning, lunch, afternoon, dinner,
  evening, pre_workout, post_workout, supplements_am, supplements_pm. Only set
  it if the user explicitly named the slot. Otherwise leave null.
`.trim();

const PARSER_SCHEMA = {
  name: "parse_foods",
  description: "Parse a freeform food/supplement description into structured items.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw_text:    { type: "string", description: "The portion of user text this item came from" },
            description: { type: "string", description: "Generic food/supplement name" },
            amount:      { type: "number" },
            amount_unit: { type: "string", enum: ["g", "serving"] },
            kind:        { type: "string", enum: ["food", "supplement"] },
            meal_slot:   { type: ["string", "null"] },
            confidence:  { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["description", "amount", "amount_unit", "kind", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

function clientForRequest(authHeader) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Parse a freeform food description and resolve each item to a food_id.
 * @param {string} text
 * @param {string} authHeader  Forwarded Authorization header for RLS
 */
export async function parseFoodDescription(text, { authHeader }) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return { items: [], unresolved: [] };
  }

  let parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: PARSER_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: PARSER_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      tools: [{ type: "function", function: PARSER_SCHEMA }],
      tool_choice: { type: "function", function: { name: "parse_foods" } },
    });
    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return { items: [], unresolved: [], error: "parser_unavailable" };
    }
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    console.error("[nutrition-parser] openai error:", err);
    return { items: [], unresolved: [], error: "parser_unavailable" };
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const supabase = clientForRequest(authHeader);

  const resolved = [];
  const unresolved = [];

  for (const item of items) {
    const { data, error } = await supabase.rpc("foods_search", {
      p_query: item.description,
      p_kind: item.kind,
      p_generic_only: false,
      p_limit: 5,
    });
    if (error || !data || data.length === 0) {
      unresolved.push({
        raw_text: item.raw_text,
        description: item.description,
        amount: item.amount,
        amount_unit: item.amount_unit,
        kind: item.kind,
        meal_slot: item.meal_slot ?? null,
        confidence: item.confidence,
        reason: error ? "search_error" : "no_match",
      });
      continue;
    }

    const top = data[0];
    // Validate amount_unit compatibility with the matched food's base_unit
    if (top.base_unit === "100g" && item.amount_unit !== "g") {
      unresolved.push({ ...item, reason: "unit_mismatch", matched_food: top });
      continue;
    }
    if (top.base_unit === "serving" && item.amount_unit !== "serving") {
      unresolved.push({ ...item, reason: "unit_mismatch", matched_food: top });
      continue;
    }

    resolved.push({
      food_id: top.id,
      food_description: top.description,
      food_brand_name: top.brand_name ?? null,
      food_source: top.source,
      kind: top.kind,
      amount: item.amount,
      amount_unit: item.amount_unit,
      meal_slot: item.meal_slot ?? null,
      confidence: Math.min(item.confidence ?? 0.5, 1),
      match_method: "foods_search_rpc",
      alternates: data.slice(1, 5).map(d => ({
        food_id: d.id,
        description: d.description,
        brand_name: d.brand_name,
      })),
    });
  }

  return { items: resolved, unresolved };
}
