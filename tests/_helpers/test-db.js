// tests/_helpers/test-db.js
// Shared helper for integration tests that need a real Postgres.
// Connects to the local docker-compose test postgres on port 54329.
import pg from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://testuser:testpass@127.0.0.1:54329/emersus_test";

export function getTestDbUrl() {
  return TEST_DATABASE_URL;
}

export async function withTestClient(fn) {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function resetSchema() {
  await withTestClient(async (client) => {
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO testuser;
      CREATE EXTENSION IF NOT EXISTS vector;
    `);
  });
}
