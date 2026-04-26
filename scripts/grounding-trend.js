// scripts/grounding-trend.js
//
// Prints citation-quality trend from chat_grounding_samples. Shows:
//   - 7-day, 30-day, and all-time aggregate support/weak/decoy/contradicted
//     rates from the fidelity grader
//   - Mean paraphrase similarity per window
//   - Week-over-week delta for support rate (regression detector)
//
// Usage:
//   node scripts/grounding-trend.js

import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";

function sinceIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function aggregateFidelity(rows) {
  const agg = { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: 0 };
  for (const r of rows) {
    const s = r.grader_result?.fidelity?.summary;
    if (!s) continue;
    for (const k of Object.keys(agg)) agg[k] += Number(s[k] || 0);
  }
  return {
    ...agg,
    support_rate: agg.total ? Number((agg.supported / agg.total).toFixed(3)) : null,
    weak_rate:    agg.total ? Number((agg.weak / agg.total).toFixed(3)) : null,
    decoy_rate:   agg.total ? Number((agg.decoy / agg.total).toFixed(3)) : null,
    contradicted_rate: agg.total ? Number((agg.contradicted / agg.total).toFixed(3)) : null,
  };
}

function aggregateParaphrase(rows) {
  const sims = [];
  let lows = 0, totals = 0;
  for (const r of rows) {
    const s = r.grader_result?.paraphrase?.summary;
    if (!s || s.total === 0) continue;
    if (typeof s.mean_sim === "number") sims.push(s.mean_sim);
    lows += Number(s.low_sim_count || 0);
    totals += Number(s.total || 0);
  }
  return {
    sampled_prompts_with_paraphrase: sims.length,
    mean_of_per_prompt_mean_sim: sims.length ? Number((sims.reduce((s, v) => s + v, 0) / sims.length).toFixed(3)) : null,
    total_cited_claims: totals,
    low_similarity_count: lows,
    low_similarity_rate: totals ? Number((lows / totals).toFixed(3)) : null,
  };
}

async function loadGradedSince(isoSince) {
  const { data, error } = await supabaseAdmin.from("chat_grounding_samples")
    .select("created_at, grader_result")
    .gte("graded_at", isoSince)
    .not("grader_result", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadAllGraded() {
  const { data, error } = await supabaseAdmin.from("chat_grounding_samples")
    .select("created_at, grader_result")
    .not("grader_result", "is", null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadClaimModesSince(isoSince) {
  const { data, error } = await supabaseAdmin.from("chat_claim_modes")
    .select("mode, grading_status, judge_prompt_version, created_at")
    .gte("created_at", isoSince)
    .eq("grading_status", "ok");
  if (error) throw new Error(error.message);
  return data || [];
}

function aggregateClaimModes(rows) {
  const counts = {
    correct: 0,
    mode_1_misattribution: 0,
    mode_2_overgen: 0,
    mode_3_fabrication: 0,
    mode_4_contradicted: 0,
    no_marker: 0,
  };
  for (const r of rows) {
    if (counts[r.mode] !== undefined) counts[r.mode] += 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = (k) => total ? Number(((100 * counts[k]) / total).toFixed(2)) : 0;
  return {
    total_claims: total,
    counts,
    pct: {
      correct: pct("correct"),
      mode_1_misattribution: pct("mode_1_misattribution"),
      mode_2_overgen: pct("mode_2_overgen"),
      mode_3_fabrication: pct("mode_3_fabrication"),
      mode_4_contradicted: pct("mode_4_contradicted"),
      no_marker: pct("no_marker"),
    },
    // headline fabrication-or-contradiction rate (the prevention-relevant metric)
    fabrication_or_contradiction_pct: total
      ? Number((100 * (counts.mode_3_fabrication + counts.mode_4_contradicted) / total).toFixed(2))
      : 0,
  };
}

async function main() {
  if (!supabaseAdmin) { console.error("missing supabaseAdmin"); process.exit(1); }

  const [week1, week2, all, modesWeek1, modesAll] = await Promise.all([
    loadGradedSince(sinceIso(7 * 24)),
    (async () => {
      // last week's comparison window: graded between 14 and 7 days ago
      const { data, error } = await supabaseAdmin.from("chat_grounding_samples")
        .select("created_at, grader_result")
        .gte("graded_at", sinceIso(14 * 24))
        .lt("graded_at", sinceIso(7 * 24))
        .not("grader_result", "is", null);
      if (error) throw new Error(error.message);
      return data || [];
    })(),
    loadAllGraded(),
    loadClaimModesSince(sinceIso(7 * 24)),
    (async () => {
      const { data, error } = await supabaseAdmin.from("chat_claim_modes")
        .select("mode, grading_status, judge_prompt_version, created_at")
        .eq("grading_status", "ok");
      if (error) throw new Error(error.message);
      return data || [];
    })(),
  ]);

  const current = aggregateFidelity(week1);
  const previous = aggregateFidelity(week2);
  const allTime = aggregateFidelity(all);

  const currentParaphrase = aggregateParaphrase(week1);
  const previousParaphrase = aggregateParaphrase(week2);

  const delta = (current.support_rate !== null && previous.support_rate !== null)
    ? Number((current.support_rate - previous.support_rate).toFixed(3))
    : null;

  const claimModes7d = aggregateClaimModes(modesWeek1);
  const claimModesAllTime = aggregateClaimModes(modesAll);

  const summary = {
    window: {
      current_7d: { graded_prompts: week1.length, fidelity: current, paraphrase: currentParaphrase },
      previous_7d: { graded_prompts: week2.length, fidelity: previous, paraphrase: previousParaphrase },
      all_time: { graded_prompts: all.length, fidelity: allTime },
    },
    support_rate_wow_delta: delta,
    alert: delta !== null && delta <= -0.1 ? "SUPPORT RATE DOWN >=10pp WoW — investigate" : null,
    claim_modes: {
      current_7d: claimModes7d,
      all_time: claimModesAllTime,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => { console.error("[trend] failed:", err); process.exit(1); });
