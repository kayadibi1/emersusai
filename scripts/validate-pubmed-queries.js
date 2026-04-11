// scripts/validate-pubmed-queries.js
// CLI wrapper for the validate-queries pg-boss job.
// --direct bypasses the queue and runs the old script inline (reads
// TOPIC_QUERIES from fill-pmc-topics.js via regex — the original behavior).
// --detach enqueues without tailing.
//
// Arg names preserved from the original script:
//   --topics=creatine,sleep   (comma-separated topic keys)
//   --min-count=100           (pass threshold, maps to passMin in job payload)
//   --warn-count=10           (warn threshold, maps to warnMin in job payload)
//
// The job handler version (M6) reads from the research_topics DB table instead.
// Both execution paths remain operational for different operational purposes.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    topics:     { type: "string",  default: "" },
    "min-count":  { type: "string",  default: "100" },
    "warn-count": { type: "string",  default: "10" },
    direct:     { type: "boolean", default: false },
    detach:     { type: "boolean", default: false },
  },
});

if (values.direct) {
  const { main } = await import("./validate-pubmed-queries-direct.js");
  await main().catch((err) => {
    console.error("SCRIPT ERROR:", err);
    process.exit(1);
  });
  process.exit(0);
}

await runAsJob("validate-queries", {
  topics: values.topics ? values.topics.split(",").map(s => s.trim()).filter(Boolean) : [],
  passMin: Number(values["min-count"]),
  warnMin: Number(values["warn-count"]),
}, { detach: values.detach });
