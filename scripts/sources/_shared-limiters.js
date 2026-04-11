// scripts/sources/_shared-limiters.js
// Shared rate limiters for sources that hit the same upstream infra.
// biorxiv and medrxiv both go through api.biorxiv.org — they share a
// single 1 RPS budget so the two adapters don't interleave and exceed it.
import { createLimiter } from "./_ratelimit.js";
export const biorxivLimiter = createLimiter(1);
