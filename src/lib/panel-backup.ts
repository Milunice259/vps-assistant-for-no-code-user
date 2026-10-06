import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

type Database = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

export function isValidBackupName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 160 &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.db$/.test(name) && !name.includes("..");
}

async function backupDirectory(database: Database) {
  // Ask the actual connection: relative Prisma URLs are schema-relative, not cwd-relative.
  const databases = await database.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const file = databases.find(item => item.name === "main")?.file;
  if (!file || !isAbsolute(file) || !lstatSync(file).isFile()) {
    throw new Error("Panel backup requires a regular SQLite database file.");
  }
  // Adjacent to the database, so /app/data's existing persistent mount includes backups.
  const directory = join(realpathSync(dirname(file)), "backups");
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) {
    throw new Error("Backup directory must not be a symlink.");
  }
  chmodSync(directory, 0o700);
  return directory;
}

function backupInfo(directory: string, name: string) {
  if (!isValidBackupName(name)) throw new Error("Invalid backup name.");
  const stat = lstatSync(join(directory, name));
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("Backup must be a regular, unlinked file.");
  return { name, size: stat.size, created: stat.birthtime.toISOString() };
}

export async function listPanelBackups(database: Database) {
  const directory = await backupDirectory(database);
  const files = [];
  for (const name of readdirSync(directory).filter(isValidBackupName)) {
    const stat = lstatSync(join(directory, name));
    if (stat.isFile() && stat.nlink === 1) files.push(backupInfo(directory, name));
  }
  return files.sort((a, b) => b.created.localeCompare(a.created));
}

export async function createPanelBackup(database: Database) {
  const directory = await backupDirectory(database);
  const staging = mkdtempSync(join(directory, ".snapshot-"));
  const snapshot = join(staging, "snapshot.db");
  const name = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.db`;
  const destination = join(directory, name);
  let published = false;
  try {
    // Native SQLite snapshot includes committed WAL writes, without copying a live file.
    await database.$executeRawUnsafe("VACUUM INTO ?", snapshot);
    chmodSync(snapshot, 0o600);
    const inspector = new PrismaClient({ datasourceUrl: `file:${snapshot}` });
    try {
      const rows = await inspector.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
        throw new Error("Snapshot integrity verification failed; no backup was saved.");
      }
    } finally { await inspector.$disconnect(); }
    // Exclusive publication: never overwrite an existing file/symlink, even on collision.
    linkSync(snapshot, destination);
    published = true;
    unlinkSync(snapshot);
    const result = { ...backupInfo(directory, name), scope: "panel-database" as const, integrity: "ok" as const };
    rmSync(staging, { recursive: true, force: true });
    return result;
  } catch (error) {
    // A reported failure must not leave a newly published recovery entry.
    if (published) unlinkSync(destination);
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function deletePanelBackup(database: Database, name: unknown) {
  if (!isValidBackupName(name)) throw new Error("Invalid backup name.");
  const directory = await backupDirectory(database);
  try { backupInfo(directory, name); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  // unlink does not follow the file if it is replaced with a symlink after lstat.
  unlinkSync(join(directory, name));
  return true;
}
