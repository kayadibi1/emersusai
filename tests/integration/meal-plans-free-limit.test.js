// tests/integration/meal-plans-free-limit.test.js
// Locks the meal_plans tier-aware trigger: Free = 1 active plan max;
// Pro = unlimited active plans; archived plans never count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIER_MIG = resolve(__dirname, "../../supabase/20260421_profile_tier_column.sql");
const TRIGGER_MIG = resolve(__dirname, "../../supabase/20260421_meal_plans_tier_aware.sql");

async function setup(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS public.meal_plans (
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
    `INSERT INTO public.meal_plans (user_id, title, plan)
     VALUES ($1, $2, '{}'::jsonb)`,
    [userId, `Plan ${i}`]
  );
}

test("free tier: 1 active plan ok, 2nd rejected", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "free" });
    await insertPlan(client, u, 1);
    await assert.rejects(
      () => insertPlan(client, u, 2),
      /meal_plans_free_limit_exceeded/
    );
  });
});

test("pro tier: unlimited active plans", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "pro" });
    for (let i = 1; i <= 5; i++) await insertPlan(client, u, i);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.meal_plans WHERE user_id = $1`,
      [u]
    );
    assert.equal(rows[0].n, 5);
  });
});

test("free tier: archived plan frees up the slot", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const u = await makeUser(client, { tier: "free" });
    await insertPlan(client, u, 1);
    // Archive the first plan
    await client.query(
      `UPDATE public.meal_plans SET archived_at = now() WHERE user_id = $1`,
      [u]
    );
    // Now allowed to save a new one
    await insertPlan(client, u, 2);
    // But still only 1 active allowed
    await assert.rejects(
      () => insertPlan(client, u, 3),
      /meal_plans_free_limit_exceeded/
    );
  });
});
