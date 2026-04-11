// scripts/seed-discovery-feeds.js
// One-shot idempotent seed: inserts the initial set of discovery feeds
// (academic TOC + preprint + practitioner RSS). Re-running is safe and
// will not overwrite operator edits to `status`.
import "dotenv/config";
import pg from "pg";

export const INITIAL_FEEDS = [
  // --- Preprint servers (double as ingestion sources) ---
  { id: "biorxiv-physiology",   name: "BioRxiv — Physiology",          kind: "api", url: "https://api.biorxiv.org/details/biorxiv/physiology",          source_plugin: "biorxiv" },
  { id: "biorxiv-neuroscience", name: "BioRxiv — Neuroscience",        kind: "api", url: "https://api.biorxiv.org/details/biorxiv/neuroscience",        source_plugin: "biorxiv" },
  { id: "biorxiv-pharmacology", name: "BioRxiv — Pharmacology & Tox.", kind: "api", url: "https://api.biorxiv.org/details/biorxiv/pharmacology%20and%20toxicology", source_plugin: "biorxiv" },
  { id: "medrxiv-nutrition",    name: "medRxiv — Nutrition",           kind: "api", url: "https://api.biorxiv.org/details/medrxiv/nutrition",           source_plugin: "medrxiv" },
  { id: "medrxiv-rehab",        name: "medRxiv — Rehab Medicine",      kind: "api", url: "https://api.biorxiv.org/details/medrxiv/rehabilitation%20medicine%20and%20physical%20therapy", source_plugin: "medrxiv" },
  { id: "medrxiv-sportsmed",    name: "medRxiv — Sports Medicine",     kind: "api", url: "https://api.biorxiv.org/details/medrxiv/sports%20medicine",   source_plugin: "medrxiv" },
  { id: "sportrxiv-all",        name: "SportRxiv — all",               kind: "api", url: "https://api.osf.io/v2/preprints/?filter[provider]=sportrxiv", source_plugin: "sportrxiv" },

  // --- Journal TOC RSS ---
  { id: "rss-bjsm",       name: "British Journal of Sports Medicine TOC", kind: "rss", url: "https://bjsm.bmj.com/rss/current.xml",                             source_plugin: "rss-journal-bjsm" },
  { id: "rss-jscr",       name: "JSCR TOC",                               kind: "rss", url: "https://journals.lww.com/nsca-jscr/toc/rss",                       source_plugin: "rss-journal-jscr" },
  { id: "rss-msse",       name: "Medicine & Science in Sports & Exercise",kind: "rss", url: "https://journals.lww.com/acsm-msse/toc/rss",                       source_plugin: "rss-journal-msse" },
  { id: "rss-ijspp",      name: "Int'l J. of Sports Physiology & Perf",   kind: "rss", url: "https://journals.humankinetics.com/rss/updates/IJSPP",             source_plugin: "rss-journal-ijspp" },
  { id: "rss-jap",        name: "Journal of Applied Physiology",          kind: "rss", url: "https://journals.physiology.org/action/showFeed?type=etoc&feed=rss&jc=jappl", source_plugin: "rss-journal-jap" },
  { id: "rss-sportsmed",  name: "Sports Medicine (Adis)",                 kind: "rss", url: "https://link.springer.com/search.rss?facet-journal-id=40279",       source_plugin: "rss-journal-sportsmed" },
  { id: "rss-sjmss",      name: "Scand J. of Med & Science in Sports",    kind: "rss", url: "https://onlinelibrary.wiley.com/feed/16000838/most-recent",         source_plugin: "rss-journal-sjmss" },
  { id: "rss-ejap",       name: "European J. of Applied Physiology",      kind: "rss", url: "https://link.springer.com/search.rss?facet-journal-id=421",        source_plugin: "rss-journal-ejap" },

  // --- Practitioner ---
  { id: "rss-sbs",         name: "Stronger By Science",     kind: "rss", url: "https://www.strongerbyscience.com/feed/",             source_plugin: "rss-sbs" },
  { id: "rss-suppversity", name: "SuppVersity",             kind: "rss", url: "https://suppversity.blogspot.com/feeds/posts/default",source_plugin: "rss-suppversity" },
  { id: "rss-mass",        name: "MASS Research Review",    kind: "rss", url: "https://www.strongerbyscience.com/mass/feed/",        source_plugin: "rss-mass" },
  { id: "rss-sfs",         name: "Science For Sport",       kind: "rss", url: "https://www.scienceforsport.com/feed/",               source_plugin: "rss-sfs" },
  { id: "rss-nsca",        name: "NSCA blog",               kind: "rss", url: "https://www.nsca.com/rss/articles/",                   source_plugin: "rss-nsca" },
  { id: "rss-acsm",        name: "ACSM blog",               kind: "rss", url: "https://www.acsm.org/rss",                            source_plugin: "rss-acsm" },
];

export async function seedDiscoveryFeeds({ databaseUrl }) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  let updated = 0;
  try {
    for (const f of INITIAL_FEEDS) {
      const res = await client.query(
        `INSERT INTO public.discovery_feeds (id, name, kind, url, source_plugin)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               kind = EXCLUDED.kind,
               url = EXCLUDED.url,
               source_plugin = EXCLUDED.source_plugin,
               updated_at = now()
         RETURNING xmax = 0 AS was_insert`,
        [f.id, f.name, f.kind, f.url, f.source_plugin]
      );
      if (res.rows[0].was_insert) inserted++;
      else updated++;
    }
  } finally {
    await client.end();
  }
  return { inserted, updated, total: INITIAL_FEEDS.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
  const r = await seedDiscoveryFeeds({ databaseUrl });
  console.log(`seeded: ${r.inserted} inserted, ${r.updated} updated, ${r.total} total`);
}
