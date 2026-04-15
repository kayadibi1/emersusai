import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../../server.js", import.meta.url), "utf8");

describe("server route registration", () => {
  it("mounts foods/search-batch as POST", () => {
    assert.match(
      serverSource,
      /app\.post\(\s*["']\/api\/emersus\/foods\/search-batch["']/,
    );
    assert.doesNotMatch(
      serverSource,
      /app\.get\(\s*["']\/api\/emersus\/foods\/search-batch["']/,
    );
  });
});
