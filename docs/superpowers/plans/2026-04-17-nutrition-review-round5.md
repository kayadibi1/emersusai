# Nutrition Review Round 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 remaining bugs found in round 5 of the nutrition subsystem review.

**Architecture:** All 3 tasks are independent (different files). Safe to parallelize.

**Tech Stack:** Express 5, OpenAI function-calling tools, React 18 via esm.sh (no JSX — use `React.createElement`)

---

### Task 1: Parser strict-mode schema compliance

**Files:**
- Modify: `api/emersus/nutrition-parser.js:58-85`

**Bug:** `PARSER_SCHEMA` does not enable OpenAI strict mode. `raw_text` and `meal_slot` are defined in `properties` but NOT in the `required` array. OpenAI strict mode requires every property key in `required`. Without strict mode, the model may omit `raw_text` (degrading the confirm widget UX) or return unexpected extra fields.

- [ ] **Step 1: Add `strict: true` to PARSER_SCHEMA**

Change the schema object from:
```js
const PARSER_SCHEMA = {
  name: "parse_foods",
  description: "Parse a freeform food/supplement description into structured items.",
  parameters: {
```
To:
```js
const PARSER_SCHEMA = {
  name: "parse_foods",
  description: "Parse a freeform food/supplement description into structured items.",
  strict: true,
  parameters: {
```

- [ ] **Step 2: Add `raw_text` and `meal_slot` to required array**

Change line 77 from:
```js
required: ["description", "amount", "amount_unit", "kind", "confidence"],
```
To:
```js
required: ["raw_text", "description", "amount", "amount_unit", "kind", "meal_slot", "confidence"],
```

- [ ] **Step 3: Commit**

```bash
git add api/emersus/nutrition-parser.js
git commit -m "fix(nutrition): enable strict mode on parser schema, require all fields"
```

---

### Task 2: Meal journal validation hardening

**Files:**
- Modify: `api/emersus/meal-journal.js:28-148`

**Bug A:** POST /entries accepts `amount: -5`, `amount: 0`, `amount: NaN`, `amount: Infinity` — only checks for undefined/null/empty string.

**Bug B:** POST /copy-day accepts arbitrary strings for `source_date` and `target_date` — no YYYY-MM-DD format check (contrast with GET /day at line 151 which does validate).

**Bug C:** PATCH /entries/:id passes `meal_slot` unchecked to the RPC — invalid values like `"invalid_slot"` get through.

**Bug D:** POST /copy-day `meal_slots` parameter is passed unchecked to the RPC.

- [ ] **Step 1: Add a VALID_MEAL_SLOTS constant after line 25**

```js
const VALID_MEAL_SLOTS = ["breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening", "pre_workout", "post_workout", "supplements_am", "supplements_pm"];
```

- [ ] **Step 2: Add amount validation in POST /entries loop (after line 47)**

After the existing required-field loop, add:
```js
const amt = Number(e.amount);
if (!Number.isFinite(amt) || amt <= 0) {
  res.status(400).json({ error: "entry_invalid_amount", index: i });
  return;
}
if (!VALID_MEAL_SLOTS.includes(e.meal_slot)) {
  res.status(400).json({ error: "entry_invalid_meal_slot", index: i });
  return;
}
```

- [ ] **Step 3: Add meal_slot validation in PATCH /entries/:id (after line 77)**

Before the supabase.rpc call, add:
```js
if (meal_slot !== undefined && !VALID_MEAL_SLOTS.includes(meal_slot)) {
  res.status(400).json({ error: "invalid_meal_slot" });
  return;
}
```

- [ ] **Step 4: Add date + meal_slots validation in POST /copy-day (after line 127)**

Replace the existing check with:
```js
const DATE_RE_COPY = /^\d{4}-\d{2}-\d{2}$/;
if (!source_date || !target_date) {
  res.status(400).json({ error: "source_date_and_target_date_required" });
  return;
}
if (!DATE_RE_COPY.test(source_date) || !DATE_RE_COPY.test(target_date)) {
  res.status(400).json({ error: "dates_must_be_yyyy_mm_dd" });
  return;
}
if (meal_slots != null && (!Array.isArray(meal_slots) || !meal_slots.every(s => VALID_MEAL_SLOTS.includes(s)))) {
  res.status(400).json({ error: "invalid_meal_slots" });
  return;
}
```

- [ ] **Step 5: Commit**

```bash
git add api/emersus/meal-journal.js
git commit -m "fix(nutrition): harden meal-journal validation — amount range, date format, slot enum"
```

---

### Task 3: LogFoodModal error feedback on invalid amount

**Files:**
- Modify: `shared/nutrition-journal-panel.js:56-62`

**Bug:** When the user enters an invalid amount (NaN, 0, negative), the `log()` function returns silently — no error message. The `logError` state and display div already exist (added in round 2), but the amount validation path doesn't use them.

- [ ] **Step 1: Replace the silent return with error feedback**

Change lines 60-62 from:
```js
const amt = parseFloat(amount);
if (isNaN(amt) || amt <= 0) return;
```
To:
```js
const amt = parseFloat(amount);
if (isNaN(amt) || amt <= 0) {
  setLogError("Amount must be a positive number.");
  setSubmitting(false);
  return;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/nutrition-journal-panel.js
git commit -m "fix(nutrition): show error feedback on invalid amount in log food modal"
```
