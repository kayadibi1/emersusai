// scripts/eval/generate-fixtures.js
//
// Random stratified fixture generator for the retrieval matrix.
//
// Samples articles randomly across multiple dimensions (year bucket,
// publication type, source, impact tier), then for each sampled article
// has an LLM generate ONE query with randomly-assigned style parameters
// (difficulty, format, population angle, length). The target article's
// pmid + its canonical-dedup duplicates become must_include; the top v4
// semantic neighbors that are NOT duplicates become must_exclude.
//
// Stratification keeps the matrix statistically defensible — every stack
// is measured on a representative sample of real-user-query-shaped
// questions, not cherry-picked hard cases.
//
// Usage:
//   node scripts/eval/generate-fixtures.js                        # defaults: 150 fixtures, seed 42
//   node scripts/eval/generate-fixtures.js --count=200 --seed=7
//   node scripts/eval/generate-fixtures.js --out=fixtures/retrieval-v2.json
//
// Output:
//   scripts/eval/fixtures/retrieval-v2.json — array of fixture objects
//   scripts/eval/fixtures/retrieval-v2-metadata.json — run stats (seed,
//     per-bucket counts, difficulty distribution, LLM cost)

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin, openai } from "../../api/lib/clients.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = path.join(__dirname, "fixtures", "retrieval-v2.json");
const META_DEFAULT = path.join(__dirname, "fixtures", "retrieval-v2-metadata.json");

const MODEL = "gpt-4.1-mini";

// ─── Stratification config ───────────────────────────────────────────────────

// Year buckets with target fractions. Weighted to newer research because
// that's what users actually ask about AND what's most thoroughly ingested.
const YEAR_BUCKETS = [
  { label: "pre2000", min: 1960, max: 1999, fraction: 0.08 },
  { label: "2000s",   min: 2000, max: 2009, fraction: 0.14 },
  { label: "2010s",   min: 2010, max: 2019, fraction: 0.33 },
  { label: "2020s",   min: 2020, max: 2030, fraction: 0.45 },
];

// Scope filter: exercise / sports medicine / nutrition. Papers must match
// EITHER (a) at least one MeSH term from SCOPE_MESH, OR (b) at least one
// title substring from SCOPE_TITLE_PATTERNS. (b) catches OpenAlex-sourced
// papers that lack MeSH entirely.
const SCOPE_MESH = new Set([
  "Exercise",
  "Athletic Performance",
  "Sports",
  "Muscle Strength",
  "Resistance Training",
  "Physical Endurance",
  "Physical Fitness",
  "Physical Conditioning, Human",
  "Running",
  "Cycling",
  "Swimming",
  "Weight Lifting",
  "Sports Nutritional Sciences",
  "Exercise Therapy",
  "Exercise Test",
  "Muscle, Skeletal",
  "Dietary Supplements",
  "Energy Metabolism",
  "Body Composition",
  "Nutritional Physiological Phenomena",
  "Muscle Contraction",
  "Muscle Fatigue",
  "Anaerobic Threshold",
  "Oxygen Consumption",
  "Physical Exertion",
  "Hypertrophy",
  "Motor Activity",
  "Recovery of Function",
  "Basketball",
  "Football",
  "Soccer",
]);

const SCOPE_TITLE_PATTERNS = [
  "exercis", "athlet", "sport", "training", "endurance", "strength training",
  "resistance training", "aerobic", "anaerobic", "hypertrophy", "ergogenic",
  "sarcopenia", "creatine", "caffeine", "ingestion", "supplementation",
  "physical performance", "muscle protein", "glycogen", "vo2", "vo₂", "hiit",
  "cardio", "weight training", "powerlifting", "bodybuilding", "runner",
  "cyclist", "swimmer", "rower", "triathlon", "marathon", "sprint", "fatigue",
  "recovery", "post-exercise", "post exercise", "whey", "casein", "bcaa",
  "beta-alanine", "carbohydrate", "ketogenic", "intermittent fasting",
  "periodization", "overtraining", "detraining", "concurrent training",
  "eccentric", "concentric", "plyometric",
];

// Difficulty distribution. Heavy weight on hard/medium so we actually
// measure vocabulary-gap failure modes — the whole point of the matrix.
const DIFFICULTIES = [
  { tag: "easy",      weight: 0.18, desc: "uses the same specific vocabulary as the paper title" },
  { tag: "medium",    weight: 0.27, desc: "uses related scientific terms but not identical" },
  { tag: "hard",      weight: 0.30, desc: "uses BROADER / LAY / DIFFERENT vocabulary that requires the system to bridge the gap" },
  { tag: "applied",   weight: 0.15, desc: "asks a practical dose/timing/protocol question" },
  { tag: "skeptical", weight: 0.10, desc: "frames the topic critically or questioningly" },
];

const FORMATS = [
  { tag: "question",  weight: 0.55, desc: "natural-language question" },
  { tag: "statement", weight: 0.25, desc: "assertion or topic phrase" },
  { tag: "keyword",   weight: 0.20, desc: "bare keyword string" },
];

const POPULATION_ANGLES = [
  { tag: "general",  weight: 0.60, desc: "no specific population" },
  { tag: "subgroup", weight: 0.25, desc: "demographic group (women / older adults / elite / masters / beginners)" },
  { tag: "specific", weight: 0.15, desc: "narrow population (female collegiate swimmers / male masters cyclists / etc.)" },
];

const LENGTHS = [
  { tag: "short",  weight: 0.30, desc: "2-4 words" },
  { tag: "medium", weight: 0.55, desc: "5-10 words" },
  { tag: "long",   weight: 0.15, desc: "11-20 words" },
];

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { count: 150, seed: 42, out: OUT_DEFAULT, meta: META_DEFAULT };
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "count") args.count = Number(v) || 150;
    else if (k === "seed") args.seed = Number(v) || 42;
    else if (k === "out") args.out = v;
    else if (k === "meta") args.meta = v;
  }
  return args;
}

// ─── Deterministic PRNG ──────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(options, rand) {
  const total = options.reduce((a, o) => a + o.weight, 0);
  const r = rand() * total;
  let cum = 0;
  for (const o of options) {
    cum += o.weight;
    if (r <= cum) return o;
  }
  return options[options.length - 1];
}

function shuffle(arr, rand) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── Article sampling ────────────────────────────────────────────────────────

function isScopeRelevant(row) {
  // MeSH match (PubMed papers with MeSH tagging)
  if (Array.isArray(row.mesh_terms) && row.mesh_terms.length > 0) {
    for (const term of row.mesh_terms) {
      if (SCOPE_MESH.has(term)) return true;
    }
    // If this paper has MeSH but none match scope, treat as out-of-scope.
    // Stops strongly-clinical papers with Humans + Male + "Diabetes" MeSH
    // but no exercise MeSH from slipping in via title keyword fuzz.
    return false;
  }
  // Title keyword fallback — for OpenAlex-sourced papers without MeSH
  const title = String(row.title || "").toLowerCase();
  for (const pattern of SCOPE_TITLE_PATTERNS) {
    if (title.includes(pattern)) return true;
  }
  return false;
}

// Pseudo-random sample via random offset-paging within the year bucket. Not
// perfectly uniform (articles ingested earlier skew low-id) but good enough
// for fixture generation — we don't need statistical random, just diverse.
async function sampleBucket(bucket, targetCount, rand) {
  const results = [];
  const seen = new Set();
  let attempt = 0;
  const maxAttempts = 12; // scope filter ~8-15% pass rate, so more attempts needed

  while (results.length < targetCount && attempt < maxAttempts) {
    attempt += 1;
    // Broader offset range so we hit different parts of the bucket across attempts
    const offset = Math.floor(rand() * 60000);
    // Wide window so we get enough scope-relevant hits after filtering
    const windowSize = Math.max(targetCount * 30, 1500);

    const { data, error } = await supabaseAdmin
      .from("research_articles")
      .select("pmid, title, abstract, authors, journal, publication_year, publication_types, mesh_terms, rcr, source, canonical_dedup_key")
      .gte("publication_year", bucket.min)
      .lte("publication_year", bucket.max)
      .eq("is_retracted", false)
      .eq("is_deleted", false)
      .not("abstract", "is", null)
      .range(offset, offset + windowSize - 1);

    if (error) throw new Error(`sampleBucket(${bucket.label}) offset=${offset}: ${error.message}`);

    const filtered = (data || []).filter(
      (r) =>
        r.abstract &&
        r.abstract.length >= 250 &&
        r.title &&
        r.title.length > 10 &&
        !seen.has(r.pmid) &&
        isScopeRelevant(r)
    );
    const shuffled = shuffle(filtered, rand);
    for (const row of shuffled) {
      if (results.length >= targetCount) break;
      if (!seen.has(row.pmid)) {
        seen.add(row.pmid);
        results.push(row);
      }
    }
  }
  return results;
}

async function sampleStratified(totalCount, rand) {
  const buckets = [];
  for (const bucket of YEAR_BUCKETS) {
    const n = Math.round(totalCount * bucket.fraction);
    const rows = await sampleBucket(bucket, n, rand);
    console.log(`  sampled ${rows.length}/${n} for ${bucket.label}`);
    buckets.push({ bucket, rows });
  }
  // Flatten and globally shuffle so LLM calls don't run in year order.
  const flat = buckets.flatMap((b) => b.rows.map((r) => ({ ...r, _year_bucket: b.bucket.label })));
  return shuffle(flat, rand);
}

// ─── Canonical-dedup: find same-paper siblings ───────────────────────────────

async function findSiblings(pmid, canonicalKey) {
  if (!canonicalKey) return [];
  const { data, error } = await supabaseAdmin
    .from("research_articles")
    .select("pmid")
    .eq("canonical_dedup_key", canonicalKey)
    .neq("pmid", pmid)
    .eq("is_retracted", false)
    .eq("is_deleted", false);
  if (error) return [];
  return (data || []).map((r) => Number(r.pmid));
}

// ─── Verify target has content-bearing chunks indexed ────────────────────────

async function hasNonTitleChunks(pmid) {
  const { count, error } = await supabaseAdmin
    .from("evidence_chunks")
    .select("id", { count: "exact", head: true })
    .eq("pmid", pmid)
    .neq("chunk_type", "title");
  if (error) return false;
  return (count || 0) > 0;
}

// ─── LLM query generation ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You generate realistic user search queries for a biomedical / exercise-science retrieval evaluation. Your queries must be plausible things a real user would type into a chat interface — not structured database queries, not paraphrased titles, not LLM-flavored academic prose.

You will be given:
  1. A target paper (title + abstract + metadata)
  2. Style parameters (difficulty, format, population angle, length)

Generate ONE query where the target paper is one of the best papers to surface, matching the style parameters exactly.

DIFFICULTY LEVELS (critical — these control what the retrieval system has to bridge):
  * easy — uses the SAME specific vocabulary that appears in the paper's title or abstract. If the paper title is "Creatine monohydrate and 1RM strength" → "creatine 1RM strength" is easy.
  * medium — uses RELATED scientific terms, synonyms, or slightly broader scope. Paper on "sucrose ingestion during cycling" → "carbohydrate mouth rinse endurance" is medium.
  * hard — uses BROADER / LAY / DIFFERENT vocabulary that has no direct lexical overlap with the paper. This is the vocabulary-gap test. Paper on "13C-labelled glucose-fructose exogenous oxidation in trained cyclists" → "does sugar help endurance athletes" is hard. The query should feel like something a lay user types when they don't know the scientific terminology.
  * applied — asks a practical dose/timing/protocol question the paper could answer. "how much caffeine before strength training", "when to take creatine", "best protein timing".
  * skeptical — critical or questioning framing. "is BCAA actually useful", "does beetroot juice really work", "is HMB just marketing".

FORMATS:
  * question — natural-language question ending with ?
  * statement — assertive topic phrase ("X improves Y")
  * keyword — bare space-separated keywords, no grammar

POPULATION ANGLES:
  * general — no specific population mentioned
  * subgroup — broad demographic (women, older adults, masters athletes, elite, beginners)
  * specific — narrow population (female collegiate swimmers, male masters cyclists, type 2 diabetics, ACL rehab patients)

LENGTHS: short (2-4 words) / medium (5-10) / long (11-20)

RULES:
  * The query must not contain identifying details the user wouldn't know (DOI, year, exact author name, specific sample sizes).
  * The query must NOT be a paraphrase of the paper title — real users don't know the title.
  * Match the length, format, population angle, and difficulty EXACTLY.
  * For difficulty=hard, ensure your query has minimal lexical overlap with the paper title/abstract — force the retrieval system to work.
  * Do NOT include the literal style-tag words in your output. FORBIDDEN in the query itself: "easy", "medium", "hard", "difficulty", "applied", "skeptical", "skepticism", "question", "statement", "keyword", "format", "population", "subgroup", "specific", "general", "short", "long". These are meta-labels describing HOW to write the query, not vocabulary for the query.
  * The query must be directly answerable by the given paper. Do not invent topics the paper does not cover (e.g. if the paper is about blood pressure monitors, do not ask about "breathing exercises" unless breathing is in the paper).

Return STRICT JSON: {"question": "...", "rationale": "one sentence explaining why this query is at the given difficulty"}. No prose outside the JSON.`;

function buildUserPrompt({ paper, difficulty, format, population, length }) {
  const abstract = String(paper.abstract || "").slice(0, 1500);
  const types = Array.isArray(paper.publication_types) ? paper.publication_types.join(", ") : "";
  const mesh = Array.isArray(paper.mesh_terms) ? paper.mesh_terms.slice(0, 10).join(", ") : "";
  return [
    "PAPER:",
    `Title: ${paper.title}`,
    `Journal: ${paper.journal || "unknown"} (${paper.publication_year || "unknown"})`,
    `Publication types: ${types || "unknown"}`,
    `MeSH terms: ${mesh || "none"}`,
    "",
    "Abstract:",
    abstract,
    "",
    "STYLE PARAMS:",
    `  difficulty: ${difficulty.tag} (${difficulty.desc})`,
    `  format: ${format.tag} (${format.desc})`,
    `  population_angle: ${population.tag} (${population.desc})`,
    `  length: ${length.tag} (${length.desc})`,
    "",
    "Generate the query now.",
  ].join("\n");
}

async function generateQuery(paper, rand) {
  const difficulty = weightedPick(DIFFICULTIES, rand);
  const format = weightedPick(FORMATS, rand);
  const population = weightedPick(POPULATION_ANGLES, rand);
  const length = weightedPick(LENGTHS, rand);

  const userPrompt = buildUserPrompt({ paper, difficulty, format, population, length });

  let parsed;
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7, // enough variation across fixtures, not chaotic
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content || "{}";
    parsed = JSON.parse(raw);
    usage = response.usage || usage;
  } catch (err) {
    throw new Error(`LLM gen failed for pmid ${paper.pmid}: ${err.message}`);
  }

  const question = String(parsed.question || "").trim();
  if (!question || question.length < 3 || question.length > 240) {
    throw new Error(`Invalid generated question for pmid ${paper.pmid}: "${question}"`);
  }

  return {
    question,
    rationale: String(parsed.rationale || "").trim(),
    difficulty: difficulty.tag,
    format: format.tag,
    population_angle: population.tag,
    length: length.tag,
    usage,
  };
}

// ─── Retrieve must_exclude candidates (semantic neighbors) ───────────────────

async function embedText(text) {
  const resp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return { embedding: resp.data[0].embedding, tokens: resp.usage?.total_tokens || 0 };
}

async function findMustExclude({ question, mustIncludePmids }) {
  try {
    const { embedding } = await embedText(question);
    const { data, error } = await supabaseAdmin.rpc("match_evidence_chunks_v4", {
      query_embedding: embedding,
      match_threshold: 0.4,
      match_count: 30,
      p_include_preprints: true,
    });
    if (error) return [];
    const includeSet = new Set(mustIncludePmids.map(Number));
    const exclude = [];
    for (const row of data || []) {
      const p = Number(row.pmid);
      if (includeSet.has(p)) continue;
      if (!exclude.includes(p)) exclude.push(p);
      if (exclude.length >= 3) break;
    }
    return exclude;
  } catch {
    return [];
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!openai) throw new Error("OPENAI_API_KEY missing.");
  if (!supabaseAdmin) throw new Error("Supabase admin client missing.");

  const rand = mulberry32(args.seed);
  const t0 = Date.now();

  console.log(`# Generating ${args.count} fixtures (seed=${args.seed})`);
  console.log(`# Year buckets: ${YEAR_BUCKETS.map((b) => `${b.label} (${Math.round(b.fraction * 100)}%)`).join(", ")}`);

  // Oversample so rejections (no non-title chunks, LLM parse failures) don't
  // push the final count below target.
  const oversample = Math.ceil(args.count * 1.4);
  console.log(`\n# Sampling ${oversample} candidates (1.4× target to absorb rejections)`);
  const candidates = await sampleStratified(oversample, rand);
  console.log(`# Got ${candidates.length} candidate articles`);

  const fixtures = [];
  const meta = {
    seed: args.seed,
    target_count: args.count,
    generated_at: new Date().toISOString(),
    year_bucket_distribution: {},
    difficulty_distribution: {},
    format_distribution: {},
    population_distribution: {},
    length_distribution: {},
    llm_cost_usd: 0,
    llm_tokens_in: 0,
    llm_tokens_out: 0,
    rejections: { no_chunks: 0, llm_fail: 0, duplicate_question: 0 },
  };

  const seenQuestions = new Set();

  for (const paper of candidates) {
    if (fixtures.length >= args.count) break;

    // Filter: target must have content-bearing chunks.
    const hasContent = await hasNonTitleChunks(paper.pmid);
    if (!hasContent) {
      meta.rejections.no_chunks += 1;
      continue;
    }

    // LLM generate
    let gen;
    try {
      gen = await generateQuery(paper, rand);
    } catch (err) {
      meta.rejections.llm_fail += 1;
      console.warn(`  skip pmid=${paper.pmid}: ${err.message}`);
      continue;
    }

    // Dedup questions — LLM occasionally produces identical queries for
    // similar papers, which would give misleading matrix signal.
    const qKey = gen.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenQuestions.has(qKey)) {
      meta.rejections.duplicate_question += 1;
      continue;
    }
    seenQuestions.add(qKey);

    // Find canonical-dedup siblings
    const siblings = await findSiblings(paper.pmid, paper.canonical_dedup_key);
    const mustInclude = [Number(paper.pmid), ...siblings];

    // Find must_exclude via semantic neighbors
    const mustExclude = await findMustExclude({ question: gen.question, mustIncludePmids: mustInclude });

    fixtures.push({
      question: gen.question,
      must_include_pmids: mustInclude,
      must_exclude_pmids: mustExclude,
      metadata: {
        difficulty: gen.difficulty,
        format: gen.format,
        population_angle: gen.population_angle,
        length: gen.length,
        year_bucket: paper._year_bucket,
        target_pmid: Number(paper.pmid),
        target_title: paper.title,
        target_year: paper.publication_year,
        target_source: paper.source,
        target_rcr: paper.rcr,
        sibling_count: siblings.length,
        rationale: gen.rationale,
      },
    });

    // Accumulate stats
    const inc = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
    inc(meta.year_bucket_distribution, paper._year_bucket);
    inc(meta.difficulty_distribution, gen.difficulty);
    inc(meta.format_distribution, gen.format);
    inc(meta.population_distribution, gen.population_angle);
    inc(meta.length_distribution, gen.length);
    meta.llm_tokens_in += gen.usage.prompt_tokens || 0;
    meta.llm_tokens_out += gen.usage.completion_tokens || 0;

    if (fixtures.length % 10 === 0 || fixtures.length === args.count) {
      console.log(`  [${fixtures.length}/${args.count}] ${gen.difficulty.padEnd(9)} ${gen.format.padEnd(9)} "${gen.question.slice(0, 80)}"`);
    }
  }

  meta.llm_cost_usd = Number(
    (
      (meta.llm_tokens_in / 1_000_000) * 0.40 +
      (meta.llm_tokens_out / 1_000_000) * 1.60
    ).toFixed(4)
  );
  meta.wall_time_sec = Number(((Date.now() - t0) / 1000).toFixed(1));
  meta.final_count = fixtures.length;

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(fixtures, null, 2));
  await fs.writeFile(args.meta, JSON.stringify(meta, null, 2));

  console.log(`\n# Generated ${fixtures.length} fixtures in ${meta.wall_time_sec}s`);
  console.log(`# Cost: $${meta.llm_cost_usd.toFixed(4)} (${meta.llm_tokens_in} in + ${meta.llm_tokens_out} out)`);
  console.log(`# Rejections: ${JSON.stringify(meta.rejections)}`);
  console.log(`# Year buckets: ${JSON.stringify(meta.year_bucket_distribution)}`);
  console.log(`# Difficulty:   ${JSON.stringify(meta.difficulty_distribution)}`);
  console.log(`# Format:       ${JSON.stringify(meta.format_distribution)}`);
  console.log(`# Population:   ${JSON.stringify(meta.population_distribution)}`);
  console.log(`# Length:       ${JSON.stringify(meta.length_distribution)}`);
  console.log(`# Fixtures: ${args.out}`);
  console.log(`# Metadata: ${args.meta}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
