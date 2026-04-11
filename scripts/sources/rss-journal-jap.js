// scripts/sources/rss-journal-jap.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalJap = createRssSource({
  id: "rss-jap",
  name: "Journal of Applied Physiology",
  url: "https://journals.physiology.org/action/showFeed?type=etoc&feed=rss&jc=jappl",
});
registerDiscovery(rssJournalJap);
