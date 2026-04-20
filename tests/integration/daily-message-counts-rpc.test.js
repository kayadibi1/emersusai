// tests/integration/daily-message-counts-rpc.test.js
// Integration test for the atomic per-user daily-message counter RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(
  __dirname,
  "../../supabase/20260421_daily_message_counts.sql"
);

async function setup(client) {
  // Stub auth.users so the FK compiles. In prod this schema already exists.
  // service_role is cluster-level and survives DROP SCHEMA, so create
  // idempotently via a DO block.
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
  `);
  await client.query(readFileSync(MIGRATION, "utf8"));
}

test("check_and_increment: allows up to limit, blocks past it", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const {
      rows: [u],
    } = await client.query(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
    );

    for (let i = 1; i <= 3; i++) {
      const { rows } = await client.query(
        `SELECT * FROM public.check_and_increment_message_count($1, 3)`,
        [u.id]
      );
      assert.equal(rows[0].allowed, true, `call ${i} should be allowed`);
      assert.equal(rows[0].new_count, i);
      assert.equal(rows[0].day_limit, 3);
    }

    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 3)`,
      [u.id]
    );
    assert.equal(rows[0].allowed, false, "4th call must be blocked");
    assert.equal(rows[0].new_count, 3, "counter rolled back to cap");

    const { rows: stored } = await client.query(
      `SELECT count FROM public.daily_message_counts WHERE user_id = $1`,
      [u.id]
    );
    assert.equal(stored[0].count, 3, "stored count capped at limit");
  });
});

test("check_and_increment: isolates by user", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const {
      rows: [a],
    } = await client.query(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
    );
    const {
      rows: [b],
    } = await client.query(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
    );
    for (let i = 0; i < 2; i++) {
      await client.query(
        `SELECT * FROM public.check_and_increment_message_count($1, 2)`,
        [a.id]
      );
    }
    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 2)`,
      [b.id]
    );
    assert.equal(rows[0].allowed, true);
    assert.equal(rows[0].new_count, 1);
  });
});

test("check_and_increment: returns reset_at as next UTC midnight", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const {
      rows: [u],
    } = await client.query(
      `INSERT INTO auth.users DEFAULT VALUES RETURNING id`
    );
    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 10)`,
      [u.id]
    );
    const resetAt = new Date(rows[0].reset_at);
    const today = new Date();
    const expected = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 1
      )
    );
    assert.equal(resetAt.toISOString(), expected.toISOString());
  });
});
