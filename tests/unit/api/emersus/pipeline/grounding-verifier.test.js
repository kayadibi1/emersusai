import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verifyAnswerGrounding,
  __testables,
} from "../../../../../api/emersus/pipeline/grounding-verifier.js";

const EVIDENCE = [{
  title: "Creatine supplementation and resistance training",
  excerpt:
    "Creatine supplementation increased strength and lean mass during resistance training. The retrieved trial used a daily creatine dose and measured strength outcomes.",
  publication_type: "Randomized Controlled Trial",
}];

describe("verifyAnswerGrounding — legacy mode (token overlap)", () => {
  it("passes factual claims whose key terms are present in retrieved evidence", () => {
    const result = verifyAnswerGrounding({
      answerText: "The retrieved trial reported that creatine increased strength during resistance training.",
      evidenceItems: EVIDENCE,
    });

    assert.equal(result.grounded, true);
    assert.equal(result.checked_claims, 1);
    assert.deepStrictEqual(result.unsupported_claims, []);
  });

  it("flags unsupported factual claims that look like pretrained knowledge", () => {
    const result = verifyAnswerGrounding({
      answerText:
        "The retrieved trial reported that creatine increased strength. Caffeine improves endurance by lowering perceived exertion.",
      evidenceItems: EVIDENCE,
    });

    assert.equal(result.grounded, false);
    assert.equal(result.checked_claims, 2);
    assert.equal(result.unsupported_claims.length, 1);
    assert.match(result.unsupported_claims[0].claim, /Caffeine improves endurance/i);
  });

  it("does not punish explicit insufficient-evidence sentences", () => {
    const result = verifyAnswerGrounding({
      answerText:
        "The retrieved evidence does not establish whether caffeine improves endurance. The database evidence is insufficient.",
      evidenceItems: [],
    });

    assert.equal(result.grounded, true);
    assert.equal(result.checked_claims, 0);
  });
});

describe("verifyAnswerGrounding — citation mode", () => {
  const SOURCES = [
    { title: "Creatine supplementation and resistance training", excerpt: "creatine increased strength" },
    { title: "Creatine saturation kinetics", excerpt: "steady 3–5 g/day reaches saturation in 4 weeks" },
    { title: "Protein and hypertrophy", excerpt: "protein at 1.6 g/kg" },
  ];

  // OpenAI's recommended Unicode PUA citation markers.
  // U+E200 citesrcN is the strict format the prompt requires.
  const cite = (n) => `citesrc${n}`;

  it("status=grounded when every factual sentence carries a valid marker (strict format)", () => {
    const answerText =
      `Creatine 3–5 g/day increases strength ${cite(1)}. Saturation reaches plateau at 5 g/day after 4 weeks ${cite(2)}.`;
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.mode, "citation");
    assert.equal(result.status, "grounded");
    assert.equal(result.grounded, true);
    assert.equal(result.factual_sentences, 2);
    assert.equal(result.cited_sentences, 2);
    assert.equal(result.strict_marker_count, 2);
    assert.equal(result.legacy_marker_count, 0);
    assert.deepStrictEqual(result.uncited_claims, []);
  });

  it("accepts legacy [N] markers for back-compat with pre-switch threads", () => {
    const answerText =
      "Creatine 3–5 g/day increases strength [1]. Saturation reaches plateau at 5 g/day after 4 weeks [2].";
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.status, "grounded");
    assert.equal(result.strict_marker_count, 0);
    assert.equal(result.legacy_marker_count, 2);
  });

  it("status=ungrounded when factual sentences have no markers", () => {
    const answerText =
      "Creatine 3–5 g/day increases strength. Saturation takes about four weeks. Stack it with caffeine for a boost.";
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.status, "ungrounded");
    assert.equal(result.grounded, false);
    assert.ok(result.uncited_claims.length >= 2);
  });

  it("status=partial when some claims are cited and some aren't", () => {
    const answerText =
      `Creatine 3–5 g/day increases strength ${cite(1)}. Protein at 1.6 g/kg matters. Saturation is 5 g/day for 4 weeks ${cite(2)}.`;
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.status, "partial");
    assert.equal(result.factual_sentences, 3);
    assert.equal(result.cited_sentences, 2);
  });

  it("status=ungrounded when a marker references a non-existent source id", () => {
    const answerText = `Creatine 3–5 g/day increases strength ${cite(9)}.`;
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.status, "ungrounded");
    assert.equal(result.invalid_markers.length, 1);
    assert.equal(result.invalid_markers[0].marker, 9);
  });

  it("labeled inferences are tracked but don't block grounded status", () => {
    const answerText =
      `Creatine 3–5 g/day increases strength ${cite(1)}. As a coaching inference, I'd take it with your post-workout shake for convenience.`;
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.factual_sentences, 1);
    assert.equal(result.cited_sentences, 1);
    assert.equal(result.status, "grounded");
  });

  it("status=no_claims for pure procedural prose", () => {
    const answerText = "Hit me with what you've been eating, and I'll help you dial it in.";
    const result = verifyAnswerGrounding({
      answerText,
      evidenceItems: SOURCES,
      mode: "citation",
    });
    assert.equal(result.status, "no_claims");
    assert.equal(result.grounded, false);
    assert.equal(result.factual_sentences, 0);
  });

  it("extracts multiple strict markers per sentence", () => {
    const markers = __testables.extractMarkers(`Creatine boosts strength ${cite(1)}${cite(2)}${cite(3)}.`);
    assert.deepStrictEqual(markers.map((m) => m.id), [1, 2, 3]);
    assert.ok(markers.every((m) => m.format === "strict"));
  });

  it("extracts legacy markers and tags them", () => {
    const markers = __testables.extractMarkers("Creatine boosts strength [1][2].");
    assert.deepStrictEqual(markers.map((m) => m.id), [1, 2]);
    assert.ok(markers.every((m) => m.format === "legacy"));
  });
});

describe("grounding verifier internals", () => {
  it("detects factual claims with numbers or intervention verbs", () => {
    assert.equal(__testables.isFactualClaim("Protein at 1.6 g/kg improves hypertrophy."), true);
    assert.equal(__testables.isFactualClaim("It depends."), false);
    // Non-fact sentence — no numbers, no fitness vocab. Returns false.
    assert.equal(
      __testables.isFactualClaim("The retrieved evidence does not establish that claim."),
      false,
    );
  });
});
