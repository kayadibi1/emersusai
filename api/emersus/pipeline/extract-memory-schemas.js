// api/emersus/pipeline/extract-memory-schemas.js
//
// Two JSON schemas for the Phase 5 two-stage auto-extractor (spec §5.1).
// Used as `response_format: { type: "json_schema", strict: true, schema: ... }`
// on separate OpenAI Responses API calls run after the main assistant stream
// ends.
//
// Both schemas are strict-mode compliant per the hard-won
// `feedback_openai_strict_mode` rule: every property in `required`, every
// optional nullable, `additionalProperties: false` on every object.

import { MEMORY_CATEGORY_ENUM } from "./tools.js";

// The gate never emits 'custom' — that tier exists only for explicit saves.
const AUTO_EXTRACT_CATEGORIES = MEMORY_CATEGORY_ENUM.filter((c) => c !== "custom");

export const MEMORY_GATE_SCHEMA = {
  name: "memory_gate",
  strict: true,
  schema: {
    type: "object",
    properties: {
      relevant: { type: "boolean" },
      categories: {
        type: "array",
        items: { type: "string", enum: AUTO_EXTRACT_CATEGORIES },
      },
    },
    required: ["relevant", "categories"],
    additionalProperties: false,
  },
};

export const MEMORY_FACTS_SCHEMA = {
  name: "memory_facts",
  strict: true,
  schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category:        { type: "string", enum: AUTO_EXTRACT_CATEGORIES },
            fact:            { type: "string" },
            confidence:      { type: "number" },
            supersedes_hint: { type: ["string", "null"] },
            meta_side:       { type: ["string", "null"] },
            meta_onset:      { type: ["string", "null"] },
            meta_dose:       { type: ["string", "null"] },
            meta_frequency:  { type: ["string", "null"] },
            meta_value:      { type: ["string", "null"] },
            meta_reps:       { type: ["integer", "null"] },
            meta_unit:       { type: ["string", "null"] },
            meta_date:       { type: ["string", "null"] },
          },
          required: [
            "category", "fact", "confidence", "supersedes_hint",
            "meta_side", "meta_onset", "meta_dose", "meta_frequency",
            "meta_value", "meta_reps", "meta_unit", "meta_date",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["facts"],
    additionalProperties: false,
  },
};

export { AUTO_EXTRACT_CATEGORIES };
