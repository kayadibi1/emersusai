import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceScopeResolver } from "../../../../../api/emersus/pipeline/anchor-source-scope.js";

function fakeSupabase(rows, hooks = {}) {
  return {
    from: () => ({
      select: () => ({
        in: async (col, ids) => {
          if (hooks.onIn) hooks.onIn(col, ids);
          return {
            data: rows.filter((r) => ids.includes(r[col])),
            error: null,
          };
        },
      }),
    }),
  };
}

test("resolver returns chunk + full_text + abstract when has_full_text=true", async () => {
  const resolver = buildSourceScopeResolver({
    supabase: fakeSupabase([
      { pmid: 7670456, abstract: "RCT abstract", full_text: "Methods. Results.", has_full_text: true },
    ]),
  });
  const scope = await resolver.resolve({ pmid: 7670456, fallbackChunk: "chunk text" });
  assert.equal(scope.chunk, "chunk text");
  assert.equal(scope.full_text, "Methods. Results.");
  assert.equal(scope.abstract, "RCT abstract");
});

test("resolver returns null full_text when has_full_text=false", async () => {
  const resolver = buildSourceScopeResolver({
    supabase: fakeSupabase([
      { pmid: 1, abstract: "abs", full_text: null, has_full_text: false },
    ]),
  });
  const scope = await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  assert.equal(scope.full_text, null);
  assert.equal(scope.abstract, "abs");
});

test("resolver caches per-pmid (single Supabase call for repeated pmid)", async () => {
  let callCount = 0;
  const supabase = {
    from: () => ({
      select: () => ({
        in: async (_col, ids) => {
          callCount += 1;
          return {
            data: ids.map((id) => ({ pmid: id, abstract: "a", full_text: null, has_full_text: false })),
            error: null,
          };
        },
      }),
    }),
  };
  const resolver = buildSourceScopeResolver({ supabase });
  await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  await resolver.resolve({ pmid: 2, fallbackChunk: "c" });
  assert.equal(callCount, 2, "second call for pmid=1 should hit cache");
});

test("resolver handles missing pmid gracefully", async () => {
  const resolver = buildSourceScopeResolver({ supabase: fakeSupabase([]) });
  const scope = await resolver.resolve({ pmid: 999, fallbackChunk: "fallback chunk" });
  assert.equal(scope.chunk, "fallback chunk");
  assert.equal(scope.full_text, null);
  assert.equal(scope.abstract, null);
});

test("resolver handles supabase errors gracefully (no throw)", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: null, error: { message: "boom" } }),
      }),
    }),
  };
  const resolver = buildSourceScopeResolver({ supabase });
  const scope = await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  assert.equal(scope.chunk, "c");
  assert.equal(scope.full_text, null);
  assert.equal(scope.abstract, null);
});
