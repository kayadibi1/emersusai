// scripts/backfill-icite-rcr.js
// CLI wrapper for the rcr-backfill pg-boss job.
// --direct bypasses the queue and runs the old script inline.
// --detach enqueues without tailing.
//
// Original iCite RCR backfill logic lives in scripts/backfill-icite-rcr-direct.js.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    limit:     { type: "string",  default: "0" },
    batchSize: { type: "string",  default: "200" },
    direct:    { type: "boolean", default: false },
    detach:    { type: "boolean", default: false },
  },
});

if (values.direct) {
  const { main } = await import("./backfill-icite-rcr-direct.js");
  await main().catch((err) => {
    console.error("SCRIPT ERROR:", err);
    process.exit(1);
  });
  process.exit(0);
}

await runAsJob("rcr-backfill", {
  limit: Number(values.limit),
  batchSize: Number(values.batchSize),
}, { detach: values.detach });
