// api/config.js
// Public config endpoint — also carries live corpus stats for the
// landing-page "What's indexed right now" block.
//
// Corpus stats come from a shared pg.Pool against the public schema.
// Values are cached in-process for 5 minutes so the landing page's
// on-load fetch doesn't hammer the DB under traffic bursts.
//
// Env overrides EMERSUS_CORPUS_PAPERS / EMERSUS_CORPUS_TOPICS still
// win for marketing moments when you want to pin a specific number
// (e.g., freezing figures around a launch). Unset = live.

import pg from "pg";

const CACHE_TTL_MS = 5 * 60_000;
let cache = { fetchedAt: 0, value: null };

let _pool = null;
function pool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  _pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

async function loadLiveStats() {
  const p = pool();
  if (!p) return null;
  try {
    // Use pg_class.reltuples for papers count — avoids a parallel seq
    // scan of 1.2M rows on every cache miss. reltuples is maintained by
    // autovacuum/ANALYZE and is accurate to within a few %.
    const [papersRes, topicsRes, sourcesRes] = await Promise.all([
      p.query(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'research_articles'`),
      p.query(`SELECT count(*)::int AS n FROM research_topics WHERE status = 'active'`),
      p.query(`SELECT source, count(*)::int AS n FROM research_articles GROUP BY source ORDER BY n DESC`),
    ]);
    return {
      papers: Number(papersRes.rows[0]?.n ?? 0),
      topics: Number(topicsRes.rows[0]?.n ?? 0),
      sources: sourcesRes.rows.map((r) => ({ id: r.source, count: Number(r.n) })),
    };
  } catch {
    return null;
  }
}

async function getCorpusStats() {
  const now = Date.now();
  if (cache.value && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const live = await loadLiveStats();
  if (live) {
    cache = { fetchedAt: now, value: live };
    return live;
  }
  // Leave previous cache in place if the fetch failed — better a
  // stale-but-plausible value than zeros.
  return cache.value ?? { papers: null, topics: null, sources: null };
}

// Keep the corpus-stats cache pre-filled and the pg.Pool connection warm.
// Without this, the first visitor after pool idleTimeout (30s) pays a
// ~3s cold-start tax while PG reopens. Fires immediately at boot, then
// every 2 minutes — inside the 5-minute cache TTL so a visitor never
// lands on an expired bucket.
const WARM_INTERVAL_MS = 2 * 60_000;
let warmTimer = null;
export function startConfigWarmer() {
  if (warmTimer) return;
  const tick = () => {
    getCorpusStats().catch(() => {});
  };
  // First tick shortly after boot so it doesn't race env-var validation.
  setTimeout(tick, 100);
  warmTimer = setInterval(tick, WARM_INTERVAL_MS);
  if (warmTimer.unref) warmTimer.unref();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  // supabaseAnonKey is the PUBLIC anonymous key (RLS-gated), not the
  // service-role key. Safe to ship to the browser — never replace this
  // with SUPABASE_SERVICE_ROLE_KEY.
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: "Missing public Supabase environment variables.",
    });
  }

  const stats = await getCorpusStats();
  const envPapers = Number(process.env.EMERSUS_CORPUS_PAPERS) || null;
  const envTopics = Number(process.env.EMERSUS_CORPUS_TOPICS) || null;

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    mapboxPublicToken: process.env.MAPBOX_PUBLIC_TOKEN || null,
    // Live corpus figures with env override + hardcoded fallback.
    // Env vars win (marketing pins); else live DB; else a sane default.
    corpus_papers: envPapers ?? stats.papers ?? 1041448,
    corpus_topics: envTopics ?? stats.topics ?? 302,
    corpus_sources: stats.sources,
  });
}
