// scripts/hetzner-webhook.js — repo-tracked source for the
// `~/webhook.js` PM2 process on the Hetzner box. Receives GitHub
// push webhooks, debounces them, then runs the deploy.
//
// Why debounce: feature pushes often arrive in bursts (50+ commits in
// 30 min on busy days). Every push ran a fresh `pm2 restart emersus-api`
// which kills any in-flight SSE/recommendation streams. By waiting
// DEBOUNCE_MS for the burst to settle, we collapse N near-simultaneous
// commits into one deploy → one restart → one drain window.
//
// Install on Hetzner (one-time after editing this file in the repo):
//   scp scripts/hetzner-webhook.js hetzner:~/webhook.js
//   ssh hetzner 'pm2 restart webhook --update-env'

import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const SECRET = process.env.WEBHOOK_SECRET;
const PORT = 9000;
const DEBOUNCE_MS = 15_000;        // wait 15s after last push before deploying
const DEPLOY_TIMEOUT_MS = 240_000; // 4 min total cap on deploy command

if (!SECRET) {
  console.error("WEBHOOK_SECRET env var is required");
  process.exit(1);
}

function ts() { return new Date().toISOString(); }

// State for the debounce + serial-deploy lock.
let debounceTimer = null;
let deployInFlight = false;
let pendingDeploy = false;       // a push arrived while a deploy was running
let pendingCommits = [];         // SHAs we've coalesced into the next deploy

function runDeploy() {
  if (deployInFlight) {
    pendingDeploy = true;
    console.log(`[${ts()}] deploy already in flight; queued tail-deploy`);
    return;
  }
  deployInFlight = true;
  const coalesced = pendingCommits.length;
  pendingCommits = [];

  console.log(`[${ts()}] deploy starting (coalesced ${coalesced} commit(s))`);
  // npm run build is REQUIRED — Caddy serves dist/, skipping leaves
  // source changes invisible. pm2 restart with default kill_timeout=1600
  // truncates SSE streams; bump via:
  //   pm2 restart emersus-api --kill-timeout 30000 --update-env
  exec(
    // npm ci (not npm install): strict, never mutates package-lock.json.
    // Was npm install, which rewrote platform-specific optionalDeps markers
    // every deploy → next git pull aborted with "local changes would be
    // overwritten by merge". Lockfile stores all platform variants; npm ci
    // picks the right one without touching the file.
    "cd /home/emersus/app && git pull origin main && npm ci --no-audit --no-fund && npm run build && pm2 restart emersus-api --kill-timeout 30000 --update-env",
    { timeout: DEPLOY_TIMEOUT_MS },
    (err, stdout, stderr) => {
      if (err) {
        console.error(`[${ts()}] deploy failed: ${err.message}`);
      } else {
        console.log(`[${ts()}] deploy complete`);
      }
      // Print the tail of stdout/stderr so log readers see the build output.
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);

      deployInFlight = false;
      // If a push arrived during the deploy, fire one tail-deploy so the
      // freshly-pushed commits don't have to wait for the next push.
      if (pendingDeploy) {
        pendingDeploy = false;
        console.log(`[${ts()}] tail-deploy from queued push`);
        scheduleDeploy();
      }
    }
  );
}

function scheduleDeploy() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runDeploy();
  }, DEBOUNCE_MS);
}

http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/deploy") {
    res.writeHead(404);
    return res.end("Not found");
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const sig = req.headers["x-hub-signature-256"];
    if (!sig) {
      console.warn(`[${ts()}] 401 missing-sig from ${req.socket.remoteAddress}`);
      res.writeHead(401);
      return res.end("Missing signature");
    }
    const hmac = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    const expected = `sha256=${hmac}`;
    if (sig.length !== expected.length) {
      console.warn(`[${ts()}] 401 sig-length-mismatch from ${req.socket.remoteAddress}`);
      res.writeHead(401);
      return res.end("Invalid signature");
    }
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      console.warn(`[${ts()}] 401 sig-mismatch from ${req.socket.remoteAddress}`);
      res.writeHead(401);
      return res.end("Invalid signature");
    }

    let payload;
    try { payload = JSON.parse(body); }
    catch {
      console.warn(`[${ts()}] 400 invalid-json from ${req.socket.remoteAddress}`);
      res.writeHead(400);
      return res.end("Invalid JSON");
    }

    const ref = payload.ref || "";
    const event = req.headers["x-github-event"] || "unknown";
    const headSha = payload.head_commit?.id?.slice(0, 8) || "?";
    console.log(`[${ts()}] delivery event=${event} ref=${ref} head=${headSha}`);

    if (ref === "refs/heads/main") {
      pendingCommits.push(headSha);
      console.log(`[${ts()}] deploy queued (debouncing ${DEBOUNCE_MS / 1000}s; ${pendingCommits.length} commit(s) pending)`);
      scheduleDeploy();
    } else {
      console.log(`[${ts()}] ignoring ref=${ref}`);
    }

    res.writeHead(200);
    res.end("OK");
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[${ts()}] webhook listening on http://127.0.0.1:${PORT} (debounce=${DEBOUNCE_MS}ms)`);
});
