// scripts/sources/rss-journal-ejap.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalEjap = createRssSource({
  id: "rss-ejap",
  name: "European J. of Applied Physiology",
  url: "https://link.springer.com/search.rss?facet-journal-id=421",
});
registerDiscovery(rssJournalEjap);
