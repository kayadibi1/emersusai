# Topic Discovery Pipeline Runbook

**Status:** Ready for phase 1 deploy as of 69a15297
**Spec:** docs/superpowers/specs/2026-04-11-topic-discovery-pipeline-design.md
**Plan:** docs/superpowers/plans/2026-04-11-topic-discovery-pipeline.md

## Prerequisites before phase 1

1. The in-flight `npm run fill:pmc:topics` run on Hetzner has completed (check with `ssh hetzner 'pgrep -af "fill-pmc"'` — empty output means done).
2. Hetzner Postgres has an automated nightly backup configured. Verify with `ssh hetzner 'ls -lah /var/backups/emersus/ | tail -5'` — should show dumps from last 7 days. If absent, configure before proceeding (see "Configuring backup" below).
3. The `feat/topic-discovery-pipeline` branch has been merged to `main` on GitHub and deployed to Hetzner via the git webhook (verify with `ssh hetzner 'cd ~/app && git log --oneline -3'`).
4. `~/app/.env` on Hetzner contains: `ADMIN_EMAILS`, optionally `ALERT_EMAILS`, `S2_API_KEY`, all existing keys.

## Phase 1 — Schema & seed

### Apply migrations in order

SSH to Hetzner, run each migration against the self-hosted Supabase Postgres as `supabase_admin`:

```bash
ssh hetzner
cd ~/app
for f in \
  supabase/20260412_research_articles_rename_and_columns.sql \
  supabase/20260412_research_topics_and_candidates.sql \
  supabase/20260412_discovery_feeds.sql \
  supabase/20260412_job_progress.sql \
  supabase/20260412_alerts_and_heartbeat.sql \
  supabase/20260412_match_evidence_chunks_v2.sql; do
  echo "=== Applying $f ==="
  docker exec -i supabase-db psql -U supabase_admin -d postgres < "$f"
done
```

Expected: each `=== Applying ... ===` is followed by a `COMMIT` or table-creation output, no errors.

**Rollback if a migration fails halfway**:

```bash
# Restore from most recent backup (listed in /var/backups/emersus/)
ssh hetzner
sudo gunzip -c /var/backups/emersus/emersus-YYYY-MM-DD.sql.gz | docker exec -i supabase-db psql -U supabase_admin -d postgres
```

(If you don't have a backup, you're in trouble — see "Configuring backup" below to prevent this.)

### Seed data

```bash
# From your laptop, against prod (via ~/.env.local with SUPABASE_URL=https://supabase.emersus.ai):
node scripts/seed-research-topics.js
node scripts/seed-discovery-feeds.js
```

Expected:
- seed-research-topics: "seeded: 302 inserted, 0 updated, 302 total" on first run
- seed-discovery-feeds: "seeded: 21 inserted, 0 updated, 21 total"

Re-running either is idempotent (prints 0 inserted / 302+ updated) — safe to retry.

### Verify retrieval still works

Hit the existing chat endpoint with a retrieval-triggering query:

```bash
curl -s 'https://emersus.ai/api/chat' -X POST -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What does the research say about creatine loading phases?"}]}' \
  | head -100
```

Expected: streaming response with evidence citations. If retrieval returns 0 results or throws an error, the rename + RPC update broke something — rollback and investigate.

## Phase 2 — Worker deploy

### Add pm2 entry for emersus-worker

On Hetzner, edit `~/app/infra/ecosystem.config.cjs` (local-only file, not in git) to add:

```js
{
  name: "emersus-worker",
  script: "worker/index.js",
  env: {
    NODE_ENV: "production",
    // DATABASE_URL, OPENAI_API_KEY, S2_API_KEY, RESEND_API_KEY, ALERT_EMAILS, ADMIN_EMAILS
    // all inherited from ~/app/.env via pm2 --update-env
  },
  max_memory_restart: "512M",
  restart_delay: 5000,
}
```

Start it:

```bash
ssh hetzner
cd ~/app
pm2 start ecosystem.config.cjs --only emersus-worker --update-env
pm2 save
pm2 logs emersus-worker --lines 50
```

Expected log output (JSON lines on stderr):
- `"msg":"pg-boss started"`
- `"msg":"heartbeat started"`
- `"msg":"all 12 handlers registered + 4 schedules"`
- `"msg":"worker ready"`

If you see `"level":"error"` for pg-boss startup, the database user may be missing `CREATE SCHEMA` permission on the pgboss schema. Grant and restart:

```sql
GRANT CREATE ON DATABASE postgres TO supabase_admin;  -- or the user in DATABASE_URL
```

### Add heartbeat watchdog to Hetzner crontab

```bash
ssh hetzner
crontab -e
# Add:
*/2 * * * * cd /home/emersus/app && /usr/bin/node scripts/heartbeat-watchdog.js >> /var/log/emersus-heartbeat-watchdog.log 2>&1
```

### Smoke tests

```bash
# Send a test alert (confirms Resend + alert_log pipeline)
ssh hetzner 'cd ~/app && node scripts/send-test-alert.js'
# Expected: email arrives within ~10s; run should exit 0

# Enqueue discovery manually to verify end-to-end
ssh hetzner 'cd ~/app && node scripts/discover-topics.js'
# Expected: progress log lines, job completes, topic_candidates rows appear

# Check the admin panel
# Open https://emersus.ai/admin/candidates in a browser
# (you must be logged in with an email in ADMIN_EMAILS env var)
```

## Phase 3 — Cutover (optional, by default schedules are already live)

After the worker is running, pg-boss's internal scheduler is already firing the 4 scheduled jobs. No additional action is needed unless you want to pause or unschedule them.

### Managing schedules

Via direct SQL:

```sql
-- List schedules
SELECT name, cron, timezone FROM pgboss.schedule;
-- Unschedule (pause)
DELETE FROM pgboss.schedule WHERE name = 'discovery-weekly';
-- Re-enable: restart the worker; worker/index.js + jobs/_registry.js re-creates schedules on startup
```

## Rollback procedures

### Rollback phase 1 (schema)

If retrieval broke or a migration is bad:

```bash
# Restore from backup (fastest, cleanest)
ssh hetzner
sudo gunzip -c /var/backups/emersus/emersus-YYYY-MM-DD.sql.gz | docker exec -i supabase-db psql -U supabase_admin -d postgres
pm2 restart emersus-api  # force re-read of search_path etc
```

If no backup available, manually reverse:

```sql
-- Reverse the rename
ALTER TABLE public.research_articles RENAME TO pubmed_articles;
ALTER INDEX research_articles_pmid_idx RENAME TO pubmed_articles_pmid_idx;

-- Drop new columns
ALTER TABLE public.pubmed_articles
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS peer_reviewed,
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS source_metadata;

-- Drop new tables
DROP TABLE IF EXISTS public.research_topics CASCADE;
DROP TABLE IF EXISTS public.topic_candidates CASCADE;
DROP TABLE IF EXISTS public.discovery_feeds CASCADE;
DROP TABLE IF EXISTS public.job_progress CASCADE;
DROP TABLE IF EXISTS public.worker_heartbeats CASCADE;
DROP TABLE IF EXISTS public.alert_log CASCADE;

-- Restore match_evidence_chunks v1 from git:
-- 20260410_match_evidence_chunks_retraction_filter.sql
```

### Rollback phase 2 (worker)

```bash
ssh hetzner
pm2 stop emersus-worker
pm2 delete emersus-worker  # removes from pm2 list
# Remove the crontab line for heartbeat-watchdog
```

API stays up — worker is a separate process.

### Rollback phase 3 (schedules)

Schedules live in `pgboss.schedule`. To kill everything:

```sql
DELETE FROM pgboss.schedule;
```

Restart the worker to recreate them, or leave deleted if you want to stop the pipeline entirely.

## Configuring backup (if absent)

Add to Hetzner crontab:

```bash
ssh hetzner
sudo mkdir -p /var/backups/emersus
sudo chown emersus:emersus /var/backups/emersus
crontab -e
# Add:
0 3 * * * docker exec supabase-db pg_dump -U supabase_admin -d postgres --no-owner --no-privileges 2>/var/log/emersus-backup.log | gzip > /var/backups/emersus/emersus-$(date +\%Y-\%m-\%d).sql.gz
# Optional retention (keep last 14):
5 3 * * * find /var/backups/emersus/ -name 'emersus-*.sql.gz' -mtime +14 -delete
```

Verify first run: `sudo ls -lah /var/backups/emersus/ | head -5` next morning.

## Monitoring & observability

- **Admin dashboard**: https://emersus.ai/admin/ (requires email in ADMIN_EMAILS env)
- **Jobs view**: https://emersus.ai/admin/jobs — live list with progress tail
- **Pm2 logs**: `ssh hetzner 'pm2 logs emersus-worker --lines 100'`
- **Alert log**: https://emersus.ai/admin/alerts — 30-day email history
- **Daily digest**: 08:00 America/New_York, sent to ALERT_EMAILS. Missing digest = something is broken.

## Common operations

### Manually re-run discovery

```bash
ssh hetzner 'cd ~/app && node scripts/discover-topics.js'
```

### Retry a failed job

Via admin UI: open /admin/jobs?state=failed, click a row, click "Retry". OR directly:

```bash
ssh hetzner 'cd ~/app && node scripts/jobs-tail.js <failed-job-id>'
# To re-enqueue, use the admin UI button
```

### Validate topic queries after bulk edits

```bash
ssh hetzner 'cd ~/app && node scripts/validate-pubmed-queries.js --topics=creatine,magnesium'
```

Expected: PASS/WARN/FAIL classification per topic. Fix any FAIL queries in `research_topics` via the /admin/topics UI.

### Force-ingest a topic from one source

Via admin UI: /admin/topics → pick topic → click "Ingest" → choose source. OR:

```bash
ssh hetzner 'cd ~/app && node -e "
import PgBoss from \"pg-boss\";
const boss = new PgBoss(process.env.DATABASE_URL);
await boss.start();
await boss.createQueue(\"ingest-topic-from-source\").catch(()=>{});
const id = await boss.send(\"ingest-topic-from-source\", {topicId: 123, sourceId: \"europepmc\", target: 500});
console.log(\"enqueued\", id);
await boss.stop();
"'
```
