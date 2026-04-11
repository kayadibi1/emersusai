// scripts/sources/rss-acsm.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssAcsm = createRssSource({
  id: "rss-acsm",
  name: "ACSM blog",
  url: "https://www.acsm.org/rss",
});
registerDiscovery(rssAcsm);
