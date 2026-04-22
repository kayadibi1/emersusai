// shared/train/modality-empty-state.js
//
// Zero-state for the Train page when a user has no active session for the
// currently-selected modality. Replaces the prior 2-line "No active session"
// empty state with three bands:
//
//   1. Hero CTA — modality-specific copy + primary "Start a session" button.
//   2. Ghost preview — skeletons that preview what Band 1 becomes after the
//      first session (last session / trend / PRs). Honest placeholder UX:
//      shows the feature exists before the data populates it.
//   3. Research — 3 curated questions about this modality that seed a chat
//      query in /app/. Leans into the Emersus differentiator (evidence-
//      grounded answers) instead of leaving the room empty.
//
// Ships with zero new backend: research items are curated questions, not
// fabricated answers. When Band 1 gets real data (separate phase), the
// ghost preview collapses and real cards replace it.
//
// Triggered from app/train/train.js when the Active sub-tab has no session.

import React from "react";

const h = React.createElement;

const MODALITY_CONTENT = {
  lift: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready for your first lift?",
    heroSub: "Log every set, rep, and load. Emersus surfaces it back here as top sets, volume trends, and PRs.",
    ctaLabel: "Start a lift session",
    ghostLabels: ["Top set", "Volume this week", "PR board"],
    research: [
      { tag: "Volume",         q: "How much weekly volume actually drives hypertrophy?" },
      { tag: "Autoregulation", q: "RIR vs RPE — which one autoregulates better for hypertrophy?" },
      { tag: "Rest intervals", q: "How long should I rest between sets for strength vs. hypertrophy?" },
    ],
  },
  cardio: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready for your first run or ride?",
    heroSub: "Distance, pace, HR, GPS route — all captured live and surfaced here with your trends.",
    ctaLabel: "Start a cardio session",
    ghostLabels: ["Last session", "Pace trend", "Zone 2 minutes"],
    research: [
      { tag: "Zone 2",     q: "How do I find my Zone 2 heart rate without a lab test?" },
      { tag: "Intensity",  q: "HIIT vs LISS for VO₂max — what does the meta-analytic evidence say?" },
      { tag: "Recovery",   q: "How fast should my resting heart rate recover between sessions?" },
    ],
  },
  swim: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready for your first swim?",
    heroSub: "Tap for lap — Emersus logs splits, stroke, and pool length. Trends populate here once you've got data.",
    ctaLabel: "Start a swim session",
    ghostLabels: ["Last swim", "Fastest 100m", "Meters this month"],
    research: [
      { tag: "Warm-up",      q: "What's an evidence-based swim warm-up protocol?" },
      { tag: "Technique",    q: "Freestyle stroke economy — which drills have research support?" },
      { tag: "Periodization", q: "How should masters swimmers periodize their training?" },
    ],
  },
  climb: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready to log your first session?",
    heroSub: "Route by route: grade, attempts, send type. Emersus surfaces your grade curve and hardest sends here.",
    ctaLabel: "Start a climb session",
    ghostLabels: ["Last session", "Hardest send per style", "Attempt breakdown"],
    research: [
      { tag: "Hangboard",   q: "Hangboard protocols — what does the evidence support?" },
      { tag: "Grip",        q: "Grip endurance vs max strength — how should I train each?" },
      { tag: "Injury",      q: "How do I prevent finger pulley injuries as a climber?" },
    ],
  },
};

function askHref(q) {
  return `/app/?prompt=${encodeURIComponent(q)}`;
}

export function ModalityEmptyState({ modality, onStart }) {
  const content = MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift;

  return h("div", { className: "tr-mod-empty" },

    // ── Band 1 · Hero CTA ──
    h("section", { className: "tr-mod-hero" },
      h("div", { className: "tr-mod-hero-eyebrow" }, content.heroEyebrow),
      h("h2", { className: "tr-mod-hero-title" }, content.heroTitle),
      h("p",  { className: "tr-mod-hero-sub" },   content.heroSub),
      h("button", {
        type: "button",
        className: "tr-mod-hero-cta",
        onClick: onStart,
      },
        content.ctaLabel,
        h("span", { className: "tr-mod-hero-cta-arrow", "aria-hidden": true }, "→"),
      ),
    ),

    // ── Band 2 · Ghost preview of what this page becomes ──
    h("section", { className: "tr-mod-ghost" },
      h("div", { className: "tr-mod-ghost-head" },
        h("span", { className: "tr-mod-ghost-label" }, "After your first session"),
        h("span", { className: "tr-mod-ghost-note" },  "Trends fill in as you train."),
      ),
      h("div", { className: "tr-mod-ghost-grid" },
        content.ghostLabels.map((label, i) =>
          h("div", { key: i, className: "tr-mod-ghost-card" },
            h("div", { className: "tr-mod-ghost-caption" }, label),
            h("div", { className: "skel skel-line w-70" }),
            h("div", { className: "skel skel-block tr-mod-ghost-block" }),
            h("div", { className: "skel skel-line w-40" }),
          ),
        ),
      ),
    ),

    // ── Band 3 · Research: seeded questions that open in chat ──
    h("section", { className: "tr-mod-research" },
      h("div", { className: "tr-mod-research-head" },
        h("span", { className: "tr-mod-research-label" }, "Ask the research"),
        h("p",    { className: "tr-mod-research-sub" },
          "While your numbers fill in, Emersus can answer any question about this sport — grounded in the literature.",
        ),
      ),
      h("div", { className: "tr-mod-research-grid" },
        content.research.map((item, i) =>
          h("a", {
            key: i,
            className: "tr-mod-research-card",
            href: askHref(item.q),
          },
            h("div", { className: "tr-mod-research-tag" }, item.tag),
            h("div", { className: "tr-mod-research-q" },   item.q),
            h("div", { className: "tr-mod-research-cta" }, "Ask Emersus →"),
          ),
        ),
      ),
    ),

  );
}
