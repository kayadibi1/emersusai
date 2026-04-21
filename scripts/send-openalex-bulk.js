// scripts/send-openalex-bulk.js
// CLI wrapper to enqueue an ingest-openalex-bulk job. File must already
// exist at ~/data/openalex-bulk/<filename> on the box (OPENALEX_BULK_DIR
// overrides the dir). Tails progress until the job terminates.
//
//   node scripts/send-openalex-bulk.js --filename matches-2026-04-21.jsonl.gz
//
// See docs/openalex-bulk-plan.md for the end-to-end pipeline.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    filename: { type: "string" },
    detach:   { type: "boolean", default: false },
  },
});

if (!values.filename) {
  console.error("Usage: node scripts/send-openalex-bulk.js --filename <name>.jsonl.gz [--detach]");
  process.exit(2);
}

await runAsJob("ingest-openalex-bulk", { filename: values.filename }, { detach: values.detach });
