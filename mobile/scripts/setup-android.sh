#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
if [ ! -d android ]; then npx cap add android; fi
npx cap sync android
node scripts/android-system-bars.cjs
echo "Android preparado. Abre con: npm run open:android"
