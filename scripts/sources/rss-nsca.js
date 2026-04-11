// scripts/sources/rss-nsca.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssNsca = createRssSource({
  id: "rss-nsca",
  name: "NSCA blog",
  url: "https://www.nsca.com/rss/articles/",
});
registerDiscovery(rssNsca);
