export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed." });
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      message: "Missing public Supabase environment variables.",
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    mapboxPublicToken: process.env.MAPBOX_PUBLIC_TOKEN || null,
    // Marketing-display corpus stats. Operator overrides via env var when
    // the figures move; otherwise falls back to the figures used on the
    // public landing page.
    corpus_papers: Number(process.env.EMERSUS_CORPUS_PAPERS) || 1041448,
    corpus_topics: Number(process.env.EMERSUS_CORPUS_TOPICS) || 302,
  });
}
