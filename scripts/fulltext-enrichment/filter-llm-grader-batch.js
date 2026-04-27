// scripts/fulltext-enrichment/filter-llm-grader-batch.js
//
// OpenAI Batch API variant of filter-llm-grader.js. Same prompt + output
// format, but uses /v1/batches for 50% pricing and to avoid sync rate limits.
//
// Workflow (end-to-end one-shot):
//   1. Stream input JSONL → group chunks into per-request batches of
//      --batch-size chunks each.
//   2. Build OpenAI batch request files (max 50K requests per batch file).
//   3. Upload each batch file as input_file_id.
//   4. Create one /v1/batches per file.
//   5. Persist batch IDs + request_files to a state JSON for resume safety.
//   6. Poll all batches until status='completed' (or 'failed').
//   7. Download output_file_id contents, parse, join with original chunks
//      via custom_id, write final JSONL with __decision attached.
//
// Resume:
//   - If state file exists at --state=PATH, skip submit phase, jump to poll.
//   - If output JSONL exists and contains all expected chunks, skip everything.
//
// Usage:
//   node scripts/fulltext-enrichment/filter-llm-grader-batch.js \
//     --input=PATH --output=PATH --state=PATH \
//     [--batch-size=N] [--max-rows=N] [--model=NAME] \
//     [--mode=submit|poll|apply|all]
//
// Mode 'all' (default): submit → poll → apply in one process. Will block
// until OpenAI completes the batches. With ~150K requests typical TAT is
// 1-4 hours, worst case 24h.

import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import OpenAI from "openai";

const DEFAULT_MODEL = process.env.OPENAI_FILTER_MODEL || "gpt-5.4-mini";
const DEFAULT_BATCH = 20;             // chunks per LLM request
const TRUNCATE_CONTENT_CHARS = 600;
const REQUESTS_PER_BATCH_FILE = 45_000; // stay below 50K hard limit
const POLL_INTERVAL_MS = 60_000;       // 1 min polls

const SYSTEM_PROMPT = `You classify scientific paper text chunks for an evidence retrieval system focused on fitness, nutrition, and exercise science.

For each numbered chunk, output exactly one verdict: EVIDENCE or NOISE.

WHEN IN DOUBT, output EVIDENCE. The cost of dropping useful methodology or background detail is higher than the cost of keeping a borderline chunk. Only mark NOISE when the chunk is clearly non-evidentiary by the strict definition below.

EVIDENCE (mark this when the chunk contains ANY of):
- Study-specific methods that describe HOW the experiment, intervention, or analysis was actually carried out: specific reagents, doses, instruments, cell lines, protocols, antibodies, inclusion/exclusion rules, recruitment criteria with detail, data-processing steps, modeling specifics, imputation rules, software with task-specific configuration.
- Quantitative findings (effect sizes, p-values, CIs, percentages, group differences, prevalence/incidence rates, mechanism counts).
- Original interpretation by the authors of THIS paper (their claims, mechanisms, conclusions, recommendations, hypotheses about THEIR data).
- Substantive scientific background where the authors are contributing analysis or framing, even if citations are present.
- Specific clinical or experimental observations from this study or a closely related one being reviewed.

NOISE (mark this ONLY when the chunk is clearly one of):
- Acknowledgments, thanks lists, funding statements, conflict declarations, ethics statements, consent language, author contribution lists, data availability statements, trial-registration prose.
- Pure boilerplate that is generic across papers and contains no study-specific detail. Examples that ARE noise: "Statistical analyses were performed using SPSS v26 (IBM Corp, Armonk NY). p < 0.05 was considered statistically significant." — generic and could appear in any paper. Examples that are NOT noise: "We performed missing-value imputation using median values for variables with <10% missing data" — describes a study-specific decision.
- Citation-only paragraphs that list references without the authors of THIS paper contributing analysis. NOTE: a paragraph that synthesizes prior work is EVIDENCE, even if heavily cited.
- Forward references to figures/tables that don't include the data ("As shown in Fig. 3..." with no other content).
- Limitations / future-work hedging that is purely meta-commentary without naming a specific finding or limitation. NOTE: "A limitation of our use of self-report dietary recall is that..." IS evidence; "Future studies should investigate..." is noise.
- Online-content boilerplate ("Any methods, additional references, supplementary information..."), abstract repetition, table caption duplicates.
- Reference-list bleed-through (chains of "Author et al., year" with no prose).
- Cohort historical preamble that is NOT integrated into the current study's analysis.

Format your response as exactly N lines, one per chunk, in this format:
<index>: <VERDICT>

Where <index> is the chunk number from the user message and <VERDICT> is exactly EVIDENCE or NOISE. No prose. No explanation. No extra text.`;

function parseArgs(argv) {
  const a = {
    input: null,
    output: null,
    state: null,
    batchSize: DEFAULT_BATCH,
    maxRows: Infinity,
    model: DEFAULT_MODEL,
    mode: "all",
  };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--input") a.input = v;
    else if (k === "--output") a.output = v;
    else if (k === "--state") a.state = v;
    else if (k === "--batch-size") a.batchSize = Math.max(1, Number(v) || a.batchSize);
    else if (k === "--max-rows") a.maxRows = Number(v) || a.maxRows;
    else if (k === "--model") a.model = v;
    else if (k === "--mode") a.mode = v;
  }
  if (!a.input || !a.output || !a.state) {
    console.error("usage: --input=PATH --output=PATH --state=PATH [--batch-size=N] [--mode=all|submit|poll|apply]");
    process.exit(2);
  }
  return a;
}

function buildUserPrompt(chunks) {
  return chunks
    .map((c, i) => {
      const text = (c.content || "").replace(/\s+/g, " ").trim().slice(0, TRUNCATE_CONTENT_CHARS);
      return `${i + 1}) ${text}`;
    })
    .join("\n\n");
}

function parseDecisions(responseText, batchSize) {
  const decisions = new Array(batchSize).fill("UNKNOWN");
  const lineRe = /^\s*(\d+)\s*[):.\-]\s*(?:`|"|')?\s*(EVIDENCE|NOISE)\b/gim;
  for (const m of responseText.matchAll(lineRe)) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < batchSize) decisions[idx] = m[2].toUpperCase();
  }
  return decisions;
}

// Streaming step 1: build per-batch-file JSONL of OpenAI batch requests.
// Also writes a parallel "chunks index" so we can re-join responses to
// originals later via custom_id.
async function buildBatchFiles(args) {
  const requestDir = path.dirname(args.state) + "/batch-requests";
  const chunksDir = path.dirname(args.state) + "/batch-chunks";
  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(chunksDir, { recursive: true });

  const reqFiles = [];
  const chunkFiles = [];
  let fileIndex = 0;
  let requestCount = 0;
  let totalChunks = 0;
  let currentReqOut = null;
  let currentChunkOut = null;

  function openNextFile() {
    if (currentReqOut) currentReqOut.end();
    if (currentChunkOut) currentChunkOut.end();
    const reqPath = path.join(requestDir, `requests-${fileIndex}.jsonl`);
    const chunkPath = path.join(chunksDir, `chunks-${fileIndex}.jsonl`);
    currentReqOut = fs.createWriteStream(reqPath);
    currentChunkOut = fs.createWriteStream(chunkPath);
    reqFiles.push(reqPath);
    chunkFiles.push(chunkPath);
    fileIndex++;
    requestCount = 0;
  }

  openNextFile();

  const rl = readline.createInterface({
    input: fs.createReadStream(args.input),
    crlfDelay: Infinity,
  });

  let batch = [];
  let read = 0;
  for await (const line of rl) {
    if (read >= args.maxRows) break;
    if (!line.trim()) continue;
    read++;
    let chunk;
    try { chunk = JSON.parse(line); } catch { continue; }
    batch.push(chunk);
    if (batch.length >= args.batchSize) {
      writeBatch(batch);
      batch = [];
    }
  }
  if (batch.length) writeBatch(batch);

  function writeBatch(chunks) {
    if (requestCount >= REQUESTS_PER_BATCH_FILE) openNextFile();
    const customId = `batch-${fileIndex - 1}-req-${requestCount}`;
    const userPrompt = buildUserPrompt(chunks);
    const request = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: args.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 8 * chunks.length + 64,
      },
    };
    currentReqOut.write(JSON.stringify(request) + "\n");
    currentChunkOut.write(JSON.stringify({ custom_id: customId, chunks }) + "\n");
    requestCount++;
    totalChunks += chunks.length;
  }

  if (currentReqOut) await new Promise((r) => currentReqOut.end(r));
  if (currentChunkOut) await new Promise((r) => currentChunkOut.end(r));

  return { reqFiles, chunkFiles, totalChunks, totalRequests: reqFiles.reduce((s, f) => s + countLines(f), 0) };
}

function countLines(filePath) {
  // Quick line count for reporting.
  let n = 0;
  const data = fs.readFileSync(filePath, "utf8");
  for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 10) n++;
  return n;
}

async function submitBatches(client, reqFiles) {
  const batches = [];
  for (const reqFile of reqFiles) {
    console.log(`[batch] uploading ${reqFile}`);
    const fileObj = await client.files.create({
      file: fs.createReadStream(reqFile),
      purpose: "batch",
    });
    console.log(`[batch] created file_id=${fileObj.id} from ${reqFile}`);
    const batch = await client.batches.create({
      input_file_id: fileObj.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });
    console.log(`[batch] submitted batch_id=${batch.id} status=${batch.status}`);
    batches.push({ batch_id: batch.id, file_id: fileObj.id, req_file: reqFile });
  }
  return batches;
}

async function pollBatches(client, batches) {
  const completed = new Map();
  while (completed.size < batches.length) {
    for (const b of batches) {
      if (completed.has(b.batch_id)) continue;
      const status = await client.batches.retrieve(b.batch_id);
      if (status.status === "completed") {
        completed.set(b.batch_id, status);
        console.log(`[batch] ${b.batch_id} completed (${status.request_counts?.completed}/${status.request_counts?.total})`);
      } else if (["failed", "expired", "cancelled"].includes(status.status)) {
        console.error(`[batch] ${b.batch_id} terminal status=${status.status}`);
        console.error(JSON.stringify(status, null, 2));
        completed.set(b.batch_id, status);
      } else {
        console.log(
          `[batch] ${b.batch_id} status=${status.status} ` +
          `completed=${status.request_counts?.completed || 0}/${status.request_counts?.total || 0}`
        );
      }
    }
    if (completed.size < batches.length) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return completed;
}

async function applyResults(client, batches, completed, chunkFiles, outputPath) {
  // Map custom_id → chunks[] from the chunk files we wrote earlier
  const chunksMap = new Map();
  for (const file of chunkFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      chunksMap.set(rec.custom_id, rec.chunks);
    }
  }
  console.log(`[apply] indexed ${chunksMap.size} request_id → chunks mappings`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const out = fs.createWriteStream(outputPath);
  let counts = { EVIDENCE: 0, NOISE: 0, UNKNOWN: 0 };
  let totalProcessed = 0;

  for (const b of batches) {
    const status = completed.get(b.batch_id);
    if (!status || status.status !== "completed" || !status.output_file_id) {
      console.error(`[apply] batch ${b.batch_id} missing output_file_id, skipping`);
      continue;
    }
    console.log(`[apply] downloading output for ${b.batch_id}`);
    const outFile = await client.files.content(status.output_file_id);
    const text = await outFile.text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      const customId = rec.custom_id;
      const chunks = chunksMap.get(customId);
      if (!chunks) {
        console.error(`[apply] no chunks mapped for ${customId}`);
        continue;
      }
      const responseText = rec.response?.body?.choices?.[0]?.message?.content || "";
      const decisions = parseDecisions(responseText, chunks.length);
      for (let j = 0; j < chunks.length; j++) {
        const d = decisions[j];
        counts[d] = (counts[d] || 0) + 1;
        out.write(JSON.stringify({ ...chunks[j], __decision: d }) + "\n");
        totalProcessed++;
      }
    }
  }
  await new Promise((r) => out.end(r));
  console.log(
    `[apply] DONE total=${totalProcessed} evidence=${counts.EVIDENCE} ` +
    `noise=${counts.NOISE} unknown=${counts.UNKNOWN}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[batch-grader] starting", args);

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(args.state), { recursive: true });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let state = null;
  if (fs.existsSync(args.state)) {
    state = JSON.parse(fs.readFileSync(args.state, "utf8"));
    console.log(`[batch-grader] loaded existing state: ${state.batches?.length || 0} batches, ${state.totalChunks || 0} chunks`);
  }

  // Submit phase
  if (!state || (args.mode === "submit")) {
    console.log(`[batch-grader] building batch request files`);
    const built = await buildBatchFiles(args);
    console.log(`[batch-grader] built ${built.reqFiles.length} batch files, ${built.totalRequests} requests, ${built.totalChunks} chunks`);
    const batches = await submitBatches(client, built.reqFiles);
    state = {
      input: args.input,
      output: args.output,
      model: args.model,
      batchSize: args.batchSize,
      totalChunks: built.totalChunks,
      totalRequests: built.totalRequests,
      reqFiles: built.reqFiles,
      chunkFiles: built.chunkFiles,
      batches,
      submittedAt: new Date().toISOString(),
    };
    fs.writeFileSync(args.state, JSON.stringify(state, null, 2));
    console.log(`[batch-grader] state saved to ${args.state}`);
    if (args.mode === "submit") return;
  }

  // Poll phase
  let completed;
  if (args.mode === "all" || args.mode === "poll") {
    console.log(`[batch-grader] polling ${state.batches.length} batches`);
    completed = await pollBatches(client, state.batches);
    state.completed = [...completed.entries()].map(([id, s]) => ({ batch_id: id, status: s.status, output_file_id: s.output_file_id }));
    fs.writeFileSync(args.state, JSON.stringify(state, null, 2));
  }

  // Apply phase
  if (args.mode === "all" || args.mode === "apply") {
    if (!completed) {
      // Re-fetch from API using saved batch IDs
      completed = new Map();
      for (const b of state.batches) {
        const s = await client.batches.retrieve(b.batch_id);
        completed.set(b.batch_id, s);
      }
    }
    await applyResults(client, state.batches, completed, state.chunkFiles, args.output);
  }

  console.log("[batch-grader] done");
}

main().catch((err) => { console.error("[batch-grader] FAILED:", err); process.exit(1); });
