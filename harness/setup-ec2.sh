#!/usr/bin/env bash
# One-time setup on EC2 for the monthly benchmark. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
echo "== dependency check =="
command -v node >/dev/null || { echo "❌ node missing"; exit 1; }
command -v iverilog >/dev/null || { echo "❌ iverilog missing — run: sudo apt-get update && sudo apt-get install -y iverilog"; exit 1; }
command -v vvp >/dev/null || { echo "❌ vvp missing (comes with iverilog)"; exit 1; }
echo "✅ node $(node -v), iverilog present"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Created harness/.env — set HARNESS_ADMIN_TOKEN (same value as the backend's) then re-run this script."
  exit 0
fi
if ! grep -qE '^HARNESS_ADMIN_TOKEN=.+' .env; then
  echo "❌ Set HARNESS_ADMIN_TOKEN in harness/.env (same as backend) first."; exit 1
fi

PLUTO_DIR="${PLUTO_REPO:-/home/ubuntu/pluto}"
if [ ! -d "$PLUTO_DIR/.git" ]; then
  echo "== cloning Pluto -> $PLUTO_DIR =="
  git clone --depth 1 https://github.com/scale-lab/Pluto.git "$PLUTO_DIR"
fi

HDIR="$(pwd)"
LINE="0 4 1 * * $HDIR/run-monthly.sh >> $HDIR/run.log 2>&1"   # 04:00 on the 1st
( crontab -l 2>/dev/null | grep -v 'run-monthly.sh' ; echo "$LINE" ) | crontab -
echo "== installed monthly cron =="
crontab -l | grep run-monthly.sh
echo "✅ Setup complete. Test a run now with:  ./run-monthly.sh"
