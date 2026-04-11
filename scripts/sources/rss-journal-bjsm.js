// scripts/sources/rss-journal-bjsm.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalBjsm = createRssSource({
  id: "rss-bjsm",
  name: "British Journal of Sports Medicine TOC",
  url: "https://bjsm.bmj.com/rss/current.xml",
});
registerDiscovery(rssJournalBjsm);
