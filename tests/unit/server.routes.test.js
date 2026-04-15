import { describe, it, test } from "node:test";
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

describe("redesign phase 1 — static files present", () => {
  test("design-tokens.css exists and defines both palettes", () => {
    const content = readFileSync("shared/design-tokens.css", "utf8");
    assert.ok(content.includes('[data-theme="mint"]'), "mint palette missing");
    assert.ok(content.includes('[data-theme="paper"]'), "paper palette missing");
    assert.ok(content.includes("--accent"), "--accent custom property missing");
  });

  test("theme.js exports the public API", async () => {
    const mod = await import("../../shared/theme.js");
    assert.ok(typeof mod.bootTheme === "function");
    assert.ok(typeof mod.applyTheme === "function");
    assert.ok(typeof mod.validateTheme === "function");
    assert.ok(typeof mod.resolveInitialTheme === "function");
    assert.deepEqual(mod.VALID_THEMES, ["mint", "paper"]);
  });

  test("chrome.css defines sidebar + top-bar classes", () => {
    const content = readFileSync("shared/chrome.css", "utf8");
    assert.ok(content.includes(".app-shell"));
    assert.ok(content.includes(".sidebar"));
    assert.ok(content.includes(".section-item"));
    assert.ok(content.includes(".tab"));
    assert.ok(content.includes(".btn"));
    assert.ok(content.includes(".field-input"));
  });
});
