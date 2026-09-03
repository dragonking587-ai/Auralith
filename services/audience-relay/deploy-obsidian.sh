#!/usr/bin/env bash
# Deploy Auralith audience-relay to the existing Railway project named Obsidian.
# Run this on your PC after: railway login
set -euo pipefail
cd "$(dirname "$0")"
npm install
npm run build
if ! command -v railway >/dev/null 2>&1; then
  echo "Install CLI: npm install -g @railway/cli"
  exit 1
fi
railway whoami
railway link --project Obsidian
railway up
echo
echo "Next: railway domain"
echo "Paste the https://*.up.railway.app origin into Auralith Public Relay URL."
