// scripts/sources/rss-journal-ijspp.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalIjspp = createRssSource({
  id: "rss-ijspp",
  name: "Int'l J. of Sports Physiology & Perf",
  url: "https://journals.humankinetics.com/rss/updates/IJSPP",
});
registerDiscovery(rssJournalIjspp);
