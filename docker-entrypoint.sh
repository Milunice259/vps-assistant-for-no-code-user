#!/bin/sh
set -e

# ═══════════════════════════════════════════════════
#  VPS Control App - Docker Entrypoint
#  1. Wait for PostgreSQL to be reachable
#  2. Run Prisma migrations
#  3. Start the Next.js server
# ═══════════════════════════════════════════════════

MAX_RETRIES=30
RETRY=0

echo "[entrypoint] Waiting for database to be ready..."

while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
  if node scripts/wait-for-db.js 2>/dev/null; then
    echo "[entrypoint] Database is ready!"
    break
  fi
  RETRY=$((RETRY + 1))
  echo "[entrypoint] Database not ready, retrying... ($RETRY/$MAX_RETRIES)"
  sleep 2
done

if [ "$RETRY" -eq "$MAX_RETRIES" ]; then
  echo "[entrypoint] ERROR: Database not available after $MAX_RETRIES attempts."
  exit 1
fi

echo "[entrypoint] Running database migrations..."
npx prisma migrate deploy

echo "[entrypoint] Starting application..."
exec node server.js
