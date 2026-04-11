// scripts/sources/rss-generic.js
// Generic RSS/Atom feed parser + DiscoverySource factory. Per-feed
// wrapper files call createRssSource({id, name, url}) and get a fully
// formed DiscoverySource that self-registers.
//
// The parser handles RSS 2.0 <item> and Atom <entry> shapes with a
// minimum of regex — no XML library. Sufficient for the ~20 feeds
// we scan (all are well-formed major-publisher feeds).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerDiscovery } from "./_registry.js";

// Shared polite limiter for generic RSS fetching — 2 RPS is plenty.
const rssLimiter = createLimiter(2);

function stripTags(s) { return (s ?? "").replace(/<[^>]+>/g, ""); }
function decodeEntities(s) {
  return (s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Parse an RSS 2.0 or Atom feed. Returns items ordered newest-first.
 * @param {string} xml
 * @returns {{ title: string, url: string, abstract: string|null, publishedAt: Date }[]}
 */
export function parseRss(xml) {
  const items = [];

  // RSS 2.0: <item>...</item>
  const rssItems = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const m of rssItems) {
    const block = m[1];
    items.push({
      title:       decodeEntities(stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")).trim(),
      url:         decodeEntities((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "")).trim(),
      abstract:    decodeEntities(stripTags(
                     block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1]
                     ?? block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]
                     ?? ""
                   )).trim() || null,
      publishedAt: new Date(block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1] ?? Date.now()),
    });
  }

  // Atom: <entry>...</entry>
  const atomEntries = [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)];
  for (const m of atomEntries) {
    const block = m[1];
    const linkHref = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    items.push({
      title:       decodeEntities(stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")).trim(),
      url:         linkHref,
      abstract:    decodeEntities(stripTags(
                     block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]
                     ?? block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]
                     ?? ""
                   )).trim() || null,
      publishedAt: new Date(block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1] ?? block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1] ?? Date.now()),
    });
  }

  items.sort((a, b) => b.publishedAt - a.publishedAt);
  return items;
}

/**
 * Build a DiscoverySource from a feed config. The returned object can be
 * passed directly to registerDiscovery(); the per-feed wrapper file
 * should call this factory and export + register the result.
 *
 * @param {{id: string, name: string, url: string}} config
 * @returns {import('./_types.js').DiscoverySource}
 */
export function createRssSource({ id, name, url }) {
  return {
    id,
    name,
    kind: "rss",
    async fetchNew(feedRow) {
      // Prefer the feed row's URL (config comes from DB) over the
      // module's hardcoded default — allows admin to override without
      // a code push.
      const targetUrl = feedRow?.url ?? url;
      await rssLimiter();
      const resp = await fetchWithTimeoutAndUA(targetUrl, {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      });
      const xml = await resp.text();
      const items = parseRss(xml);

      const watermark = feedRow?.last_item_at ? new Date(feedRow.last_item_at) : null;
      const filtered = watermark
        ? items.filter(it => it.publishedAt > watermark)
        : items;

      return filtered.map(it => ({
        url: it.url,
        title: it.title,
        abstract: it.abstract,
        publishedAt: it.publishedAt,
        feedId: id,
      }));
    },
  };
}
