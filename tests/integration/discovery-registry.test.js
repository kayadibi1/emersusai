// tests/integration/discovery-registry.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

test("all 14 RSS discovery feeds register themselves", async () => {
  // Side-effect imports
  await import("../../scripts/sources/rss-sbs.js");
  await import("../../scripts/sources/rss-suppversity.js");
  await import("../../scripts/sources/rss-mass.js");
  await import("../../scripts/sources/rss-sfs.js");
  await import("../../scripts/sources/rss-nsca.js");
  await import("../../scripts/sources/rss-acsm.js");
  await import("../../scripts/sources/rss-journal-bjsm.js");
  await import("../../scripts/sources/rss-journal-jscr.js");
  await import("../../scripts/sources/rss-journal-msse.js");
  await import("../../scripts/sources/rss-journal-ijspp.js");
  await import("../../scripts/sources/rss-journal-jap.js");
  await import("../../scripts/sources/rss-journal-sportsmed.js");
  await import("../../scripts/sources/rss-journal-sjmss.js");
  await import("../../scripts/sources/rss-journal-ejap.js");

  const { listDiscoverySources } = await import("../../scripts/sources/_registry.js");
  const sources = listDiscoverySources();
  const ids = sources.map(s => s.id);
  const expected = ["rss-sbs","rss-suppversity","rss-mass","rss-sfs","rss-nsca","rss-acsm",
                    "rss-bjsm","rss-jscr","rss-msse","rss-ijspp","rss-jap","rss-sportsmed","rss-sjmss","rss-ejap"];
  for (const id of expected) {
    assert.ok(ids.includes(id), `discovery source ${id} missing from registry`);
  }
});
