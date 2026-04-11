// jobs/validate-queries.js
// Ports scripts/validate-pubmed-queries.js into a handler.
//
// Key change from original: reads topics from research_topics WHERE status='active'
// instead of parsing TOPIC_QUERIES from fill-pmc-topics.js.
//
// Classifies each topic's query via PubMed eutils esearch:
//   count >= passMin (default 100)  → PASS
//   count >= warnMin (default 10)   → WARN
//   count < warnMin                 → FAIL
//
// Uses curl transport (same as original) to respect PubMed's rate limit.
// REQUEST_SPACING_MS = 350ms (~3 RPS, under PubMed unauthenticated limit).
//
// Payload: { topicKeys?, passMin?, warnMin? }
// Returns: { pass, warn, fail, error, results }

import { spawn } from "node:child_process";

const DEFAULT_PASS_MIN = 100;
const DEFAULT_WARN_MIN = 10;
const REQUEST_SPACING_MS = 350;
const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function curlGet(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25", "-A", "emersus-validator/1.0", url];
    const child = spawn("curl", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}

async function esearchCount(query) {
  const url = `${ESEARCH_URL}?db=pubmed&retmax=0&term=${encodeURIComponent(query)}`;
  const xml = await curlGet(url);
  const match = xml.match(/<Count>(\d+)<\/Count>/);
  if (!match) throw new Error(`no <Count> in response: ${xml.slice(0, 200)}`);
  return Number(match[1]);
}

export async function validateQueriesHandler(ctx, deps) {
  const {
    topicKeys,
    passMin = DEFAULT_PASS_MIN,
    warnMin = DEFAULT_WARN_MIN,
  } = ctx.data;
  const { sql } = deps;

  // Load active topics from DB (instead of parsing the JS file)
  const topicsResult = await sql`
    SELECT topic_key, query FROM research_topics
    WHERE status = 'active'
    ORDER BY topic_key
  `;
  let topics = topicsResult.rows;

  // Filter to requested topicKeys if provided
  if (topicKeys && topicKeys.length > 0) {
    const keySet = new Set(topicKeys);
    topics = topics.filter(t => keySet.has(t.topic_key));
  }

  await ctx.progress(`validating ${topics.length} queries (passMin=${passMin} warnMin=${warnMin})`);

  const counts = { pass: 0, warn: 0, fail: 0, error: 0 };
  const results = [];

  for (const topic of topics) {
    if (ctx.signal.aborted) {
      await ctx.progress("aborted");
      break;
    }

    try {
      const count = await esearchCount(topic.query);
      let tag;
      if (count >= passMin) {
        tag = "PASS";
        counts.pass++;
      } else if (count >= warnMin) {
        tag = "WARN";
        counts.warn++;
      } else {
        tag = "FAIL";
        counts.fail++;
      }
      results.push({ topicKey: topic.topic_key, count, tag });
      await ctx.progress(`[${tag}] ${count} — ${topic.topic_key}`);
    } catch (e) {
      counts.error++;
      results.push({ topicKey: topic.topic_key, count: null, tag: "ERROR", error: e.message });
      await ctx.progress(`[ERROR] ${topic.topic_key}: ${e.message.slice(0, 120)}`, "warn");
    }

    await sleep(REQUEST_SPACING_MS);
  }

  await ctx.progress(`summary: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.error} error`);
  return { ...counts, results };
}
