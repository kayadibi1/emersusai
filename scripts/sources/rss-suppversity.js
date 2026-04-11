// scripts/sources/rss-suppversity.js
import { createRssSource } from "./rss-generic.js";
import { registerDiscovery } from "./_registry.js";

export const rssSuppversity = createRssSource({
  id: "rss-suppversity",
  name: "SuppVersity",
  url: "https://suppversity.blogspot.com/feeds/posts/default",
});
registerDiscovery(rssSuppversity);
