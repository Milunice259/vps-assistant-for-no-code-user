import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessServer } from "@/lib/server-access";

const operators = new Set(["OWNER", "ADMIN", "MANAGER", "OPERATOR"]);

export async function authorizeServer(serverId: string, operator = false) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (operator && !operators.has(session.role)) {
    return NextResponse.json({ success: false, error: "Operator access required" }, { status: 403 });
  }
  if (typeof serverId !== "string" || !serverId) {
    return NextResponse.json({ success: false, error: "Invalid server ID" }, { status: 400 });
  }
  return await canAccessServer(session.sub, session.role, serverId)
    ? null
    : NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
}

/** Resolve only ownership metadata; never load server credentials before authorization. */
export async function authorizeApp(id: string, operator = false) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (operator && !operators.has(session.role)) {
    return NextResponse.json({ success: false, error: "Operator access required" }, { status: 403 });
  }

  let serverId: string;
  if (/^(local|local-service|discovered|service)::/.test(id)) {
    // Preserve discovery IDs exactly: reject malformed tokens rather than sanitizing them.
    const parts = id.split("::");
    const local = parts[0] === "local" || parts[0] === "local-service";
    const target = parts[local ? 1 : 2];
    const targetPattern = parts[0] === "service" || parts[0] === "local-service"
      ? /^[a-zA-Z0-9_.@-]+$/ : /^[a-zA-Z0-9_.-]+$/;
    if (parts.length !== (local ? 2 : 3) || !targetPattern.test(target || "") ||
        (!local && !/^[a-zA-Z0-9_-]+$/.test(parts[1] || ""))) {
      return NextResponse.json({ success: false, error: "Invalid application ID" }, { status: 400 });
    }
    serverId = local ? "local" : parts[1];
  } else {
    const app = await prisma.app.findUnique({ where: { id }, select: { serverId: true } });
    if (!app) return NextResponse.json({ success: false, error: "Application not found" }, { status: 404 });
    serverId = app.serverId;
  }
  return await canAccessServer(session.sub, session.role, serverId)
    ? null
    : NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
}
