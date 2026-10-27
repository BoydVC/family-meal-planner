#!/usr/bin/env bash
# Capture the loopback planner. Requires the Node server (npm start).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4309}"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
mkdir -p screenshots
if ! ss -ltn | grep -q "127.0.0.1:$PORT "; then
  STORE_PATH="$(mktemp)" QUIET=1 nohup npm start > "/tmp/family-meal-planner-$PORT.log" 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
    sleep 0.2
  done
fi
curl -sf -X POST "http://127.0.0.1:$PORT/api/week/slot" \
  -H 'Content-Type: application/json' \
  -d '{"day":"Mon","slot":"leftover"}' >/dev/null
curl -sf -X POST "http://127.0.0.1:$PORT/api/week/slot" \
  -H 'Content-Type: application/json' \
  -d '{"day":"Fri","slot":"leftover"}' >/dev/null
shot() {
  local url="$1" out="$2" size="$3"
  shift 3 || true
  local prof
  prof="$(mktemp -d /tmp/fmpshot.XXXX)"
  timeout 20 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --run-all-compositor-stages-before-draw --virtual-time-budget=8000 \
    --window-size="$size" --user-data-dir="$prof" --screenshot="$out" "$@" "$url" >/dev/null 2>&1
  rm -rf "$prof"
  echo "  $out ($(wc -c < "$out") bytes)"
}
U="http://127.0.0.1:$PORT"
shot "$U/#week" screenshots/00-desktop-week.png 1440,1000
shot "$U/#grocery" screenshots/01-grocery.png 1440,1100
shot "$U/#fridge" screenshots/02-fridge.png 1440,1100
shot "$U/#notes" screenshots/03-notes.png 1440,1100
shot "$U/#about" screenshots/04-about.png 1440,1100
shot "$U/#week" screenshots/05-phone.png 390,844 --user-agent="Mozilla/5.0 (iPhone)"
echo "screenshots done"
