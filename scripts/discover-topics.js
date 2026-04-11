// scripts/discover-topics.js
// CLI wrapper for the discovery-weekly pg-boss job.
// Usually run by the pg-boss schedule (Monday 3am NY), but can be invoked
// manually by operators for on-demand discovery.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    detach: { type: "boolean", default: false },
  },
});

await runAsJob("discovery-weekly", {}, { detach: values.detach });
