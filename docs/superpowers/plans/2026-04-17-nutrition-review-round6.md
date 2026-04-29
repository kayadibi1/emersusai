# Nutrition Review Round 6 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement.

**Goal:** Fix 5 bugs found by Opus deep review (1 CRITICAL, 2 IMPORTANT, 2 MINOR).

**Architecture:** Tasks 1, 2, 5 are independent files. Tasks 3+4 share nutrition-day.js — combine into one task.

---

### Task 1: Restrict log_food amount_unit enum to match DB

**Files:** `api/emersus/pipeline/tools.js:1429,1617`

**Bug:** The log_food tool schema enum has 9 units (`g, ml, mg, mcg, IU, capsule, tablet, scoop, serving`) but `meal_journal_entries.amount_unit` CHECK constraint only allows `('g','serving')`. When LLM outputs `amount_unit: "ml"`, the confirm card passes it through and the DB insert fails with a constraint violation.

**Fix:** Restrict the schema enum and validator to `["g", "serving"]` only.

---

### Task 2: Fix UTC date bug in nutrition.js

**Files:** `app/nutrition/nutrition.js:58,125-128`

**Bug:** `todayIso()` uses `toISOString().slice(0,10)` which returns UTC date, not local. For US users after ~7-8 PM, this shows tomorrow's data. `DateNavigator.offset()` also uses `setUTCDate`/`toISOString`. `localDateStr` and `localDateOffset` already exist in `shared/date-utils.js`.

**Fix:** Import `localDateStr` from date-utils, replace `todayIso()` body, fix DateNavigator offset.

---

### Task 3: Fix computePaceZone timezone + consumed.kcal optional chaining

**Files:** `api/emersus/nutrition-day.js:17-26,46,239`

**Bug A:** `computePaceZone` uses `now.getHours()` which is the Hetzner server's local hour (CET/CEST), not the user's. The client already passes `tz` (getTimezoneOffset()) in the query string.

**Bug B:** Line 46 uses `consumed.kcal` without optional chaining while the same line uses `consumed?.kcal` elsewhere.

**Fix A:** Accept `tzOffsetMinutes` parameter, compute hours from UTC adjusted by offset.
**Fix B:** Add optional chaining.

---

### Task 4: Fix supplement amount for serving-based items

**Files:** `shared/nutrition-supplements-panel.js:93`

**Bug:** When `base_unit === "serving"`, amount is hardcoded to 1 regardless of the plan's prescribed dose. If the plan says "take 2 capsules", only 1 serving is logged.

**Fix:** Use `supp.amount` for serving-based supplements (clamped to at least 1).

---
