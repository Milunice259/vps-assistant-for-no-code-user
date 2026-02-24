import { PrismaClient } from "@prisma/client";

// Prevent multiple PrismaClient instances in development (hot-reload)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ── Enable WAL mode for better concurrent read/write ──
// WAL allows readers and writer to coexist without SQLITE_BUSY
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {
  // Silently ignore — WAL may already be enabled or env doesn't support it
});

// ── Graceful shutdown — close DB connection on process exit ──
async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
