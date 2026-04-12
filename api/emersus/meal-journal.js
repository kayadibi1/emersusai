// api/emersus/meal-journal.js
//
// Meal journal write-path. All routes use the caller's JWT; RLS handles
// authorization. Snapshot math is delegated to Postgres RPCs so the client
// never computes macros.
// Mounted by server.js via: app.use("/api/emersus/meal-journal", router)

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const router = Router();

// Required fields for each entry in a bulk insert.
const ENTRY_REQUIRED = ["food_id", "logged_date", "meal_slot", "amount", "amount_unit", "source"];

// ─── POST /entries — bulk insert ────────────────────────────────────────────
router.post("/entries", async (req, res) => {
  try {
    const { entries } = req.body ?? {};

    if (!Array.isArray(entries)) {
      res.status(400).json({ error: "entries_must_be_array" });
      return;
    }
    if (entries.length < 1 || entries.length > 50) {
      res.status(400).json({ error: "entries_count_out_of_range", min: 1, max: 50 });
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      for (const field of ENTRY_REQUIRED) {
        if (e[field] === undefined || e[field] === null || e[field] === "") {
          res.status(400).json({ error: "entry_missing_required_field", index: i, field });
          return;
        }
      }
    }

    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc("insert_meal_journal_entries", {
      p_entries: entries,
    });
    if (error) {
      console.error("[meal-journal:addEntries]", error);
      res.status(500).json({ error: "insert_failed", detail: error.message });
      return;
    }
    res.json({ entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:addEntries]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── PATCH /entries/:id — update a single entry ─────────────────────────────
router.patch("/entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      amount_unit,
      meal_slot,
      notes,
      servings,
      servings_unit,
    } = req.body ?? {};

    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc("update_meal_journal_entry", {
      p_id:           id,
      p_amount:       amount        ?? null,
      p_amount_unit:  amount_unit   ?? null,
      p_meal_slot:    meal_slot     ?? null,
      p_notes:        notes         ?? null,
      p_servings:     servings      ?? null,
      p_servings_unit: servings_unit ?? null,
    });
    if (error) {
      console.error("[meal-journal:updateEntry]", error);
      res.status(500).json({ error: "update_failed", detail: error.message });
      return;
    }
    res.json({ entry: data ?? null });
  } catch (err) {
    console.error("[meal-journal:updateEntry]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── DELETE /entries/:id — delete ───────────────────────────────────────────
router.delete("/entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);
    const { error } = await supabase
      .from("meal_journal_entries")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[meal-journal:deleteEntry]", error);
      res.status(500).json({ error: "delete_failed", detail: error.message });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[meal-journal:deleteEntry]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── POST /copy-day — clone a day's entries ──────────────────────────────────
router.post("/copy-day", async (req, res) => {
  try {
    const { source_date, target_date, meal_slots } = req.body ?? {};

    if (!source_date || !target_date) {
      res.status(400).json({ error: "source_date_and_target_date_required" });
      return;
    }

    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc("copy_meal_journal_day", {
      p_source_date: source_date,
      p_target_date: target_date,
      p_meal_slots:  meal_slots ?? null,
    });
    if (error) {
      console.error("[meal-journal:copyDay]", error);
      res.status(500).json({ error: "copy_failed", detail: error.message });
      return;
    }
    res.json({ entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:copyDay]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── GET /day — fetch a day's journal with food join ────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/day", async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || !DATE_RE.test(date)) {
      res.status(400).json({ error: "date_required_yyyy_mm_dd" });
      return;
    }

    const supabase = clientForRequest(req);
    const { data, error } = await supabase
      .from("meal_journal_entries")
      .select(
        `id, logged_date, meal_slot, logged_at,
         amount, amount_unit, servings, servings_unit,
         source, confidence, notes,
         kcal_snapshot, protein_g_snapshot, carbs_g_snapshot,
         fat_g_snapshot, fiber_g_snapshot, plan_id,
         food:foods(id, description, kind, brand_name, source, form, common_unit, common_unit_grams)`
      )
      .eq("logged_date", date)
      .order("logged_at", { ascending: true });

    if (error) {
      console.error("[meal-journal:getDayJournal]", error);
      res.status(500).json({ error: "fetch_failed", detail: error.message });
      return;
    }
    res.json({ date, entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:getDayJournal]", err);
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
