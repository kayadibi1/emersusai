#!/usr/bin/env bash
# Bundles the minimal files needed to run all data-pipeline scripts on Hetzner.
# Usage: bash scripts/deploy-embed-runner.sh [ssh-host]
#   Pass the host explicitly or set DEPLOY_HOST in the environment.
#
# Auto-copies keys from ~/app/.env on the server and rewrites SUPABASE_URL
# to http://localhost:8000 (Kong on the same box). No manual editing needed.

set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "Error: no SSH host. Pass it as the first argument or set DEPLOY_HOST." >&2
  exit 1
fi
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
ssh "$HOST" "rm -rf ~/embed-runner; mkdir -p ~/embed-runner"
scp -r "$BUNDLE_DIR"/* "$HOST:~/embed-runner/"

echo "Copying keys from ~/app/.env and setting SUPABASE_URL to localhost..."
ssh "$HOST" "cp ~/app/.env ~/embed-runner/.env.local && sed -i 's|SUPABASE_URL=.*|SUPABASE_URL=http://localhost:8000|' ~/embed-runner/.env.local"

echo "Installing dependencies on remote..."
ssh "$HOST" "cd ~/embed-runner && npm install --production"

echo ""
echo "Done! SSH in and run:"
echo "  ssh $HOST"
echo "  cd ~/embed-runner"
echo ""
echo "Examples:"
echo "  node scripts/embed-evidence.js --fetch-batch-size=200 --write-batch-size=50"
echo "  node scripts/fill-pmc-corpus.js --query=\"creatine AND resistance training\" --target=1000"
echo "  node scripts/test-retrieval.js"
