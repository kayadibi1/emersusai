import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS } from "../../../../../api/emersus/pipeline/tools.js";

// Preflight static-check: catch strict-mode contract violations in tool
// schemas before they hit OpenAI. Strict mode requires:
//   - Every object schema declares additionalProperties: false
//   - Every key in `properties` is listed in `required`
//   - Optional fields declared as nullable (`type: ["T", "null"]`) — the
//     "every property required" constraint forces this pattern, since a
//     property that can legitimately be absent instead must accept null.
// Catches violations without spending an OpenAI API call.
// See the 2026-03 OpenAI strict-mode incident in memory (feedback_openai_strict_mode.md).

const NULLABLE_SHAPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function typeIncludes(schemaType, candidate) {
  if (Array.isArray(schemaType)) return schemaType.includes(candidate);
  return schemaType === candidate;
}

function walkSchema(schema, path, violations, toolName) {
  if (!schema || typeof schema !== "object") return;

  if (typeIncludes(schema.type, "object")) {
    if (schema.additionalProperties !== false) {
      violations.push(`[${toolName}] ${path || "(root)"}: additionalProperties must be false`);
    }
    if (schema.properties && typeof schema.properties === "object") {
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of Object.keys(schema.properties)) {
        if (!required.includes(key)) {
          violations.push(`[${toolName}] ${path}.${key}: property not listed in required`);
        }
        walkSchema(schema.properties[key], `${path}.${key}`, violations, toolName);
      }
    }
  }

  if (typeIncludes(schema.type, "array")) {
    if (schema.items) {
      walkSchema(schema.items, `${path}[]`, violations, toolName);
    }
  }
}

describe("strict-mode tool schema contract", () => {
  it("every strict:true tool satisfies the strict-mode contract", () => {
    const violations = [];
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.strict !== true) continue;
      walkSchema(tool.parameters, "", violations, tool.name);
    }
    assert.deepStrictEqual(
      violations,
      [],
      `strict-mode violations found:\n${violations.join("\n")}`
    );
  });

  it("every tool in TOOL_DEFINITIONS is strict:true (no strict:false remain)", () => {
    // Plan 9.5 closed out the multi-type widget-v2 superset-data pattern —
    // if a strict:false slips back in, surface it loudly.
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(
        tool.strict,
        true,
        `${tool.name} unexpectedly has strict !== true`
      );
    }
  });

  it("catches a hand-written violation (negative sanity case)", () => {
    // Property "b" is defined but missing from required — walker must flag.
    const badSchema = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
    };
    const violations = [];
    walkSchema(badSchema, "", violations, "test_tool");
    assert.equal(violations.length, 1);
    assert.match(violations[0], /property not listed in required/);
  });

  it("catches missing additionalProperties:false (negative sanity case)", () => {
    const badSchema = {
      type: "object",
      required: [],
      properties: {},
    };
    const violations = [];
    walkSchema(badSchema, "", violations, "test_tool");
    assert.equal(violations.length, 1);
    assert.match(violations[0], /additionalProperties must be false/);
  });

  it("walks nested object properties inside arrays", () => {
    // Simulates a malformed item schema inside an array — walker must recurse.
    const badSchema = {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            // missing additionalProperties:false AND "b" not in required
            required: ["a"],
            properties: {
              a: { type: "string" },
              b: { type: "string" },
            },
          },
        },
      },
    };
    const violations = [];
    walkSchema(badSchema, "", violations, "test_tool");
    // At least: one for additionalProperties, one for b-not-in-required.
    const hasAddl = violations.some((v) => /additionalProperties must be false/.test(v));
    const hasMissing = violations.some((v) => /property not listed in required/.test(v));
    assert.ok(hasAddl, "expected additionalProperties violation inside items");
    assert.ok(hasMissing, "expected missing-required violation inside items");
  });

  it("recognises optional fields declared as nullable union types", () => {
    // A well-formed strict-mode schema where `maybe_x` is optional-by-value
    // via type: ["string", "null"], and is still listed in required.
    const okSchema = {
      type: "object",
      additionalProperties: false,
      required: ["maybe_x"],
      properties: {
        maybe_x: { type: ["string", "null"] },
      },
    };
    const violations = [];
    walkSchema(okSchema, "", violations, "test_tool");
    assert.deepStrictEqual(violations, []);
    // Sanity: the union still includes an allowed scalar.
    assert.ok(NULLABLE_SHAPES.has("string"));
  });
});
