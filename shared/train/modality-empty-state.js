// shared/train/modality-empty-state.js
//
// Train-page empty-state building blocks.
//
// - MODALITY_CONTENT: per-modality copy + research-question catalogue.
// - HeroCTA: the "Start a session" block. Reused by the dashboard state too.
// - GhostPreview: dashed-border skeleton cards shown only when the user has
//   zero past sessions, previewing what Band 1 becomes.
// - ResearchBand: 3 curated questions that seed /app/?prompt=... Reused by
//   both empty-state (zero sessions) and dashboard (1+ sessions).
// - ModalityEmptyState: composed surface for zero-past-sessions case.
//
// Modality-dashboard (see shared/train/modality-dashboard.js) imports the
// shared pieces and adds its own last-session + recent-list bands.

import React from "react";

const h = React.createElement;

export const MODALITY_CONTENT = {
  lift: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready for your first lift?",
    heroSub: "Log every set, rep, and load. Emersus surfaces it back here as top sets, volume trends, and PRs.",
    ctaLabel: "Start a lift session",
    nextCtaLabel: "Start next lift",
    lastSessionLabel: "Your last lift",
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
    nextCtaLabel: "Start next cardio",
    lastSessionLabel: "Your last cardio",
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
    nextCtaLabel: "Start next swim",
    lastSessionLabel: "Your last swim",
    ghostLabels: ["Last swim", "Fastest 100m", "Meters this month"],
    research: [
      { tag: "Warm-up",       q: "What's an evidence-based swim warm-up protocol?" },
      { tag: "Technique",     q: "Freestyle stroke economy — which drills have research support?" },
      { tag: "Periodization", q: "How should masters swimmers periodize their training?" },
    ],
  },
  climb: {
    heroEyebrow: "START HERE",
    heroTitle: "Ready to log your first session?",
    heroSub: "Route by route: grade, attempts, send type. Emersus surfaces your grade curve and hardest sends here.",
    ctaLabel: "Start a climb session",
    nextCtaLabel: "Start next climb",
    lastSessionLabel: "Your last climb",
    ghostLabels: ["Last session", "Hardest send per style", "Attempt breakdown"],
    research: [
      { tag: "Hangboard", q: "Hangboard protocols — what does the evidence support?" },
      { tag: "Grip",      q: "Grip endurance vs max strength — how should I train each?" },
      { tag: "Injury",    q: "How do I prevent finger pulley injuries as a climber?" },
    ],
  },
};

function askHref(q) {
  return `/app/?prompt=${encodeURIComponent(q)}`;
}

// Shared Hero CTA. Variant "first" (default) uses the big hero title +
// subcopy; variant "compact" drops them for the dashboard state (user
// already knows what this page is, they just need a quick CTA).
export function HeroCTA({ modality, onStart, variant = "first" }) {
  const content = MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift;
  const label = variant === "compact" ? content.nextCtaLabel : content.ctaLabel;
  return h("section", { className: `tr-mod-hero tr-mod-hero-${variant}` },
    variant === "first" ? h("div", { className: "tr-mod-hero-eyebrow" }, content.heroEyebrow) : null,
    variant === "first" ? h("h2", { className: "tr-mod-hero-title" }, content.heroTitle) : null,
    variant === "first" ? h("p",  { className: "tr-mod-hero-sub" }, content.heroSub) : null,
    h("button", {
      type: "button",
      className: "tr-mod-hero-cta",
      onClick: onStart,
    },
      label,
      h("span", { className: "tr-mod-hero-cta-arrow", "aria-hidden": true }, "→"),
    ),
  );
}

export function GhostPreview({ modality }) {
  const content = MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift;
  return h("section", { className: "tr-mod-ghost" },
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
  );
}

export function ResearchBand({ modality }) {
  const content = MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift;
  return h("section", { className: "tr-mod-research" },
    h("div", { className: "tr-mod-research-head" },
      h("span", { className: "tr-mod-research-label" }, "Ask the research"),
      h("p",    { className: "tr-mod-research-sub" },
        "Emersus can answer any question about this sport, grounded in the literature. Pick one to get started.",
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
  );
}

// Zero-past-sessions state. After the first finished session, train.js
// swaps this for ModalityDashboard (see shared/train/modality-dashboard.js).
export function ModalityEmptyState({ modality, onStart }) {
  return h("div", { className: "tr-mod-empty" },
    h(HeroCTA,       { modality, onStart, variant: "first" }),
    h(GhostPreview,  { modality }),
    h(ResearchBand,  { modality }),
  );
}
