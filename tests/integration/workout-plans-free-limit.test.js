// tests/integration/workout-plans-free-limit.test.js
// Verifies the BEFORE INSERT trigger enforces 3 active plans for Free
// and is inert for Pro. Archived plans don't count against the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER_MIG = resolve(__dirname, "../../supabase/20260421_profile_tier_column.sql");
const TRIGGER_MIG = resolve(__dirname, "../../supabase/20260421_workout_plans_free_limit.sql");

async function setup(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS public.workout_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      schema_version integer NOT NULL DEFAULT 1,
      plan jsonb NOT NULL,
      archived_at timestamptz
    );
  `);
  await client.query(readFileSync(TIER_MIG, "utf8"));
  await client.query(readFileSync(TRIGGER_MIG, "utf8"));
}

async function makeUser(client, { tier = "free" } = {}) {
  const { rows } = await client.query(
    `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
  );
  const id = rows[0].id;
  await client.query(
    `INSERT INTO public.profiles (id, tier) VALUES ($1, $2)`,
    [id, tier]
  );
  return id;
}

async function insertPlan(client, userId, i) {
  await client.query(
    `INSERT INTO public.workout_plans (user_id, title, plan)
     VALUES ($1, $2, '{}'::jsonb)`,
    [userId, `Plan ${i}`]
  );
}

test("free tier: 3 plans ok, 4th rejected with stable error", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "free" });
    for (let i = 1; i <= 3; i++) await insertPlan(client, u, i);

    await assert.rejects(
      () => insertPlan(client, u, 4),
      /workout_plans_free_limit_exceeded/
    );
  });
});

test("pro tier: 4+ plans ok", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "pro" });
    for (let i = 1; i <= 5; i++) await insertPlan(client, u, i);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.workout_plans WHERE user_id = $1`,
      [u]
    );
    assert.equal(rows[0].n, 5);
  });
});

test("archived plans don't count toward the free cap", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "free" });
    for (let i = 1; i <= 3; i++) await insertPlan(client, u, i);
    // Archive two of them
    await client.query(
      `UPDATE public.workout_plans
         SET archived_at = now()
       WHERE user_id = $1
         AND title IN ('Plan 1', 'Plan 2')`,
      [u]
    );
    // Now only 1 active — should allow 2 more
    await insertPlan(client, u, 4);
    await insertPlan(client, u, 5);
    // 3rd would bring us back to 3 active
    await assert.rejects(
      () => insertPlan(client, u, 6),
      /workout_plans_free_limit_exceeded/
    );
  });
});

test("missing profile row defaults to free-tier cap (not bypass)", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const { rows } = await client.query(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
    );
    const u = rows[0].id;
    // No profile row at all → treated as free
    for (let i = 1; i <= 3; i++) await insertPlan(client, u, i);
    await assert.rejects(
      () => insertPlan(client, u, 4),
      /workout_plans_free_limit_exceeded/
    );
  });
});
