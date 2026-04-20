// api/emersus/meal-plans.js
//
// Meal plans CRUD. All routes use the caller's JWT; RLS handles authorization.
// Mounted by server.js via: app.use("/api/emersus/meal-plans", router)

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { validateMealPlan } from "../../shared/meal-plan-schema.js";

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

// ─── POST / — save a new meal plan ─────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { title, plan, source_thread_id, last_adjusted_via } = req.body ?? {};
    if (!title || typeof title !== "string" || title.length > 256) {
      res.status(400).json({ error: "title_required" });
      return;
    }
    const v = validateMealPlan(plan);
    if (!v.valid) {
      res.status(400).json({ error: "invalid_plan", details: v.errors });
      return;
    }

    const supabase = clientForRequest(req);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    // Look up tier. Pro users get additive saves (keep existing active
    // plans, add a new one); Free users get the replace-on-save flow
    // where the old active plan is archived before insert.
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .maybeSingle();
    const tier = profileRow?.tier === "pro" ? "pro" : "free";

    // Fetch any existing active plan (Free uses it for previous_plan /
    // auto-archive; Pro only uses it as a seed for previous_plan on the
    // undo chain).
    const { data: existing, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("id, plan, updated_at")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fetchErr) {
      console.error("[meal-plans:save] fetch error:", fetchErr);
      res.status(500).json({ error: "save_failed" });
      return;
    }

    if (tier === "free" && existing?.id) {
      // Auto-archive only for Free so UX stays replace-on-save (matches
      // today's behavior before tier-aware changes).
      const { error: archiveErr } = await supabase
        .from("meal_plans")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (archiveErr) {
        console.error("[meal-plans:save] archive error:", archiveErr);
        res.status(500).json({ error: "save_failed" });
        return;
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("meal_plans")
      .insert({
        user_id: user.id,
        title,
        plan,
        previous_plan: existing?.plan ?? null,
        source_thread_id: source_thread_id ?? null,
        last_adjusted_via: last_adjusted_via ?? "chat",
        last_adjusted_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertErr) {
      // DB trigger for Free-tier cap raises P0001 with a stable prefix.
      // Promote to 403 with a typed error code the client can match.
      if (
        insertErr.code === "P0001" &&
        String(insertErr.message || "").includes("meal_plans_free_limit_exceeded")
      ) {
        res.status(403).json({
          error: "meal_plans_free_limit_exceeded",
          message:
            "Free tier allows 1 active meal plan. Archive your current plan or upgrade to Pro for multiple.",
        });
        return;
      }
      console.error("[meal-plans:save] insert error:", insertErr);
      res.status(500).json({ error: "save_failed" });
      return;
    }
    res.json({ meal_plan: inserted });
  } catch (err) {
    console.error("[meal-plans:save] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── GET /active — return the user's active plan ───────────────────────────
router.get("/active", async (req, res) => {
  try {
    const supabase = clientForRequest(req);
    const { data, error } = await supabase
      .from("meal_plans")
      .select("*")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[meal-plans:active] error:", error);
      res.status(500).json({ error: "fetch_failed" });
      return;
    }
    res.json({ meal_plan: data ?? null });
  } catch (err) {
    console.error("[meal-plans:active] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── PATCH /:id/assignments — update assignments only ──────────────────────
router.patch("/:id/assignments", async (req, res) => {
  try {
    const { id } = req.params;
    const { overrides, mode, default_day_type } = req.body ?? {};
    const supabase = clientForRequest(req);

    const { data: existing, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("plan")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const newPlan = { ...existing.plan };
    newPlan.assignments = {
      ...(existing.plan.assignments ?? {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(default_day_type !== undefined ? { default_day_type } : {}),
      ...(overrides !== undefined ? { overrides } : {}),
    };

    const v = validateMealPlan(newPlan);
    if (!v.valid) {
      res.status(400).json({ error: "invalid_plan", details: v.errors });
      return;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("meal_plans")
      .update({
        plan: newPlan,
        previous_plan: existing.plan,
        last_adjusted_via: "manual",
        last_adjusted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) {
      console.error("[meal-plans:patch] error:", updateErr);
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.json({ meal_plan: updated });
  } catch (err) {
    console.error("[meal-plans:patch] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── POST /:id/archive ─────────────────────────────────────────────────────
router.post("/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);
    const { error } = await supabase
      .from("meal_plans")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[meal-plans:archive] error:", error);
      res.status(500).json({ error: "archive_failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[meal-plans:archive] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ─── POST /:id/undo ────────────────────────────────────────────────────────
router.post("/:id/undo", async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);

    const { data: row, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("plan, previous_plan")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!row.previous_plan) {
      res.status(400).json({ error: "nothing_to_undo" });
      return;
    }

    const v = validateMealPlan(row.previous_plan);
    if (!v.valid) {
      res.status(400).json({ error: "previous_plan_invalid", details: v.errors });
      return;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("meal_plans")
      .update({
        plan: row.previous_plan,
        previous_plan: row.plan,
        last_adjusted_via: "manual",
        last_adjusted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) {
      console.error("[meal-plans:undo] error:", updateErr);
      res.status(500).json({ error: "undo_failed" });
      return;
    }
    res.json({ meal_plan: updated });
  } catch (err) {
    console.error("[meal-plans:undo] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
