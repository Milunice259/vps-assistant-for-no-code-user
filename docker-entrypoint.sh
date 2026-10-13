#!/bin/sh
set -e

# ═══════════════════════════════════════════════════
#  VPS Control App - Docker Entrypoint
#  1. Ensure SQLite database exists (prisma db push)
#  2. Seed admin user if needed
#  3. Start the Next.js server
# ═══════════════════════════════════════════════════

echo "[entrypoint] Initializing database..."
# Run Prisma CLI via node (avoids relying on npx/.bin in minimal standalone image)
if [ -f "./node_modules/prisma/build/index.js" ]; then
  node ./node_modules/prisma/build/index.js db push 2>&1 || {
    echo "[entrypoint] ERROR: Failed to initialize database."
    exit 1
  }
else
  npx prisma db push 2>&1 || {
    echo "[entrypoint] ERROR: Failed to initialize database."
    exit 1
  }
fi
echo "[entrypoint] Database ready."

# Seed admin user if ADMIN_PASSWORD is set and user doesn't exist yet
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Checking admin user..."
  node -e "
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();

    async function seed() {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        console.log('[entrypoint] Admin user exists. Skipping.');
        return;
      }
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await prisma.user.create({ data: { username, passwordHash: hash } });
      console.log('[entrypoint] Admin user created.');
    }

    seed()
      .catch(e => console.error('[entrypoint] Seed error:', e.message))
      .finally(() => prisma.\$disconnect());
  "
fi

# The browser/Next process must not run the legacy interval as well.
export DISABLE_NOTIFICATION_SCHEDULER=true
# Fail closed if either child exits; the container restart policy restarts both.
# A worker killed mid-cycle leaves its lease until expiry, preventing immediate overlap.
node scripts/monitoring-worker.cjs &
monitor_pid=$!
node server.js &
server_pid=$!
stop_children() {
  kill -TERM "$monitor_pid" "$server_pid" 2>/dev/null || true
  wait "$monitor_pid" "$server_pid" 2>/dev/null || true
}
trap 'stop_children; exit 0' TERM INT
while kill -0 "$monitor_pid" 2>/dev/null && kill -0 "$server_pid" 2>/dev/null; do
  sleep 2
done
stop_children
exit 1
