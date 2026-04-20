// tests/unit/api/emersus/user-rate-limit.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  readTier,
  invalidateTier,
  _resetTierCacheForTests,
} from "../../../../api/emersus/user-rate-limit.js";

function stubSupabase(tier) {
  let calls = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls++;
            return { data: tier ? { tier } : null, error: null };
          },
        }),
      }),
    }),
    _calls: () => calls,
  };
}

describe("readTier", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("returns 'free' when profile row missing", async () => {
    const db = stubSupabase(null);
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "free");
  });

  test("returns the tier from the DB", async () => {
    const db = stubSupabase("pro");
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "pro");
  });

  test("caches for 60s — second call does not hit DB", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 1, "only one DB call for two reads");
  });

  test("invalidateTier forces a refresh", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    invalidateTier("u-1");
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 2);
  });
});
