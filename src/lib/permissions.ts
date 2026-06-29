export type Role = "ADMIN" | "OPERATOR" | "VIEWER";

const rank: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function can(role: string | undefined, minimum: Role): boolean {
  return rank[(role as Role) || "VIEWER"] >= rank[minimum];
}

export function roleLabel(role: string | undefined): string {
  return role === "ADMIN" ? "Admin" : role === "OPERATOR" ? "Operator" : "Viewer";
}
