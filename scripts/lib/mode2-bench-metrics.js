// scripts/lib/mode2-bench-metrics.js
//
// Pure aggregation + markdown rendering for the MQPV bench/trend report.

export function aggregate(rows) {
  const headline = {
    total_chats: 0,
    rewrites_0_count: 0,
    rewrites_1_count: 0,
    rewrites_2_count: 0,
  };
  const cost = {
    total_usd: 0,
    total_extraction_usd: 0,
    total_validation_usd: 0,
    total_rewrite_usd: 0,
  };
  const latency = {
    samples: [],
  };
  const effectiveness = {
    total_initial_failures: 0,
    total_after_r1_failures: 0,
    total_final_failures: 0,
    chats_with_initial_failures: 0,
    chats_with_final_failures: 0,
  };
  const qualifiersDropped = {};

  for (const r of rows || []) {
    headline.total_chats += 1;
    const ra = r.mode2_rewrites_attempted ?? 0;
    if (ra === 0) headline.rewrites_0_count += 1;
    else if (ra === 1) headline.rewrites_1_count += 1;
    else if (ra === 2) headline.rewrites_2_count += 1;

    cost.total_extraction_usd += r.mode2_extraction_cost_usd || 0;
    cost.total_validation_usd += r.mode2_validation_cost_usd || 0;
    cost.total_rewrite_usd += r.mode2_rewrite_cost_usd || 0;
    cost.total_usd += (r.mode2_extraction_cost_usd || 0) + (r.mode2_validation_cost_usd || 0) + (r.mode2_rewrite_cost_usd || 0);

    if (r.mode2_total_latency_ms != null) latency.samples.push(r.mode2_total_latency_ms);

    const init = r.mode2_initial_failures ?? 0;
    const r1 = r.mode2_after_r1_failures ?? 0;
    const fin = r.mode2_final_failures ?? 0;
    effectiveness.total_initial_failures += init;
    effectiveness.total_after_r1_failures += r1;
    effectiveness.total_final_failures += fin;
    if (init > 0) effectiveness.chats_with_initial_failures += 1;
    if (fin > 0) effectiveness.chats_with_final_failures += 1;

    const breakdown = r.mode2_qualifiers_dropped_breakdown || {};
    for (const [k, v] of Object.entries(breakdown)) {
      qualifiersDropped[k] = (qualifiersDropped[k] || 0) + (Number(v) || 0);
    }
  }

  const n = headline.total_chats || 1;
  cost.avg_total_usd = cost.total_usd / n;
  cost.avg_extraction_usd = cost.total_extraction_usd / n;
  cost.avg_validation_usd = cost.total_validation_usd / n;
  cost.avg_rewrite_usd = cost.total_rewrite_usd / n;

  const sortedLatency = [...latency.samples].sort((a, b) => a - b);
  const pct = (p) => {
    if (sortedLatency.length === 0) return 0;
    const idx = Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * p));
    return sortedLatency[idx];
  };
  latency.p50_ms = pct(0.5);
  latency.p95_ms = pct(0.95);
  latency.p99_ms = pct(0.99);

  return {
    headline,
    cost,
    latency,
    effectiveness,
    qualifiers_dropped_total: qualifiersDropped,
  };
}

export function buildRecommendations(metrics) {
  const recs = [];
  const { headline, cost, latency, effectiveness, qualifiers_dropped_total } = metrics;
  const n = headline.total_chats || 1;

  // Drop rewrite #2 if rare AND ineffective
  const r2Rate = headline.rewrites_2_count / n;
  if (r2Rate < 0.02 && headline.rewrites_2_count >= 1) {
    recs.push("**Drop rewrite #2** — activates in <2% of chats. Set MODE2_REWRITE_2_ENABLED=false.");
  }

  // Drop low-incidence qualifiers
  const totalDropped = Object.values(qualifiers_dropped_total).reduce((s, v) => s + v, 0);
  for (const [q, count] of Object.entries(qualifiers_dropped_total)) {
    const share = totalDropped > 0 ? count / totalDropped : 0;
    if (share < 0.05 && count >= 1) {
      recs.push(`**Consider dropping qualifier '${q}' from validation** — only ${count} drops (${(share * 100).toFixed(1)}% of all). Add to MODE2_DISABLED_QUALIFIERS.`);
    }
  }

  // Cost ceiling
  if (cost.avg_total_usd > 0.0075) {
    recs.push(`**Cost ceiling exceeded** — avg cost/chat is $${cost.avg_total_usd.toFixed(4)}, above $0.0075 baseline (1.5× projected). Review extractor or rewriter prompts.`);
  }

  // Latency regression: >5% of chats over 10s
  const overThresholdCount = latency.samples.filter((ms) => ms > 10000).length;
  const overThresholdRate = overThresholdCount / (latency.samples.length || 1);
  if (overThresholdRate > 0.05) {
    recs.push(`**Latency regression** — ${(overThresholdRate * 100).toFixed(1)}% of chats exceeded 10s post-stream pause. Investigate slow path.`);
  }

  // Rewriter ineffective: rewrite #1 produces same-or-more failures in >10% of chats
  if (headline.rewrites_1_count > 0) {
    const proportion = effectiveness.total_after_r1_failures / Math.max(1, effectiveness.total_initial_failures);
    if (proportion > 0.9) {
      recs.push(`**Rewriter ineffective** — rewrite #1 reduces failures by only ${((1 - proportion) * 100).toFixed(1)}%. Iterate rewriter prompt.`);
    }
  }

  return recs;
}

export function renderMarkdown(metrics, { runId, recommendations = [] } = {}) {
  const { headline, cost, latency, effectiveness, qualifiers_dropped_total } = metrics;
  const n = headline.total_chats || 1;
  const pct = (numerator, denominator) =>
    denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";
  const usd = (v) => `$${(v ?? 0).toFixed(5)}`;
  const lines = [
    `# MQPV Trend — ${runId}`,
    "",
    "## Headline",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total chats | ${headline.total_chats} |`,
    `| 0 rewrites | ${headline.rewrites_0_count} (${pct(headline.rewrites_0_count, n)}) |`,
    `| 1 rewrite | ${headline.rewrites_1_count} (${pct(headline.rewrites_1_count, n)}) |`,
    `| 2 rewrites | ${headline.rewrites_2_count} (${pct(headline.rewrites_2_count, n)}) |`,
    "",
    "## Cost",
    "",
    "| Phase | Total | Avg/chat |",
    "|---|---:|---:|",
    `| Extraction | ${usd(cost.total_extraction_usd)} | ${usd(cost.avg_extraction_usd)} |`,
    `| Validation | ${usd(cost.total_validation_usd)} | ${usd(cost.avg_validation_usd)} |`,
    `| Rewrite | ${usd(cost.total_rewrite_usd)} | ${usd(cost.avg_rewrite_usd)} |`,
    `| **Total** | **${usd(cost.total_usd)}** | **${usd(cost.avg_total_usd)}** |`,
    "",
    `Projected at 30K chats/mo: **$${(cost.avg_total_usd * 30000).toFixed(2)}/mo**.`,
    `Projected at 300K chats/mo: **$${(cost.avg_total_usd * 300000).toFixed(2)}/mo**.`,
    "",
    "## Effectiveness",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total initial failures (pre-MQPV) | ${effectiveness.total_initial_failures} |`,
    `| Total after rewrite #1 | ${effectiveness.total_after_r1_failures} |`,
    `| Total final failures (post-MQPV) | ${effectiveness.total_final_failures} |`,
    `| Reduction | ${pct(effectiveness.total_initial_failures - effectiveness.total_final_failures, effectiveness.total_initial_failures)} |`,
    `| Chats with ≥1 initial failure | ${effectiveness.chats_with_initial_failures} (${pct(effectiveness.chats_with_initial_failures, n)}) |`,
    `| Chats with ≥1 final failure | ${effectiveness.chats_with_final_failures} (${pct(effectiveness.chats_with_final_failures, n)}) |`,
    "",
    "## Activation distribution",
    "",
    "| Latency percentile | Value |",
    "|---|---:|",
    `| p50 post-stream latency | ${latency.p50_ms ?? 0} ms |`,
    `| p95 | ${latency.p95_ms ?? 0} ms |`,
    `| p99 | ${latency.p99_ms ?? 0} ms |`,
    "",
    "## Qualifier-drop breakdown",
    "",
    "| Qualifier type | Times dropped |",
    "|---|---:|",
    ...Object.entries(qualifiers_dropped_total).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Recommendations",
    "",
    recommendations.length === 0 ? "_No flagged recommendations at this run._" : recommendations.map((r) => `- ${r}`).join("\n"),
    "",
  ];
  return lines.join("\n");
}
