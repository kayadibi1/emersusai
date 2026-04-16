#!/usr/bin/env node
// scripts/memory-strict-preflight.js
//
// Spec §5.4 + memory `feedback_openai_strict_mode`. Unit tests do NOT catch
// OpenAI strict-mode schema violations — only the validator does at request
// time. This script makes real Responses API calls with REMEMBER_FACT in
// `tools`, using edge-case inputs, and exits 0 on all pass / 1 on any fail.
//
// Run locally before flipping MEMORY_REMEMBER_FACT_ENABLED=true in prod.
// Requires OPENAI_API_KEY and optionally OPENAI_EMERSUS_MODEL in env.

import { REMEMBER_FACT } from '../api/emersus/pipeline/tools.js';

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL   = process.env.OPENAI_EMERSUS_MODEL || 'gpt-4.1-mini';
const LOG_FULL_BODY = process.env.DEBUG === '1';

if (!API_KEY) {
  console.error('OPENAI_API_KEY required');
  process.exit(1);
}

async function probe(name, userMessage) {
  process.stdout.write(`[probe] ${name.padEnd(20)}… `);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{ role: 'user', content: userMessage }],
        tools: [REMEMBER_FACT],
        store: false,
      }),
    });
  } catch (err) {
    console.log(`FAIL (network): ${err.message}`);
    return false;
  }

  const bodyText = await res.text();
  if (!res.ok) {
    console.log(`FAIL (HTTP ${res.status})`);
    console.log(`  ${bodyText.slice(0, 500)}`);
    return false;
  }
  if (LOG_FULL_BODY) {
    console.log('PASS');
    console.log(`  body: ${bodyText.slice(0, 300)}…`);
  } else {
    console.log(`PASS (HTTP ${res.status})`);
  }
  return true;
}

const probes = [
  ['minimal',          'Remember that my left knee is the bad one.'],
  ['custom_category',  'Remember that I prefer evening sessions because I work in restaurants.'],
  ['note_populated',   'Remember that I take creatine 5g daily; started last month.'],
  ['no_save_intent',   "What's a good protein target for a 75 kg lifter?"],
];

let allPass = true;
for (const [name, msg] of probes) {
  const ok = await probe(name, msg);
  if (!ok) allPass = false;
}

console.log(allPass ? '\nAll probes passed.' : '\nOne or more probes FAILED — do NOT flip MEMORY_REMEMBER_FACT_ENABLED=true.');
process.exit(allPass ? 0 : 1);
