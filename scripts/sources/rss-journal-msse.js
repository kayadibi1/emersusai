// scripts/sources/rss-journal-msse.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalMsse = createRssSource({
  id: "rss-msse",
  name: "Medicine & Science in Sports & Exercise",
  url: "https://journals.lww.com/acsm-msse/toc/rss",
});
registerDiscovery(rssJournalMsse);
