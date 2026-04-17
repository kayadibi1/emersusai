// jobs/memory-ttl-archive.js
//
// Phase 6: nightly archival sweep over user_memories.
//
// Sets status='archived' on confirmed rows whose expires_at has passed.
// Tier TTLs (per spec §4.3): A=indefinite, B=120d, C=indefinite,
// D=21d, E=180d, X=indefinite. Only rows with a non-null expires_at are
// ever touched — indefinite tiers stay as-is.
//
// Archival is non-destructive: rows stay in the table (visible to the user
// in Profile › Memory's Archive section), just stop appearing in RAG / always-inject.
// Hard-delete is a user action via the danger zone.
//
// Payload: { dryRun?: boolean, limit?: number } — defaults { dryRun: false, limit: 2000 }
// Returns: { archived, scanned, dryRun, cutoffIso }

const DEFAULT_LIMIT = 2000;

export async function memoryTtlArchiveHandler(ctx, deps) {
  const { dryRun = false, limit = DEFAULT_LIMIT } = ctx.data || {};
  const { sql } = deps;

  await ctx.progress(`TTL archival sweep start (dryRun=${dryRun}, limit=${limit})`);

  const cutoffIso = new Date().toISOString();

  // Count candidates for observability even when dry-running.
  const countRows = await sql`
    SELECT count(*)::int as n
    FROM public.user_memories
    WHERE status = 'confirmed'
      AND expires_at IS NOT NULL
      AND expires_at < now()
  `;
  const scanned = countRows.rows?.[0]?.n ?? 0;

  if (scanned === 0) {
    await ctx.progress(`nothing to archive at ${cutoffIso}`);
    return { archived: 0, scanned: 0, dryRun, cutoffIso };
  }

  if (dryRun) {
    await ctx.progress(`dry run — would archive ${scanned} rows`);
    return { archived: 0, scanned, dryRun: true, cutoffIso };
  }

  // Batched UPDATE via a CTE so we bound the write size per run and
  // get back the count reliably across pg drivers.
  const result = await sql`
    WITH doomed AS (
      SELECT id
      FROM public.user_memories
      WHERE status = 'confirmed'
        AND expires_at IS NOT NULL
        AND expires_at < now()
      ORDER BY expires_at ASC
      LIMIT ${limit}
    )
    UPDATE public.user_memories m
    SET status = 'archived',
        resolved_at = now()
    FROM doomed d
    WHERE m.id = d.id
    RETURNING m.id
  `;
  const archived = result.rowCount ?? result.rows?.length ?? 0;

  await ctx.progress(`archived ${archived} of ${scanned} expired memory rows`);
  return { archived, scanned, dryRun, cutoffIso };
}
