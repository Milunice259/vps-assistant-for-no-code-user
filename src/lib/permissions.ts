export type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

const rank: Record<Role, number> = { VIEWER: 0, MANAGER: 1, OPERATOR: 1, ADMIN: 2, OWNER: 3 };

export function can(role: string | undefined, minimum: Role): boolean {
  return rank[(role as Role) || "VIEWER"] >= rank[minimum];
}

export function roleLabel(role: string | undefined): string {
  if (role === "OWNER") return "Owner";
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER" || role === "OPERATOR") return "Manager";
  return "Viewer";
}
