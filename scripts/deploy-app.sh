#!/usr/bin/env bash
# Deploy the app code to the Hetzner box and restart pm2.
# Usage:
#   bash scripts/deploy-app.sh
#   bash scripts/deploy-app.sh --branch main
#   bash scripts/deploy-app.sh --skip-push
#   bash scripts/deploy-app.sh --host emersus@46.225.58.187 --app-dir ~/app

set -euo pipefail

HOST="emersus@46.225.58.187"
APP_DIR="~/app"
REMOTE_NAME="origin"
BRANCH="main"
SKIP_PUSH=0
HEALTH_URL="https://emersus.ai/api/health"

usage() {
  cat <<'EOF'
Deploy the app to the Hetzner server.

Options:
  --branch <name>     Git branch to push/pull (default: main)
  --host <user@host>  SSH host (default: emersus@46.225.58.187)
  --app-dir <path>    Remote app directory (default: ~/app)
  --skip-push         Skip local git push and only deploy what's already remote
  --health-url <url>  Health endpoint to verify after restart
  --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="${2:?missing value for --branch}"
      shift 2
      ;;
    --host)
      HOST="${2:?missing value for --host}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:?missing value for --app-dir}"
      shift 2
      ;;
    --skip-push)
      SKIP_PUSH=1
      shift
      ;;
    --health-url)
      HEALTH_URL="${2:?missing value for --health-url}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STATUS_OUTPUT="$(git status --short)"

echo "Deploy target: $HOST:$APP_DIR"
echo "Deploy branch: $BRANCH"

if [[ -n "$STATUS_OUTPUT" ]]; then
  echo "Note: local working tree has uncommitted changes."
fi

if [[ "$SKIP_PUSH" -eq 0 ]]; then
  if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
    echo "Note: current branch is '$CURRENT_BRANCH' but deploy branch is '$BRANCH'."
  fi

  echo "Pushing $REMOTE_NAME/$BRANCH ..."
  git push "$REMOTE_NAME" "$BRANCH"
else
  echo "Skipping git push."
fi

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
cd $APP_DIR
git fetch $REMOTE_NAME
git checkout $BRANCH
git pull --ff-only $REMOTE_NAME $BRANCH
npm install
pm2 restart emersus-api --update-env
pm2 status
EOF
)

echo "Deploying on server ..."
ssh "$HOST" "$REMOTE_CMD"

echo "Checking health endpoint ..."
curl --fail --silent --show-error "$HEALTH_URL"
echo
echo "Deploy complete."
