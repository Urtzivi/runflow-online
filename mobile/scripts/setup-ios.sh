#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
if [ ! -d ios ]; then npx cap add ios; fi
npx cap sync ios
echo "iOS preparado. Abre con: npm run open:ios"
