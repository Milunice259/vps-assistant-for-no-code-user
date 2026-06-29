import { prisma } from "@/lib/db";

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
export type ServerAccessMode = "ALL" | "SELECTED";

export const roleRank: Record<Role, number> = { VIEWER: 0, MANAGER: 1, OPERATOR: 1, ADMIN: 2, OWNER: 3 };
export const adminRoles = new Set<Role>(["OWNER", "ADMIN"]);

export function normalizeRole(role: string | undefined): Role {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER" || role === "OPERATOR" || role === "VIEWER" ? role : "VIEWER";
}

export function canManageRole(actor: string, target: string): boolean {
  const a = normalizeRole(actor);
  const t = normalizeRole(target);
  if (a === "OWNER") return t !== "OWNER" || actor === target;
  if (a === "ADMIN") return t !== "OWNER" && t !== "ADMIN";
  return false;
}

export async function hasActiveOwner(exceptId?: string): Promise<boolean> {
  return (await prisma.user.count({ where: { role: "OWNER", isActive: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })) > 0;
}

export async function canAccessServer(userId: string, role: string, serverId: string): Promise<boolean> {
  const r = normalizeRole(role);
  if (r === "OWNER" || r === "ADMIN") return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { serverAccessMode: true } });
  if (user?.serverAccessMode === "ALL") return true;
  if (serverId === "local") return false;
  return !!(await prisma.userServerAccess.findUnique({ where: { userId_serverId: { userId, serverId } } }));
}

export async function scopedServerWhere(userId: string, role: string) {
  const r = normalizeRole(role);
  if (r === "OWNER" || r === "ADMIN") return {};
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { serverAccessMode: true } });
  if (user?.serverAccessMode === "ALL") return {};
  const rows = await prisma.userServerAccess.findMany({ where: { userId }, select: { serverId: true } });
  return { id: { in: rows.map((r) => r.serverId) } };
}
