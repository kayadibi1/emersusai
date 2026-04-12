// scripts/test-foods-search.js
//
// Smoke test for api/emersus/foods-search.js and the foods_search RPC.
// Assumes the local Express server is running on 127.0.0.1:3001 and the
// database has at least the seeded nutrients + supplements (Task 1-3).
//
// Usage: node scripts/test-foods-search.js

import assert from "node:assert/strict";

const BASE = process.env.EMERSUS_BASE_URL || "http://127.0.0.1:3001";

// Unauthenticated requests work for public (non-user-contributed) foods.
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return await res.json();
}

console.log("[test-foods-search] running against", BASE);

// 1. Supplement search — finds creatine in the seed
{
  const { results } = await get("/api/emersus/foods/search?q=creatine&kind=supplement");
  assert.ok(results.length > 0, "expected at least one creatine result");
  assert.match(results[0].description, /creatine/i, "top result should contain 'creatine'");
  console.log("  ✓ creatine supplement search");
}

// 2. Query too short rejected
{
  const res = await fetch(`${BASE}/api/emersus/foods/search?q=a`);
  assert.equal(res.status, 400, "single-char query should be rejected");
  const body = await res.json();
  assert.equal(body.error, "query_too_short");
  console.log("  ✓ short-query rejection");
}

// 3. kind filter: query 'protein' with kind=supplement should return whey, casein, etc. not chicken breast
{
  const { results } = await get("/api/emersus/foods/search?q=protein&kind=supplement&limit=10");
  for (const r of results) {
    assert.equal(r.kind, "supplement", `expected supplement, got ${r.kind} for "${r.description}"`);
  }
  console.log(`  ✓ kind=supplement filter (${results.length} results)`);
}

// 4. generic_only excludes branded (can only test once branded is imported;
//    this test is a no-op pre-Phase-6 but documents the expected contract)
{
  const { results } = await get("/api/emersus/foods/search?q=oats&generic_only=true&limit=10");
  for (const r of results) {
    assert.notEqual(r.source, "usda_branded", "generic_only=true should exclude branded");
  }
  console.log(`  ✓ generic_only filter (${results.length} results)`);
}

console.log("[test-foods-search] all assertions passed.");
