// Strict-mode JSON schema for the macro_ring variant. Mirrored by the
// server-side validator in ../../validators/calculator.js and by the
// OpenAI tool definition in api/emersus/pipeline/tools.js.

const MACRO_LEG_SCHEMA = {
  type: "object",
  required: ["grams", "target_grams", "kcal"],
  additionalProperties: false,
  properties: {
    grams:        { type: "number", minimum: 0 },
    target_grams: { type: "number", minimum: 0 },
    kcal:         { type: "number", minimum: 0 },
  },
};

export const MACRO_RING_DATA_SCHEMA = {
  type: "object",
  required: ["kcal_total", "phase", "protein", "carbs", "fat", "tdee_reference"],
  additionalProperties: false,
  properties: {
    kcal_total: { type: "number", minimum: 0 },
    phase:      { type: "string", enum: ["cut", "maintenance", "bulk"] },
    protein:    MACRO_LEG_SCHEMA,
    carbs:      MACRO_LEG_SCHEMA,
    fat:        MACRO_LEG_SCHEMA,
    tdee_reference: {
      type: ["object", "null"],
      required: ["tdee", "delta_kcal"],
      additionalProperties: false,
      properties: {
        tdee: { type: "number", minimum: 0 },
        delta_kcal: { type: "number" },
      },
    },
  },
};
