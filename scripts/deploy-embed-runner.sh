#!/usr/bin/env bash
# Bundles the minimal files needed to run all data-pipeline scripts on Hetzner.
# Usage: bash scripts/deploy-embed-runner.sh <ssh-host>
#   e.g. bash scripts/deploy-embed-runner.sh root@your-hetzner-ip
#
# Included scripts:
#   scripts/embed-evidence.js    — generate & write embeddings
#   scripts/import-pubmed.js     — import PubMed JSON/JSONL into Supabase
#   scripts/fill-pmc-corpus.js   — search PubMed, fetch PMC full text, import + embed
#   scripts/fill-pmc-topics.js   — run fill-pmc-corpus for a list of topics
#   scripts/fetch-pmc-fulltext.js — backfill PMC full text for existing articles
#   scripts/test-retrieval.js    — test vector similarity search
#
# After deploy, SSH in and:
#   cd ~/embed-runner
#   nano .env.local              # paste your real keys
#   node scripts/embed-evidence.js --fetch-batch-size=200 --write-batch-size=50

set -euo pipefail

HOST="${1:?Usage: deploy-embed-runner.sh <ssh-host>}"
BUNDLE_DIR="$(mktemp -d)"
trap 'rm -rf "$BUNDLE_DIR"' EXIT

echo "Bundling files..."

cat > "$BUNDLE_DIR/package.json" <<'PKGJSON'
{
  "name": "embed-runner",
  "private": true,
  "type": "module",
  "dependencies": {
    "@supabase/supabase-js": "^2.101.1",
    "openai": "^6.33.0"
  }
}
PKGJSON

cat > "$BUNDLE_DIR/.env.local" <<'ENVEOF'
# Supabase PostgREST running on the same Hetzner box
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=<PASTE_YOUR_SERVICE_ROLE_KEY>
OPENAI_API_KEY=<PASTE_YOUR_OPENAI_KEY>
ENVEOF

mkdir -p "$BUNDLE_DIR/api/lib" "$BUNDLE_DIR/api/emersus" "$BUNDLE_DIR/scripts"

# api layer (shared clients + retrieval helpers)
cp api/lib/clients.js              "$BUNDLE_DIR/api/lib/clients.js"
cp api/emersus/embeddings.js       "$BUNDLE_DIR/api/emersus/embeddings.js"
cp api/emersus/retrieveDatabaseEvidence.js "$BUNDLE_DIR/api/emersus/retrieveDatabaseEvidence.js"

# all data-pipeline scripts
cp scripts/embed-evidence.js       "$BUNDLE_DIR/scripts/embed-evidence.js"
cp scripts/import-pubmed.js        "$BUNDLE_DIR/scripts/import-pubmed.js"
cp scripts/fill-pmc-corpus.js      "$BUNDLE_DIR/scripts/fill-pmc-corpus.js"
cp scripts/fill-pmc-topics.js      "$BUNDLE_DIR/scripts/fill-pmc-topics.js"
cp scripts/fetch-pmc-fulltext.js   "$BUNDLE_DIR/scripts/fetch-pmc-fulltext.js"
cp scripts/test-retrieval.js       "$BUNDLE_DIR/scripts/test-retrieval.js"

echo "Uploading to $HOST:~/embed-runner ..."
ssh "$HOST" "rm -rf ~/embed-runner"
scp -r "$BUNDLE_DIR" "$HOST:~/embed-runner"

echo "Installing dependencies on remote..."
ssh "$HOST" "cd ~/embed-runner && npm install --production"

echo ""
echo "Done! SSH in and run:"
echo "  ssh $HOST"
echo "  cd ~/embed-runner"
echo "  nano .env.local   # paste your real keys"
echo ""
echo "Examples:"
echo "  node scripts/embed-evidence.js --fetch-batch-size=200 --write-batch-size=50"
echo "  node scripts/fill-pmc-corpus.js --query=\"creatine AND resistance training\" --target=1000"
echo "  node scripts/test-retrieval.js"
