import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  classifySafety,
  _resetModerationCacheForTests,
} from "../../../../../api/emersus/pipeline/safety.js";

describe("classifySafety — moderation precheck", () => {
  beforeEach(() => {
    _resetModerationCacheForTests();
  });

  it("flags hard-refused content before regex", async () => {
    const result = await classifySafety({
      userInput: "benign-looking question that moderation flags",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: async () => ({
        results: [
          {
            flagged: true,
            categories: { violence: true },
            category_scores: { violence: 0.97 },
          },
        ],
      }),
    });
    assert.equal(result.status, "hard_refusal");
    assert.equal(result.refused, true);
    assert.equal(result.source, "moderation");
  });

  it("falls through to regex when API errors (benign input → allowed)", async () => {
    const result = await classifySafety({
      userInput: "whats a good bench press routine",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: async () => {
        throw new Error("API down");
      },
    });
    // Regex guards let benign exercise questions through
    assert.equal(result.status, "allowed");
    assert.equal(result.refused, false);
    assert.equal(result.source, "regex");
  });

  it("falls through to regex when API errors (PED → regex refusal)", async () => {
    const result = await classifySafety({
      userInput: "give me a test e cycle 500mg per week",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: async () => {
        throw new Error("network failure");
      },
    });
    // Regex still catches PED content
    assert.equal(result.status, "hard_refusal");
    assert.equal(result.refused, true);
    assert.equal(result.reasons[0], "ped_protocol_or_sourcing");
    assert.equal(result.source, "regex");
  });

  it("caches identical inputs within TTL", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return {
        results: [{ flagged: false, categories: {}, category_scores: {} }],
      };
    };
    await classifySafety({
      userInput: "same question",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: fetchMock,
    });
    await classifySafety({
      userInput: "same question",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: fetchMock,
    });
    assert.equal(calls, 1);
  });

  it("does not fire moderation when disabled via option", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return { results: [] };
    };
    const result = await classifySafety({
      userInput: "whats a good bench press routine",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: fetchMock,
      moderationEnabled: false,
    });
    assert.equal(calls, 0);
    assert.equal(result.source, "regex");
    assert.equal(result.status, "allowed");
  });

  it("still falls through to regex when moderation returns flagged:false", async () => {
    const result = await classifySafety({
      userInput: "how much creatine should I take",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: async () => ({
        results: [
          { flagged: false, categories: {}, category_scores: {} },
        ],
      }),
    });
    assert.equal(result.status, "allowed");
    assert.equal(result.source, "regex");
  });

  it("accepts a Response-like object from real fetch (with .json())", async () => {
    const result = await classifySafety({
      userInput: "moderation response-like path",
      profile: {},
      threadState: {},
      recentMessages: [],
      _moderationFetch: async () => ({
        json: async () => ({
          results: [
            {
              flagged: true,
              categories: { harassment: true },
              category_scores: { harassment: 0.88 },
            },
          ],
        }),
      }),
    });
    assert.equal(result.status, "hard_refusal");
    assert.equal(result.source, "moderation");
  });
});
