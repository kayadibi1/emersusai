// scripts/sources/rss-mass.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssMass = createRssSource({
  id: "rss-mass",
  name: "MASS Research Review",
  url: "https://www.strongerbyscience.com/mass/feed/",
});
registerDiscovery(rssMass);
