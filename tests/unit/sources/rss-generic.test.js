// tests/unit/sources/rss-generic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/rss/${name}`), "utf8");
}

// Import parser — not the full module (which registers things) but the pure exports
const { parseRss, createRssSource } = await import("../../../scripts/sources/rss-generic.js");

test("parseRss returns >=1 items from SBS fixture with required fields", () => {
  const xml = loadFixture("sbs.xml");
  const items = parseRss(xml);
  assert.ok(items.length >= 1, "should parse at least one item");
  for (const it of items) {
    assert.ok(it.title && it.title.length > 0, "title must be non-empty");
    assert.ok(it.url && it.url.length > 0, "url must be non-empty");
    assert.ok(it.publishedAt instanceof Date, "publishedAt must be a Date");
    assert.ok(!isNaN(it.publishedAt.getTime()), "publishedAt must be valid");
  }
});

test("parseRss returns items sorted newest-first", () => {
  const xml = loadFixture("sbs.xml");
  const items = parseRss(xml);
  assert.ok(items.length >= 2, "need at least 2 items to test sort order");
  for (let i = 0; i < items.length - 1; i++) {
    assert.ok(
      items[i].publishedAt >= items[i + 1].publishedAt,
      `item[${i}] (${items[i].publishedAt.toISOString()}) should be >= item[${i+1}] (${items[i+1].publishedAt.toISOString()})`
    );
  }
});

test("parseRss handles Atom feed format", () => {
  const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <entry>
    <title>Atom Entry One</title>
    <link href="https://example.com/atom-1"/>
    <summary>First atom entry summary</summary>
    <published>2024-06-01T10:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link href="https://example.com/atom-2"/>
    <summary>Second atom entry summary</summary>
    <published>2024-05-01T10:00:00Z</published>
  </entry>
</feed>`;
  const items = parseRss(atomXml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Atom Entry One");
  assert.equal(items[0].url, "https://example.com/atom-1");
  assert.equal(items[0].abstract, "First atom entry summary");
  // newest-first
  assert.ok(items[0].publishedAt >= items[1].publishedAt);
});

test("createRssSource.fetchNew returns all items when last_item_at is null", async () => {
  const xml = loadFixture("sbs.xml");

  nock("https://www.strongerbyscience.com")
    .get("/feed/")
    .reply(200, xml, { "content-type": "application/rss+xml" });

  const src = createRssSource({
    id: "test-rss-sbs",
    name: "Test SBS",
    url: "https://www.strongerbyscience.com/feed/",
  });

  const items = await src.fetchNew({ url: "https://www.strongerbyscience.com/feed/", last_item_at: null });
  assert.ok(items.length >= 1, "should return items with null watermark");
  for (const it of items) {
    assert.ok(it.url, "item url must be set");
    assert.ok(it.title !== undefined, "item title must be present");
    assert.ok(it.publishedAt instanceof Date, "publishedAt must be a Date");
    assert.equal(it.feedId, "test-rss-sbs");
  }
  nock.cleanAll();
});

test("createRssSource.fetchNew returns 0 items when last_item_at is far future", async () => {
  const xml = loadFixture("sbs.xml");

  nock("https://www.strongerbyscience.com")
    .get("/feed/")
    .reply(200, xml, { "content-type": "application/rss+xml" });

  const src = createRssSource({
    id: "test-rss-sbs-future",
    name: "Test SBS Future",
    url: "https://www.strongerbyscience.com/feed/",
  });

  // Watermark 10 years in the future — all items should be filtered out
  const futureDate = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const items = await src.fetchNew({ url: "https://www.strongerbyscience.com/feed/", last_item_at: futureDate });
  assert.equal(items.length, 0, "no items should pass a far-future watermark");
  nock.cleanAll();
});
