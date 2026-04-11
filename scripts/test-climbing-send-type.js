// Tests for reconcileSendTypeForAttempts() used by the climb session
// modal (app/workout/climb/climb.js). The rule:
//
//   - "flash" requires attempts === 1 by definition.
//   - Incrementing attempts past 1 while "flash" is selected must
//     promote the send type to "send".
//   - Decrementing attempts back to 1 must NOT auto-demote "send" to
//     "flash" — the user may have deliberately logged a send.
//   - "project" is unaffected.
//
// Run: node scripts/test-climbing-send-type.js

import assert from "node:assert/strict";
import { reconcileSendTypeForAttempts } from "../shared/climbing-send-type.js";

// Flash + attempts > 1 → promote to send.
assert.equal(reconcileSendTypeForAttempts("flash", 2), "send");
assert.equal(reconcileSendTypeForAttempts("flash", 5), "send");
assert.equal(reconcileSendTypeForAttempts("flash", 100), "send");

// Flash + attempts === 1 → unchanged.
assert.equal(reconcileSendTypeForAttempts("flash", 1), "flash");

// Send stays send — no reverse auto-demotion back to flash.
assert.equal(reconcileSendTypeForAttempts("send", 1), "send");
assert.equal(reconcileSendTypeForAttempts("send", 3), "send");

// Project is unaffected by attempt count.
assert.equal(reconcileSendTypeForAttempts("project", 1), "project");
assert.equal(reconcileSendTypeForAttempts("project", 5), "project");

// Defensive: unknown / missing send type returned unchanged (not our
// job to invent state — but don't crash on weird input).
assert.equal(reconcileSendTypeForAttempts(undefined, 2), undefined);
assert.equal(reconcileSendTypeForAttempts(null, 2), null);
assert.equal(reconcileSendTypeForAttempts("", 2), "");

console.log("climbing send-type tests: OK");
