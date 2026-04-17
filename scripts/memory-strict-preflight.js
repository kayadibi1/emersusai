#!/usr/bin/env node
// scripts/memory-strict-preflight.js
//
// Spec §5.4 + memory `feedback_openai_strict_mode`. Unit tests do NOT catch
// OpenAI strict-mode schema violations — only the validator does at request
// time. This script makes real Responses API calls with memory tools +
// response_format schemas, using edge-case inputs, and exits 0 on all pass
// / 1 on any fail.
//
// Run locally before flipping MEMORY_* env vars on prod. Requires
// OPENAI_API_KEY and optionally OPENAI_EMERSUS_MODEL in env.

import { REMEMBER_FACT, RECALL_MEMORY } from '../api/emersus/pipeline/tools.js';
import {
  MEMORY_GATE_SCHEMA,
  MEMORY_FACTS_SCHEMA,
} from '../api/emersus/pipeline/extract-memory-schemas.js';

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL   = process.env.OPENAI_EMERSUS_MODEL || 'gpt-4.1-mini';
const LOG_FULL_BODY = process.env.DEBUG === '1';

if (!API_KEY) {
  console.error('OPENAI_API_KEY required');
  process.exit(1);
}

async function probeTools(name, userMessage) {
  process.stdout.write(`[probe:tools] ${name.padEnd(24)}… `);
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
        tools: [REMEMBER_FACT, RECALL_MEMORY],
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
  console.log(LOG_FULL_BODY ? `PASS\n  body: ${bodyText.slice(0, 300)}…` : `PASS (HTTP ${res.status})`);
  return true;
}

async function probeSchema(name, schema, userMessage) {
  process.stdout.write(`[probe:schema] ${name.padEnd(23)}… `);
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
        text: {
          format: {
            type: 'json_schema',
            name: schema.name,
            strict: !!schema.strict,
            schema: schema.schema,
          },
        },
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
  console.log(LOG_FULL_BODY ? `PASS\n  body: ${bodyText.slice(0, 300)}…` : `PASS (HTTP ${res.status})`);
  return true;
}

const toolProbes = [
  ['minimal',            'Remember that my left knee is the bad one.'],
  ['custom_category',    'Remember that I prefer evening sessions because I work in restaurants.'],
  ['note_populated',     'Remember that I take creatine 5g daily; started last month.'],
  ['no_save_intent',     "What's a good protein target for a 75 kg lifter?"],
  ['recall_pr_history',  'What was my deadlift PR from March?'],
  ['recall_shoulder',    'Remember what I told you about my shoulder?'],
];

const schemaProbes = [
  ['gate_relevant_false', MEMORY_GATE_SCHEMA,  'Decide whether this turn is memory-worthy: "What is the capital of France?"'],
  ['gate_relevant_true',  MEMORY_GATE_SCHEMA,  'Decide whether this turn is memory-worthy: "I tore my ACL yesterday."'],
  ['facts_injury',        MEMORY_FACTS_SCHEMA, 'User turn: "I tore my ACL yesterday." Extract any durable personal facts.'],
  ['facts_multi',         MEMORY_FACTS_SCHEMA, 'User turn: "I tore my ACL last month and I really hate burpees." Extract durable personal facts.'],
];

let allPass = true;
for (const [name, msg] of toolProbes) {
  const ok = await probeTools(name, msg);
  if (!ok) allPass = false;
}
for (const [name, schema, msg] of schemaProbes) {
  const ok = await probeSchema(name, schema, msg);
  if (!ok) allPass = false;
}

console.log(allPass
  ? '\nAll probes passed.'
  : '\nOne or more probes FAILED — do NOT flip MEMORY_* flags to true.');
process.exit(allPass ? 0 : 1);
