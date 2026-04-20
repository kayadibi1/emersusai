// tests/unit/api/emersus/pipeline/model-for-tier.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// The module reads env at import time via top-level const. Each test
// sets env then re-imports via a fresh URL query string so it re-runs
// module init.
async function freshImport() {
  const url =
    "../../../../../api/emersus/pipeline/synthesize.js?t=" + Math.random();
  const mod = await import(url);
  return mod.modelForTier;
}

describe("modelForTier", () => {
  let snapshot;
  beforeEach(() => {
    snapshot = {
      OPENAI_EMERSUS_MODEL: process.env.OPENAI_EMERSUS_MODEL,
      OPENAI_EMERSUS_PRO_MODEL: process.env.OPENAI_EMERSUS_PRO_MODEL,
    };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("free returns default model", async () => {
    process.env.OPENAI_EMERSUS_MODEL = "gpt-free";
    process.env.OPENAI_EMERSUS_PRO_MODEL = "gpt-pro";
    const modelForTier = await freshImport();
    assert.equal(modelForTier("free"), "gpt-free");
  });

  test("pro returns pro model when set", async () => {
    process.env.OPENAI_EMERSUS_MODEL = "gpt-free";
    process.env.OPENAI_EMERSUS_PRO_MODEL = "gpt-pro";
    const modelForTier = await freshImport();
    assert.equal(modelForTier("pro"), "gpt-pro");
  });

  test("pro falls back to default when OPENAI_EMERSUS_PRO_MODEL unset", async () => {
    process.env.OPENAI_EMERSUS_MODEL = "gpt-free";
    delete process.env.OPENAI_EMERSUS_PRO_MODEL;
    const modelForTier = await freshImport();
    assert.equal(modelForTier("pro"), "gpt-free");
  });

  test("unknown tier returns default", async () => {
    process.env.OPENAI_EMERSUS_MODEL = "gpt-free";
    process.env.OPENAI_EMERSUS_PRO_MODEL = "gpt-pro";
    const modelForTier = await freshImport();
    assert.equal(modelForTier("enterprise"), "gpt-free");
    assert.equal(modelForTier(null), "gpt-free");
  });
});
