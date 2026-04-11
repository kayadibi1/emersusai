// scripts/sources/rss-sbs.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssSbs = createRssSource({
  id: "rss-sbs",
  name: "Stronger By Science",
  url: "https://www.strongerbyscience.com/feed/",
});
registerDiscovery(rssSbs);
