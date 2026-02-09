/**
 * seed.ts - Creates the default admin user on first run.
 * Uses ADMIN_USERNAME and ADMIN_PASSWORD from environment.
 *
 * Run: npx tsx scripts/seed.ts
 * Or:  npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error("ERROR: ADMIN_PASSWORD environment variable is required.");
    process.exit(1);
  }

  // Check if admin already exists
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    console.log(`Admin user "${username}" already exists. Skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      username,
      passwordHash,
    },
  });

  console.log(`Admin user "${username}" created successfully.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
