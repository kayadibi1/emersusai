// scripts/fulltext-enrichment/lib/fetch-springer-oa.js
//
// Springer Nature Open Access API — returns JATS XML full text directly.
// Free plan: 100 req/min, 500 req/day hard cap.
// Register at dev.springernature.com. Set SPRINGER_API_KEY in env.
import { RateLimiter } from './rate-limiter.js';
import { parseJatsFullText } from './jats-parser.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SN_BASE = 'https://api.springernature.com/openaccess/jats';
const limiter = new RateLimiter({ rps: 1.5 }); // 100/min = 1.67 rps

const DAILY_CAP = 490; // leave 10 in reserve
const __dirname = dirname(fileURLToPath(import.meta.url));
const QUOTA_FILE = join(__dirname, '..', 'data', 'springer-quota.json');

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function readQuota() {
  try {
    const q = JSON.parse(readFileSync(QUOTA_FILE, 'utf8'));
    if (q.date === todayUTC()) return q.used;
  } catch {}
  return 0;
}

function writeQuota(used) {
  try {
    mkdirSync(join(__dirname, '..', 'data'), { recursive: true });
    writeFileSync(QUOTA_FILE, JSON.stringify({ date: todayUTC(), used }), 'utf8');
  } catch {}
}

export async function fetchForDoi(doi) {
  if (!process.env.SPRINGER_API_KEY) return null;

  const used = readQuota();
  if (used >= DAILY_CAP) return null; // quota exhausted for today — skip silently

  await limiter.take();

  let resp;
  let xml;
  try {
    resp = await fetch(
      `${SN_BASE}?api_key=${encodeURIComponent(process.env.SPRINGER_API_KEY)}&q=doi:${encodeURIComponent(doi)}`,
      {
        headers: { Accept: 'application/jats+xml, application/xml, */*' },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (resp.status === 404 || resp.status === 400) return null;
    if (resp.status === 429) { writeQuota(DAILY_CAP); return null; } // API says quota hit
    if (!resp.ok) return null;
    xml = await resp.text();
    writeQuota(used + 1);
  } catch { return null; }

  if (!xml || xml.length < 200) return null;

  const parsed = parseJatsFullText(xml);
  if (!parsed || parsed.text.length < 500) return null;

  return { text: parsed.text, sections: parsed.sections, pdfUrl: null, source: 'phase2f_springer' };
}
