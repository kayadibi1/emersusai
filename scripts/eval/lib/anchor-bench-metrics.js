// scripts/eval/lib/anchor-bench-metrics.js
//
// Pure aggregation + rendering helpers for the anchor-verifier bench.
// Consumed by scripts/eval/anchor-verifier-bench.js report phase.
// No I/O — input is the verified JSON object, output is { metrics, markdown, audit subset }.

export function aggregateMetrics(verified) {
  const headline = {
    total_chats: 0,
    total_claims: 0,
    total_anchors: 0,
    pass_verbatim: 0,
    pass_judged: 0,
    fail: 0,
    claims_with_failed_anchor: 0,
    claims_with_no_anchors: 0,
    chats_with_verify_error: 0,
  };
  const byMode = new Map();
  const scope = { chunk: 0, full_text: 0, abstract: 0 };
  const byKind = new Map();

  for (const chat of verified.per_chat || []) {
    headline.total_chats += 1;
    if (chat.verify_error || chat.verify_skipped) {
      headline.chats_with_verify_error += 1;
      continue;
    }
    for (const claim of chat.claims || []) {
      headline.total_claims += 1;
      const mode = claim.existing_mode || "unknown";
      const bucket = byMode.get(mode) || {
        mode,
        claims: 0,
        total_anchors: 0,
        failed_anchors: 0,
        claims_with_failed_anchor: 0,
      };
      bucket.claims += 1;

      const claimAnchors = claim.anchors || [];
      if (claimAnchors.length === 0) {
        headline.claims_with_no_anchors += 1;
      }

      let claimHasFail = false;
      for (const a of claimAnchors) {
        headline.total_anchors += 1;
        bucket.total_anchors += 1;

        if (a.result === "PASS_VERBATIM") {
          headline.pass_verbatim += 1;
          if (a.scope_actually_matched && scope[a.scope_actually_matched] != null) {
            scope[a.scope_actually_matched] += 1;
          }
        } else if (a.result === "PASS_JUDGED") {
          headline.pass_judged += 1;
          if (a.scope_actually_matched && scope[a.scope_actually_matched] != null) {
            scope[a.scope_actually_matched] += 1;
          }
        } else {
          headline.fail += 1;
          bucket.failed_anchors += 1;
          claimHasFail = true;
        }

        const kind = a.kind_hint || "other";
        const kb = byKind.get(kind) || { kind, total: 0, failed: 0 };
        kb.total += 1;
        if (a.result === "FAIL") kb.failed += 1;
        byKind.set(kind, kb);
      }

      if (claimHasFail) {
        headline.claims_with_failed_anchor += 1;
        bucket.claims_with_failed_anchor += 1;
      }
      byMode.set(mode, bucket);
    }
  }

  return {
    headline,
    by_mode: [...byMode.values()].sort((a, b) => b.claims - a.claims),
    scope,
    by_kind: [...byKind.values()].sort((a, b) => b.total - a.total),
  };
}

export function renderMarkdown(metrics, { runId } = {}) {
  const h = metrics.headline;
  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
  const passing = h.pass_verbatim + h.pass_judged;
  const lines = [
    `# Anchor-Verifier Bench — ${runId}`,
    "",
    "## Headline",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total chats | ${h.total_chats} |`,
    `| Chats with verify error / skip | ${h.chats_with_verify_error} |`,
    `| Total claims | ${h.total_claims} |`,
    `| Total anchors | ${h.total_anchors} |`,
    `| Anchors PASS (verbatim) | ${h.pass_verbatim} (${pct(h.pass_verbatim, h.total_anchors)}) |`,
    `| Anchors PASS (judged) | ${h.pass_judged} (${pct(h.pass_judged, h.total_anchors)}) |`,
    `| Anchors FAIL | ${h.fail} (${pct(h.fail, h.total_anchors)}) |`,
    `| Pass rate (any) | ${pct(passing, h.total_anchors)} |`,
    `| Claims with ≥1 failed anchor | ${h.claims_with_failed_anchor} (${pct(h.claims_with_failed_anchor, h.total_claims)}) |`,
    `| Claims with no anchors (synthesis-class) | ${h.claims_with_no_anchors} (${pct(h.claims_with_no_anchors, h.total_claims)}) |`,
    "",
    "## Per-mode breakdown",
    "",
    "| Existing mode | Claims | Anchors | Failed | Anchor-fail rate | Claims with ≥1 fail | Claim-fail rate |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...metrics.by_mode.map((b) =>
      `| ${b.mode} | ${b.claims} | ${b.total_anchors} | ${b.failed_anchors} | ${pct(b.failed_anchors, b.total_anchors)} | ${b.claims_with_failed_anchor} | ${pct(b.claims_with_failed_anchor, b.claims)} |`
    ),
    "",
    "## Scope distribution (passing anchors)",
    "",
    "| Scope | Count | % of passing |",
    "|---|---:|---:|",
    `| chunk | ${metrics.scope.chunk} | ${pct(metrics.scope.chunk, passing)} |`,
    `| full_text | ${metrics.scope.full_text} | ${pct(metrics.scope.full_text, passing)} |`,
    `| abstract | ${metrics.scope.abstract} | ${pct(metrics.scope.abstract, passing)} |`,
    "",
    "## Per-kind anchor breakdown",
    "",
    "| Kind | Total | Failed | Fail % |",
    "|---|---:|---:|---:|",
    ...metrics.by_kind.map((k) =>
      `| ${k.kind} | ${k.total} | ${k.failed} | ${pct(k.failed, k.total)} |`
    ),
    "",
    "## Ship-decision rule (from spec §8)",
    "",
    "Wire prod path (v2) iff all hold:",
    "",
    "1. False-rejection rate ≤15% on Claude-judged audit subset (run separately on `*-audit.jsonl`)",
    "2. Spearman ρ ≥ 0.4 between anchor-fail-rate and `chat_claim_modes.mode == mode_2_overgen` at claim level",
    "3. Per-chat extractor cost ≤$0.002",
    "",
    "Headline correlation hint (anchor-fail rate within mode_2_overgen vs. correct):",
    (() => {
      const overgen = metrics.by_mode.find((b) => b.mode === "mode_2_overgen");
      const correct = metrics.by_mode.find((b) => b.mode === "correct");
      if (!overgen || !correct || overgen.total_anchors === 0 || correct.total_anchors === 0) {
        return "_(insufficient data — at least one of mode_2_overgen / correct missing or empty)_";
      }
      const ovRate = overgen.failed_anchors / overgen.total_anchors;
      const crRate = correct.failed_anchors / correct.total_anchors;
      const lift = ovRate - crRate;
      return `mode_2_overgen anchor-fail rate ${(ovRate * 100).toFixed(1)}% vs correct ${(crRate * 100).toFixed(1)}% (lift +${(lift * 100).toFixed(1)}pp). Positive lift means the verifier flags mode_2 claims more often, which is the desired behavior.`;
    })(),
    "",
  ];
  return lines.join("\n");
}

/**
 * Deterministic random sampling of FAIL anchors for downstream Claude-judge audit.
 *
 * @param {Object} verified — bench JSON output (has per_chat[].claims[].anchors[])
 * @param {Object} [opts]
 * @param {number} [opts.n] — how many to sample (default 50)
 * @param {number} [opts.seed] — RNG seed (default 42); same seed → same selection
 * @returns {Array<Object>} flattened audit records
 */
export function selectAuditSubset(verified, { n = 50, seed = 42 } = {}) {
  const failed = [];
  for (const chat of verified.per_chat || []) {
    for (const claim of chat.claims || []) {
      for (const a of claim.anchors || []) {
        if (a.result === "FAIL") {
          failed.push({
            question: chat.question,
            claim_text: claim.claim_text,
            existing_mode: claim.existing_mode,
            anchor: a,
            attributed_source: (chat.sources || []).find(
              (s) => s.index === a.attributed_source_id,
            ) || null,
          });
        }
      }
    }
  }
  // Deterministic Fisher-Yates with Mulberry32 RNG
  let s = seed | 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...failed];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}
