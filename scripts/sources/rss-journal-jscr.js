// scripts/sources/rss-journal-jscr.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssJournalJscr = createRssSource({
  id: "rss-jscr",
  name: "JSCR TOC",
  url: "https://journals.lww.com/nsca-jscr/toc/rss",
});
registerDiscovery(rssJournalJscr);
