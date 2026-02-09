#!/bin/sh
set -e

# ═══════════════════════════════════════════════════
#  VPS Control App - Docker Entrypoint
#  1. Ensure SQLite database exists (prisma db push)
#  2. Seed admin user if needed
#  3. Start the Next.js server
# ═══════════════════════════════════════════════════

echo "[entrypoint] Initializing database..."
npx prisma db push --skip-generate 2>&1 || {
  echo "[entrypoint] ERROR: Failed to initialize database."
  exit 1
}
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

echo "[entrypoint] Starting application..."
exec node server.js
