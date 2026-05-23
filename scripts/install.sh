#!/usr/bin/env bash
# Install all prerequisites for running tplink-router-info:
#   - node deps (yarn or npm)
#   - Playwright Chromium browser

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> installing node deps"
if command -v yarn >/dev/null 2>&1; then
  yarn install
else
  npm install
fi

echo "==> installing Playwright Chromium"
npx --no-install playwright install chromium

echo
echo "install complete. run with: node scrape.js  (or: yarn start)"
