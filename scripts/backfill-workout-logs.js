// One-time backfill: populate workout_logs from existing completed_blocks.
// Run: node scripts/backfill-workout-logs.js
// Safe to re-run (upsert_workout_logs deletes + re-inserts per session).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log("Fetching all workout plans...");

  const { data: plans, error: plansErr } = await supabase
    .from("workout_plans")
    .select("id, user_id, plan")
    .is("archived_at", null);

  if (plansErr) throw plansErr;
  console.log(`Found ${plans.length} active plans.`);

  let totalSessions = 0;
  let totalRows = 0;

  for (const planRow of plans) {
    const sessions = planRow.plan?.sessions || [];

    for (const session of sessions) {
      const completed = session.completed_blocks;
      if (!completed || completed.length === 0) continue;

      // Enrich with exercise names from the plan's blocks
      const blocks = completed.map(cb => {
        const planBlock =
          (session.blocks || []).find(b => b.id === cb.block_id) ||
          (session.warmup_blocks || []).find(b => b.id === cb.block_id);
        return { ...cb, exercise_name: planBlock?.name || "" };
      }).filter(b => b.exercise_name);

      if (blocks.length === 0) continue;

      const performedAt = session.date || planRow.plan.start_date || new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase.rpc("upsert_workout_logs", {
        p_user_id: planRow.user_id,
        p_plan_id: planRow.id,
        p_session_id: session.id,
        p_performed_at: performedAt,
        p_blocks: blocks,
      });

      if (error) {
        console.error(`  ERROR session ${session.id} in plan ${planRow.id}:`, error.message);
        continue;
      }

      totalSessions++;
      totalRows += data?.rows_inserted || 0;
      console.log(`  Plan ${planRow.id} / ${session.id}: ${data?.rows_inserted || 0} rows`);
    }
  }

  console.log(`\nDone. ${totalSessions} sessions backfilled, ${totalRows} total log rows.`);
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
