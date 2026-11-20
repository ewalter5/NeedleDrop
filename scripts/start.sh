#!/bin/sh
set -eu
# Render supplies the final HTTPS address, including any generated name suffix.
if [ -z "${APP_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export APP_URL="$RENDER_EXTERNAL_URL"
fi
# Free web services don't support pre-deploy commands. Migrations are idempotent
# and protected by the same database lock when multiple instances start.
node node_modules/tsx/dist/cli.mjs scripts/migrate.ts
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0
