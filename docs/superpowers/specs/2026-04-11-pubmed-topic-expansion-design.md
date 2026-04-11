# PubMed topic expansion + query refinement

**Date:** 2026-04-11
**Status:** Draft → pending user review
**Scope:** Add ~86 new PubMed search topics to `scripts/fill-pmc-topics.js`, reorganize the existing 121 topics into domain-grouped sections, refine 40–60 existing queries that are too narrow, ship a new `scripts/validate-pubmed-queries.js` helper, and inform the topic selection via a one-off web research pass across Reddit, YouTube, research blogs, and preprint servers.

**Non-scope:** Building a standing topic-discovery pipeline (Interpretation B from the brainstorming session) is explicitly deferred to a separate spec. This spec is a one-session deliverable.

---

## 1. Context

`scripts/fill-pmc-topics.js` drives corpus ingestion by iterating a `DEFAULT_TOPIC_ORDER` array of ~121 topic keys, looking each up in a `TOPIC_QUERIES` map, and delegating to `scripts/fill-pmc-corpus.js` to run the PubMed search and pull papers. The current list was built incrementally over the project's history and has three problems worth addressing in one pass:

1. **Coverage gaps.** Several exercise-science domains are missing or underrepresented: women's health / female physiology, youth athletes / long-term athletic development, masters (40+), injury rehab / return to play, endurance specialization, advanced programming methodologies, sport-specific technique, mental / behavioral science, nutrition subfields, metabolic health / longevity, and mobility / movement prep.
2. **Query narrowness.** Roughly a third of the existing queries are of the form `"<core> AND <context>"` with no OR expansion, missing common synonyms and MeSH canonical forms (`creatine: "creatine AND resistance training"` misses `phosphocreatine`, `"creatine monohydrate"`, `hypertrophy`, `"exercise performance"`).
3. **Flat file layout.** 121 keys in a single undifferentiated array is already hard to navigate; adding ~80 more makes it painful.

Clinical populations + exercise (diabetes, cardiovascular disease, osteoporosis, etc.) was explicitly excluded from the new domains during brainstorming — Emersus is scoped to healthy athletes and the guardrail locks the chat to exercise science, not medical advice.

## 2. Deliverables

Two committed files, one throwaway script, and one generated research artifact:

- **`scripts/fill-pmc-topics.js`** (committed, edited in place) — reorganized into 20 domain-grouped sections; retrofits all 121 existing topics into their natural domains; adds ~86 new topics; refines 40–60 too-narrow existing queries.
- **`scripts/validate-pubmed-queries.js`** (new, committed) — thin helper that reads `TOPIC_QUERIES` and calls PubMed eutils `/esearch` at the 3 req/sec rate limit to report a pass/warn/fail table per query. Reusable for future query additions, used in-session to satisfy Gate 2 of the validation plan (Section 6.2).
- **`scripts/research-topic-candidates.js`** (throwaway, not committed) — the one-off crawler + classifier. Deleted after the research pass runs. Its design choices seed Interpretation B if/when that spec is written.
- **`data/research/topic-candidates-2026-04-11.jsonl`** (generated, not committed) — output of the one-off research pass. Used to inform the topic selection and then archived or deleted at the author's discretion.

**Explicit non-deliverables:**

- No `fill:pmc:topics` run in this session — ingestion is kicked off by the operator when ready.
- No new embedding generation.
- No DB migrations, no schema changes, no new columns.
- No renaming or deletion of existing topic keys (zero behavior change for existing `--topics=creatine` etc. invocations).

## 3. Section 1 — Research pass (one-off)

A throwaway `scripts/research-topic-candidates.js` fetches a curated set of high-signal exercise-science sources, runs each snippet through an LLM classifier, aggregates candidate topics by frequency, subtracts topics already covered by the existing 121, and writes the gap candidates to `data/research/topic-candidates-2026-04-11.jsonl`. The author reads the top ~100 candidates and merges relevant ones into the Section 2 topic list before committing the edit to `scripts/fill-pmc-topics.js`.

### 3.1 Sources

**Reddit** (public `.json` endpoints, no auth, 1 req/sec, identifying User-Agent):

- Original 12: `r/AdvancedFitness`, `r/weightroom`, `r/hypertrophy`, `r/AdvancedRunning`, `r/running`, `r/triathlon`, `r/climbharder`, `r/bodyweightfitness`, `r/powerlifting`, `r/xxfitness`, `r/Stronglifts5x5`, `r/GYM`
- Generalist / high-volume: `r/Fitness`, `r/Supplements`, `r/ScientificNutrition`, `r/nutrition`
- Sport-specific: `r/bodybuilding`, `r/naturalbodybuilding`, `r/weightlifting`, `r/olympicweightlifting`, `r/bjj`, `r/martialarts`, `r/Swimming`, `r/cycling`, `r/Velo`, `r/Ultramarathon`, `r/bouldering`, `r/Rowing`, `r/MTB`
- Topic / population: `r/Perimenopause`, `r/AskPhysicalTherapy`, `r/Tendinopathy`, `r/intermittentfasting`, `r/nootropics`

Per sub, fetch `/top.json?t=year&limit=100` and `/hot.json?limit=100`, dedupe by thread ID, then `/comments/{id}.json` for each unique thread to get selftext + top 3 comment bodies. Target: ~2,500 unique Reddit text snippets total after dedupe.

**YouTube Data API v3** (API key only, 10,000 unit daily quota):

Avoids `search.list` (100 units/call) entirely. Uses the cheap path: `channels.list?forHandle=@<handle>&part=contentDetails` → extract `uploads` playlist ID → `playlistItems.list?playlistId=UU...&part=snippet&maxResults=50` with pagination for ~250 videos per channel. Cost: ~6 units per channel × 16 channels = ~100 units per run (1% of daily quota).

Channels (evidence-dense, minimal influencer noise):

1. Jeff Nippard — hypertrophy evidence synthesis
2. Renaissance Periodization (Mike Israetel)
3. Stronger By Science
4. Squat University — rehab/mobility
5. Barbell Medicine — MD-run, strength + medicine
6. Starting Strength — classic strength
7. N1 Training (Kassem Hanson) — biomechanics
8. Eugene Teo — evidence-based hypertrophy
9. Iron Culture (Omar Isuf)
10. Biolayne (Layne Norton)
11. The Movement System — running + rehab
12. GMB Fitness — mobility + bodyweight
13. Lattice Training — climbing performance
14. Global Cycling Network (GCN)
15. Global Triathlon Network (GTN)
16. Athletic Truth Group — return-to-sport

Extract `snippet.title`, `snippet.description`, `snippet.publishedAt`. Target: ~3,000 video snippets after dedupe.

**Research blogs + podcast feeds** (public RSS):

- Stronger By Science (blog)
- Barbell Medicine (blog + podcast)
- Renaissance Periodization free articles
- Starting Strength (articles + podcast)
- MASS Research Review public summary pages only
- Sigma Nutrition Radio (podcast episode descriptions)
- Iron Culture (podcast)
- Huberman Lab (podcast — filter to exercise/nutrition/sleep episodes only, skip neuroscience)
- The Proof (Simon Hill, nutrition podcast)

Target: ~800 blog + podcast snippets.

**Magazines / feature sites** (public RSS):

- Outside Online — training section
- Runner's World — science of running
- Triathlete Magazine — training
- Velo News / CyclingTips — training / science
- SwimSwam — training articles

Target: ~300 article snippets.

**Preprint server** (BioRxiv):

- Physiology / sports-exercise-science collection via RSS feed — recent preprint titles + abstracts

Target: ~200 preprint snippets.

**Total raw snippets:** ~6,800. After dedupe and language filtering (English only): ~6,000.

### 3.2 Classifier pipeline

1. Batch snippets through `gpt-5-mini` (cheap model) 50 at a time with a JSON-mode classifier prompt returning:
   ```json
   {
     "is_exercise_science": true|false,
     "topic_label": "short_snake_case_key",
     "confidence": 0.0-1.0,
     "one_line_summary": "..."
   }
   ```
2. Filter `is_exercise_science == true` AND `confidence >= 0.6`.
3. Group by `topic_label` with fuzzy match (normalize punctuation/stopwords, ≥0.85 Jaccard on bigrams). Count occurrences.
4. Subtract the existing 121 topics via the same fuzzy match — anything already covered falls out.
5. Sort by descending frequency. Write top 200 candidates to `data/research/topic-candidates-2026-04-11.jsonl` with:
   ```json
   {
     "topic_label": "...",
     "count": 27,
     "example_titles": ["...", "...", "..."],
     "suggested_pubmed_query": "...",
     "source_distribution": { "reddit": 15, "youtube": 8, "blog": 4 }
   }
   ```

### 3.3 Costs

- ~6,000 snippets × ~400 tokens/snippet = 2.4M input tokens × `gpt-5-mini` ≈ **$0.45**
- YouTube API: ~100 units of 10,000 daily quota
- Reddit / RSS / BioRxiv: free, rate-limited to 1 req/sec polite
- Wall time: ~30–45 minutes

### 3.4 Credential handling

- YouTube API key goes in `~/app/.env` on Hetzner as `YOUTUBE_API_KEY=AIza...`, same pattern as the S2 key
- Key is never echoed in summaries, committed to git, or written to memory files
- The throwaway research script reads it via `process.env.YOUTUBE_API_KEY`

## 4. Section 2 — Topic list expansion

### 4.1 File structure after edit

`scripts/fill-pmc-topics.js` grows from ~510 lines to ~680–720 lines. Structure:

```js
const DEFAULT_TOPIC_ORDER = [
  // ══ EXISTING DOMAINS (121 topics retrofitted) ══

  // ── 1. Core resistance training ──
  // ── 2. Endurance & cardiovascular ──
  // ── 3. Body composition & general nutrition ──
  // ── 4. Supplements — performance ──
  // ── 5. Supplements — peptides & research compounds ──
  // ── 6. Supplements — hormones, adaptogens, micronutrients ──
  // ── 7. Recovery, sleep, stress ──
  // ── 8. Exercise selection & execution ──
  // ── 9. Programming basics ──

  // ══ NEW DOMAINS (~82 new topics) ══

  // ── 10. Women's health / female physiology ──
  // ── 11. Youth / LTAD ──
  // ── 12. Masters (40+) ──
  // ── 13. Injury rehab / return to play ──
  // ── 14. Endurance specialization ──
  // ── 15. Advanced programming ──
  // ── 16. Sport-specific technique / conditioning ──
  // ── 17. Mental / behavioral ──
  // ── 18. Nutrition subfields ──
  // ── 19. Metabolic health / longevity ──
  // ── 20. Mobility / movement prep ──
];
```

### 4.2 New topic allocation (target ~86)

| Section | Target topics | Example keys |
|---|---|---|
| 10. Women's health | 9 | `menstrual_cycle_training`, `perimenopause_training`, `postmenopause_training`, `pregnancy_exercise`, `postpartum_return_to_training`, `pcos_and_exercise`, `low_energy_availability`, `hormonal_contraception_training`, `female_strength_norms` |
| 11. Youth / LTAD | 7 | `youth_resistance_training`, `peak_height_velocity`, `long_term_athletic_development`, `youth_endurance_training`, `growth_plate_safety`, `early_specialization`, `physical_literacy` |
| 12. Masters (40+) | 7 | `sarcopenia`, `strength_training_older_adults`, `vo2_max_preservation`, `bone_density_exercise`, `balance_fall_prevention`, `masters_endurance_training`, `recovery_older_athletes` |
| 13. Injury rehab / RTP | 10 | `acl_rehab`, `rotator_cuff_rehab`, `low_back_rehab`, `achilles_tendinopathy`, `patellar_tendinopathy`, `tennis_elbow_rehab`, `hamstring_strain_rehab`, `concussion_return_to_play`, `tendinopathy_loading`, `pain_science_exercise` |
| 14. Endurance specialization | 9 | `marathon_training`, `triathlon_training`, `cycling_training`, `altitude_training`, `polarized_training`, `pyramidal_training`, `race_tapering`, `heat_acclimation`, `cold_water_immersion_endurance` |
| 15. Advanced programming | 9 | `block_periodization`, `conjugate_method`, `bulgarian_method`, `autoregulation_rpe_rir`, `daily_undulating_periodization`, `peaking_for_competition`, `accumulation_intensification`, `mesocycle_design`, `microcycle_design` |
| 16. Sport-specific | 9 | `running_gait_mechanics`, `swimming_stroke_mechanics`, `climbing_finger_strength`, `climbing_forearm_endurance`, `bjj_conditioning`, `martial_arts_weight_cuts`, `olympic_lifting_technique`, `rowing_mechanics`, `sprint_mechanics` |
| 17. Mental / behavioral | 7 | `exercise_adherence`, `gym_anxiety`, `body_image_training`, `goal_setting_fitness`, `self_efficacy_exercise`, `training_burnout`, `habit_formation_exercise` |
| 18. Nutrition subfields | 6 | `vegan_athlete_nutrition`, `intermittent_fasting_performance`, `keto_endurance`, `ultra_endurance_fueling`, `protein_quality_sources`, `meal_frequency_body_composition` |
| 19. Metabolic health / longevity | 7 | `cgm_exercise_response`, `vo2_max_longevity`, `strength_mortality`, `muscle_mass_longevity`, `metabolic_flexibility`, `grip_strength_predictor`, `exercise_lifespan` |
| 20. Mobility / movement prep | 6 | `dynamic_warmup_protocols`, `static_stretching_performance`, `pnf_stretching`, `foam_rolling_smr`, `movement_screens`, `joint_mobility_drills` |

**Total: ~86 new topics.** Final count may shift ±10 based on research pass output: if the research pass surfaces a cluster I didn't anticipate (e.g., "indoor trainer structured work" on r/cycling), it gets added before commit. If a topic I listed turns out to have no meaningful PubMed corpus (e.g., very new method names), it gets dropped with a brief comment noting why.

Long descriptive `snake_case` names are used throughout, matching the existing file's convention. Some names are deliberately verbose (`strength_training_older_adults`) for self-documentation.

### 4.3 Query format for new topics

Every new `DEFAULT_TOPIC_ORDER` entry gets a corresponding entry in `TOPIC_QUERIES`. Pattern:

```
(<core-term> OR <synonym-1> OR <synonym-2> OR <MeSH-canonical>) AND
(<context-1> OR <context-2> OR <outcome-term>)
```

Reference examples:

```js
menstrual_cycle_training:
  "(\"menstrual cycle\" OR luteal OR follicular OR \"menstrual phase\" OR \"ovarian hormones\") AND (\"resistance training\" OR strength OR endurance OR \"exercise performance\" OR \"athletic performance\")",

acl_rehab:
  "(\"anterior cruciate ligament\" OR ACL) AND (reconstruction OR rehabilitation OR \"return to sport\" OR \"return to play\" OR prehabilitation)",

polarized_training:
  "(\"polarized training\" OR \"polarised training\" OR \"80/20 training\" OR \"training intensity distribution\") AND (endurance OR running OR cycling OR \"VO2 max\" OR performance)",

cgm_exercise_response:
  "(\"continuous glucose monitoring\" OR CGM OR \"glucose dynamics\" OR \"glycemic response\") AND (exercise OR \"resistance training\" OR endurance OR athletes)",
```

### 4.4 Retrofit of existing topics into domain sections

All 121 existing topic keys get moved into their natural domain section. No renames, no query changes as part of this retrofit (query changes are handled separately in Section 3). Reordering changes the default processing order when `fill:pmc:topics` is run without `--topics=`, but since the script is idempotent and filtered by `s2_checked_at IS NULL`-style gates downstream, reordering has no correctness impact — only which topics get filled first on a fresh run.

## 5. Section 3 — Existing query refinement

### 5.1 Refinement criteria

Refine a query if it matches any of:

- **Two-term `A AND B` shape with no OR expansion** — `creatine: "creatine AND resistance training"`, `protein: "protein intake AND hypertrophy"`, `sleep: "sleep AND athletic recovery"`, `caffeine: "caffeine AND exercise performance"`
- **Missing obvious synonyms or MeSH canonical forms** — e.g., `creatine` missing `phosphocreatine` and `"creatine monohydrate"`; `protein` missing `"muscle protein synthesis"` and `"dietary protein"`
- **Missing context / outcome terms** — e.g., `sleep` missing `"sleep deprivation"`, `"sleep extension"`, `"sleep quality"`
- **Multi-word phrases not quoted** — e.g., `running economy` instead of `"running economy"`

### 5.2 Leave-alone criteria

Skip refinement if the query matches any of:

- Already has ≥3 OR-expanded terms per clause
- Already uses MeSH synonyms or quoted phrases
- Has multi-clause boolean structure with explicit grouping
- Examples that are already good: `strength: "strength training OR maximal strength OR resistance training adaptation"`, `body_recomposition: "\"body recomposition\" OR ((fat loss OR fat mass) AND (lean mass OR muscle mass) AND resistance training)"`, `fat_loss: "fat loss AND body composition AND resistance training"`

### 5.3 Estimated refinement count

Roughly **40–60 of the 116 unique queries** will be refined. Final count determined in situ — if a query looks borderline, I err on the side of refining it.

### 5.4 Refinement pattern

```
(<core> OR <synonym-1> OR <synonym-2> OR <MeSH-canonical>) AND
(<context-1> OR <context-2> OR <outcome>)
```

Three reference before/after pairs (same format as Section 2.3):

```diff
- creatine: "creatine AND resistance training",
+ creatine: "(creatine OR \"creatine monohydrate\" OR phosphocreatine) AND
+           (\"resistance training\" OR strength OR hypertrophy OR \"exercise performance\")",

- protein: "protein intake AND hypertrophy",
+ protein: "(\"protein intake\" OR \"dietary protein\" OR \"protein supplementation\" OR \"whey protein\") AND
+          (hypertrophy OR \"muscle protein synthesis\" OR \"lean mass\" OR \"resistance training\")",

- sleep: "sleep AND athletic recovery",
+ sleep: "(sleep OR \"sleep duration\" OR \"sleep quality\" OR \"sleep deprivation\" OR \"sleep extension\") AND
+        (\"athletic recovery\" OR \"exercise performance\" OR \"muscle protein synthesis\" OR \"muscle recovery\")",
```

### 5.5 Non-goals for query refinement

- No renames of topic keys — zero behavior change for existing `--topics=creatine` invocations
- No deletions of existing queries
- No merging of topic keys — the `eurycoma_longifolia` / `eurycome_longfolia` aliases stay as-is (harmlessly duplicate, same query)

## 6. Section 4 — Validation gates

Three gates before declaring the expansion complete.

### 6.1 Gate 1 — Static checks (required)

```bash
node --check scripts/fill-pmc-topics.js                      # syntax
node scripts/fill-pmc-topics.js --topics=INVALID --dry-run   # parse + topic table load
```

Programmatic parity check: every key in `DEFAULT_TOPIC_ORDER` must have a corresponding entry in `TOPIC_QUERIES`, and vice versa (modulo the intentional `eurycoma_longifolia` / `eurycome_longfolia` alias pair). Implemented as a 5-line self-check inside the script's `main()` (runs before any network calls) so broken states fail fast at startup.

### 6.2 Gate 2 — PubMed query smoke test (required)

Sample 15 new queries at random + 10 refined existing queries. For each, call PubMed eutils `/esearch`:

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<url-encoded-query>&retmax=1
```

At the 3 req/sec PubMed rate limit for unauthenticated access (existing scripts already respect this). Parse the `<Count>` field from the XML response.

- **Pass:** Count ≥ 100
- **Warn:** 10 ≤ Count < 100 — query is valid but narrow; flag for manual inspection
- **Fail:** Count < 10 — query is likely malformed or covers a topic PubMed doesn't index well; must be fixed before merge

Total wall time: ~10 seconds for 25 queries. No ingestion cost, no OpenAI cost.

Implemented as a dedicated `scripts/validate-pubmed-queries.js` helper (new file, committed) that reads `TOPIC_QUERIES` directly, takes a `--topics=` filter to target new / refined ones, and prints a pass/warn/fail table. Reusable for future query additions.

### 6.3 Gate 3 — Research pass sanity

Confirm `data/research/topic-candidates-2026-04-11.jsonl` exists, contains ≥50 candidates after classifier filtering, and the top 30 candidates by frequency meaningfully overlap with the chosen domains. If the research pass surfaces a strong candidate cluster I missed, it gets added to Section 2 before commit.

### 6.4 What validation does NOT cover

- **No PubMed fill run** — ingestion is kicked off manually by the operator after the expansion merges
- **No embedding generation** — embeddings happen automatically as part of the fill pipeline
- **No DB state verification** — no DB changes are made in this spec

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| New query returns <100 PubMed papers (topic not well-indexed) | Gate 2 catches this before merge; such queries get broadened, dropped, or documented as intentionally speculative |
| YouTube API key quota exhausted mid-run | Cheap-ops-only strategy uses ~1% of daily 10k quota; retryable on next day if somehow blown |
| Reddit rate-limits or temporarily bans the crawler IP | Polite 1 req/sec + identifying User-Agent stays well under Reddit's thresholds; on 429 back off 60s and retry |
| Classifier mislabels obvious non-exercise content as exercise-science (false positives) | Confidence threshold ≥0.6 filters most noise; manual review of top 100 output catches residual |
| Research pass takes significantly longer than 45min budget | Hard wall-clock cap: if crawl + classify exceeds 90 min, proceed with partial results |
| Refactoring `DEFAULT_TOPIC_ORDER` breaks existing callers who depend on positional order | No callers depend on position; `--topics=` filter is keyed by name; default order only affects fill sequencing on `npm run fill:pmc:topics` with no `--topics=` argument |

## 8. Open questions / deferred work

- **Interpretation B — standing topic-discovery pipeline.** Explicitly deferred. When/if this is picked up, the throwaway research script's prompts, source list, dedup logic, and JSONL schema should be used as starting points. It deserves its own brainstorm → spec → plan cycle.
- **PubMed MeSH tree expansion.** Could further improve existing-query refinement by systematically walking the MeSH tree for each topic. Not in scope for this session — a future iteration if the current refinement proves insufficient.
- **Retrieval gap analysis.** Interpretation C from brainstorming ("look at what users actually asked and retrieval returned thin") was not chosen. If future expansions want a data-driven driver, `guardrail_events` + chat logs in prod are the starting point.

## 9. Acceptance criteria

- [ ] `scripts/fill-pmc-topics.js` parses cleanly (`node --check`)
- [ ] `DEFAULT_TOPIC_ORDER` is organized into 20 commented domain sections
- [ ] All 121 existing topics retrofitted into their natural domain sections, no renames
- [ ] ~80–90 new topics added across the 11 new domain sections
- [ ] Every `DEFAULT_TOPIC_ORDER` key has a corresponding `TOPIC_QUERIES` entry (parity check)
- [ ] 40–60 existing queries refined per Section 3 criteria
- [ ] PubMed smoke test (Gate 2) passes for a random sample of 25 new/refined queries with Count ≥ 100
- [ ] `scripts/validate-pubmed-queries.js` committed and runnable
- [ ] Research pass output archived at `data/research/topic-candidates-2026-04-11.jsonl`
- [ ] Throwaway `scripts/research-topic-candidates.js` deleted from working tree after use
- [ ] Design spec reviewed and approved by the user
- [ ] Implementation plan generated via the writing-plans skill and executed in a separate session
