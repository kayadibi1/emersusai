// scripts/embed-evidence.js
// CLI wrapper around the embed-batch pg-boss job. Preserves interactive UX
// by enqueueing, tailing progress, and exiting with the job's status.
//
// --direct: bypass the queue and run the old script logic inline.
//           (imports embed-evidence-direct.js and calls its exported main())
// --detach: enqueue and exit immediately with the job ID on stdout.
//
// Original embed logic lives in scripts/embed-evidence-direct.js.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    limit:   { type: "string",  default: "1000" },
    dryRun:  { type: "boolean", default: false },
    direct:  { type: "boolean", default: false },
    detach:  { type: "boolean", default: false },
  },
});

if (values.direct) {
  // Import the direct module and call its exported main(). The guard in
  // embed-evidence-direct.js prevents auto-run on import, so we call explicitly.
  const { main } = await import("./embed-evidence-direct.js");
  await main().catch((err) => {
    console.error("SCRIPT ERROR:", err);
    process.exit(1);
  });
  process.exit(0);
}

await runAsJob("embed-batch", {
  limit: Number(values.limit),
  dryRun: values.dryRun,
}, { detach: values.detach });
