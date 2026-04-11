// scripts/sources/rss-sfs.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssSfs = createRssSource({
  id: "rss-sfs",
  name: "Science For Sport",
  url: "https://www.scienceforsport.com/feed/",
});
registerDiscovery(rssSfs);
