#!/usr/bin/env bash
# Monthly benchmark run (cron target). Pulls the model selection + run size from
# the backend /admin store, runs the agentic pipeline, posts to /leaderboard.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a   # HARNESS_ADMIN_TOKEN, PLUTO_REPO, ...

PLUTO_DIR="${PLUTO_REPO:-$(node -e 'process.stdout.write(require("./config.json").plutoRepo)')}"
if [ ! -d "$PLUTO_DIR/.git" ]; then
  echo "[$(date -u +%FT%TZ)] cloning Pluto -> $PLUTO_DIR"
  git clone --depth 1 https://github.com/scale-lab/Pluto.git "$PLUTO_DIR"
else
  echo "[$(date -u +%FT%TZ)] git pull $PLUTO_DIR"
  git -C "$PLUTO_DIR" pull --ff-only || echo "  (pull skipped — using existing clone)"
fi

echo "[$(date -u +%FT%TZ)] running benchmark"
node src/index.js
echo "[$(date -u +%FT%TZ)] done"
