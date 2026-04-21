import test from "node:test";
import assert from "node:assert/strict";
import { resolveChainingContext } from "../../../../../api/emersus/pipeline/response-chaining.js";

test("resolveChainingContext", async (t) => {
  const now = new Date("2026-04-21T12:00:00Z").getTime();

  await t.test("returns chain:false when flag disabled", () => {
    const ctx = resolveChainingContext({
      flagEnabled: false,
      messages: [{ role: "assistant", openaiResponseId: "resp_abc", createdAt: now - 3600_000 }],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "flag_disabled");
  });

  await t.test("returns chain:false when no prior assistant message has a response_id", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [{ role: "user", createdAt: now - 1000 }],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "no_prior_response_id");
  });

  await t.test("returns chain:false when newest response_id is older than 25 days", () => {
    const twentySixDaysAgo = now - 26 * 24 * 3600 * 1000;
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_old", createdAt: twentySixDaysAgo },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "expired");
    assert.equal(ctx.previousResponseId, "resp_old");
  });

  await t.test("handles ISO-string createdAt", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_iso", createdAt: "2026-04-21T06:00:00Z" },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, true);
    assert.equal(ctx.previousResponseId, "resp_iso");
  });

  await t.test("skips assistant messages without openaiResponseId", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_earlier", createdAt: now - 3600_000 },
        { role: "user", createdAt: now - 2000 },
        { role: "assistant", createdAt: now - 1000 },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, true);
    assert.equal(ctx.previousResponseId, "resp_earlier");
  });

  await t.test("returns chain:false on empty messages", () => {
    const ctx = resolveChainingContext({ flagEnabled: true, messages: [], now });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "no_prior_response_id");
  });

  await t.test("returns chain:false on undefined messages", () => {
    const ctx = resolveChainingContext({ flagEnabled: true, now });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "no_prior_response_id");
  });

  await t.test("returns chain:true with newest response_id when within 25 days", () => {
    const fiveDaysAgo = now - 5 * 24 * 3600 * 1000;
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_first", createdAt: now - 10 * 24 * 3600 * 1000 },
        { role: "user", createdAt: fiveDaysAgo + 1000 },
        { role: "assistant", openaiResponseId: "resp_newest", createdAt: fiveDaysAgo },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, true);
    assert.equal(ctx.previousResponseId, "resp_newest");
    assert.equal(ctx.reason, "ok");
  });

  await t.test("skips user messages when finding newest response_id", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_a", createdAt: now - 1000 },
        { role: "user", createdAt: now - 500 },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, true);
    assert.equal(ctx.previousResponseId, "resp_a");
  });
});
