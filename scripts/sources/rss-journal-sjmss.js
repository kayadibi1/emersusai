// scripts/sources/rss-journal-sjmss.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalSjmss = createRssSource({
  id: "rss-sjmss",
  name: "Scand J. of Med & Science in Sports",
  url: "https://onlinelibrary.wiley.com/feed/16000838/most-recent",
});
registerDiscovery(rssJournalSjmss);
