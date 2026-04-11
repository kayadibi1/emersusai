// scripts/backfill-semantic-scholar.js
// CLI wrapper for the s2-citation-backfill pg-boss job.
// --direct bypasses the queue and runs the old script inline.
// --detach enqueues without tailing.
//
// Original backfill logic lives in scripts/backfill-semantic-scholar-direct.js.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    limit:     { type: "string",  default: "5000" },
    batchSize: { type: "string",  default: "500" },
    direct:    { type: "boolean", default: false },
    detach:    { type: "boolean", default: false },
  },
});

if (values.direct) {
  const { main } = await import("./backfill-semantic-scholar-direct.js");
  await main().catch((err) => {
    console.error("SCRIPT ERROR:", err);
    process.exit(1);
  });
  process.exit(0);
}

await runAsJob("s2-citation-backfill", {
  limit: Number(values.limit),
  batchSize: Number(values.batchSize),
}, { detach: values.detach });
