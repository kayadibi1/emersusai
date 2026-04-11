// scripts/sources/rss-journal-sportsmed.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalSportsmed = createRssSource({
  id: "rss-sportsmed",
  name: "Sports Medicine (Adis)",
  url: "https://link.springer.com/search.rss?facet-journal-id=40279",
});
registerDiscovery(rssJournalSportsmed);
