import assert from "node:assert/strict";
import { buildVisualArtifactPlan } from "../api/emersus/workflow.js";

const baseSynthesis = {
  summary:
    "The global AI fitness and wellness market is valued at $9.8 billion in 2024 and projected to reach $46.1 billion by 2034 at a 16.8% CAGR. Investor appetite is strongest for software, AI, and evidence-backed clinical tools.",
  answer_text:
    "The global AI fitness and wellness market is valued at $9.8 billion in 2024 and projected to reach $46.1 billion by 2034 at a 16.8% CAGR. OpenEvidence raised over $100 million at a $3 billion valuation. A key risk is that investors are cautious about generic consumer wellness apps.",
};

const evidence = [
  {
    title: "AI fitness market outlook",
    chunk_text:
      "The AI fitness and wellness market was valued at $9.8 billion in 2024 and is projected to reach $46.1 billion by 2034 with a 16.8% CAGR.",
    pmid: "123",
    ranking_score: 0.9,
  },
  {
    title: "Digital health investor trends",
    chunk_text:
      "Digital health startup funding reached $14.2 billion in 2025, a 35% increase over 2024. AI startups captured 41% of all venture dollars raised in 2025.",
    pmid: "456",
    ranking_score: 0.88,
  },
];

const cases = [
  ["Show me a diagram of how Emersus retrieves evidence and turns it into coaching.", "diagram"],
  ["Show me a chart: is there a market for Emersus and are investors likely to support it?", "chart"],
  ["Create a mockup of an Emersus evidence coaching dashboard card.", "mockup"],
  ["Make an interactive calculator for scenario planning investor support.", "interactive_explainer"],
  ["Create a decorative SVG illustration of Emersus as an evidence mountain landscape.", "art_illustration"],
];

for (const [question, expectedType] of cases) {
  const plan = buildVisualArtifactPlan({
    question,
    synthesis: baseSynthesis,
    evidence,
    includeDebug: true,
  });
  assert.equal(plan.card?.type, "visual_artifact", question);
  assert.equal(plan.card?.artifact_type, expectedType, question);
}

const suppressed = buildVisualArtifactPlan({
  question: "What is creatine?",
  synthesis: baseSynthesis,
  evidence,
  includeDebug: true,
});
assert.equal(suppressed.card, null);
assert.equal(suppressed.debug.reason, "no_visual_intent");

const shortAnswerDiagram = buildVisualArtifactPlan({
  question: "Show me a diagram of how Emersus turns evidence into coaching",
  synthesis: {
    summary: "Here is the diagram.",
    answer_text: "Here is the diagram.",
  },
  evidence: [],
  includeDebug: true,
});
assert.equal(shortAnswerDiagram.card?.artifact_type, "diagram");
assert.ok(shortAnswerDiagram.card?.data?.nodes?.length >= 4);
assert.equal(shortAnswerDiagram.card.data.nodes[0].label, "Retrieve evidence");

const longAnswerDiagram = buildVisualArtifactPlan({
  question: "Show me a diagram of how Emersus turns evidence into coaching",
  synthesis: baseSynthesis,
  evidence,
  includeDebug: true,
});
assert.equal(longAnswerDiagram.card?.artifact_type, "diagram");
assert.equal(longAnswerDiagram.card.data.nodes[0].label, "Retrieve evidence");

const creatineDiagram = buildVisualArtifactPlan({
  question: "show me a diagram of how creatine works flow",
  synthesis: {
    summary: "Here is a simple diagram of how creatine works in muscle.",
    answer_text:
      "Here is a simple diagram of how creatine works in muscle. Creatine helps muscle cells regenerate ATP during hard efforts.",
  },
  evidence,
  includeDebug: true,
});
assert.equal(creatineDiagram.card?.artifact_type, "diagram");
assert.equal(creatineDiagram.card.data.nodes[0].label, "Creatine intake");
assert.equal(creatineDiagram.card.data.nodes.at(-1).label, "Training output");

const genericWorksDiagram = buildVisualArtifactPlan({
  question: "show me a diagram of how caffeine works flow",
  synthesis: {
    summary: "Here is a simple diagram.",
    answer_text: "Here is a simple diagram.",
  },
  evidence: [],
  includeDebug: true,
});
assert.equal(genericWorksDiagram.card?.artifact_type, "diagram");
assert.notEqual(genericWorksDiagram.card.data.nodes[0].label, "Input");

const chartTypes = [
  ["Show me a line chart of the market trend over time.", "timeline"],
  ["Show me a proportion chart of investor share and market share.", "proportion"],
  ["Show me a range chart for protocol values.", "range"],
  ["Show me a scatter chart for funding and market metrics.", "scatter"],
];

for (const [question, expectedChartType] of chartTypes) {
  const plan = buildVisualArtifactPlan({
    question,
    synthesis: baseSynthesis,
    evidence,
    includeDebug: true,
  });
  assert.equal(plan.card?.artifact_type, "chart", question);
  assert.equal(plan.card?.data?.chart_type, expectedChartType, question);
}

console.log("visual artifact fixtures ok");
