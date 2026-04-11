// worker/context.js
// Creates the per-job context object passed to handlers. Carries:
//   - data: the job payload
//   - signal: an AbortSignal the handler should poll for cancellation
//   - abort: trigger the signal (called by the worker when pg-boss cancels)
//   - progress: async (message, level='info') => insert into job_progress

/**
 * @param {{ id: string, data: object }} jobRow
 * @param {(strings: TemplateStringsArray, ...vals: any[]) => Promise<{rows: any[]}>} sql
 *   tagged-template sql helper bound to a pg client or pool
 */
export function makeContext(jobRow, sql) {
  const controller = new AbortController();
  return {
    data: jobRow.data ?? {},
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (message, level = "info") => {
      if (level !== "info" && level !== "warn" && level !== "error") {
        throw new Error(`bad level: ${level}`);
      }
      await sql`
        INSERT INTO job_progress (job_id, level, message)
        VALUES (${jobRow.id}, ${level}, ${message})
      `;
    },
  };
}
