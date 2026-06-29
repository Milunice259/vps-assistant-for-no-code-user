import { getSession } from "@/lib/auth";
import { canAccessServer } from "@/lib/server-access";
import { NextRequest, NextResponse } from "next/server";
import { closeSSH, executeCommand } from "@/lib/ssh";
import { connectToServer } from "@/lib/server-ssh";
import { execLocal, isLocalServer } from "@/lib/local-server";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface SSLInfo {
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isValid: boolean;
  subject: string;
}

/**
 * GET /api/servers/[id]/ssl - Check SSL certificate status for server domains.
 * Query: ?domain=example.com (required)
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApiResponse<SSLInfo>>> {
  try {
    const { id } = await context.params;

    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessServer(session.sub as string, session.role as string, id))) {
      return NextResponse.json({ success: false, error: "Server access denied" }, { status: 403 });
    }
    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");

    if (!domain) {
      return NextResponse.json(
        { success: false, error: "domain query parameter is required" },
        { status: 400 }
      );
    }

    const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, "");
    const command = `echo | openssl s_client -servername ${safeDomain} -connect ${safeDomain}:443 2>/dev/null | openssl x509 -noout -dates -issuer -subject 2>&1`;
    let ssh: Awaited<ReturnType<typeof import("@/lib/ssh").createSSHConnection>> | null = null;

    try {
      const certOutput = isLocalServer(id)
        ? execLocal(command, 15_000)
        : await (async () => {
            const result = await connectToServer(id);
            ssh = result.ssh;
            return executeCommand(ssh, command, 15_000);
          })();

      // Parse output
      const lines = certOutput.split("\n");
      let issuer = "";
      let subject = "";
      let validFrom = "";
      let validTo = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("notBefore=")) validFrom = trimmed.replace("notBefore=", "");
        if (trimmed.startsWith("notAfter=")) validTo = trimmed.replace("notAfter=", "");
        if (trimmed.startsWith("issuer=")) issuer = trimmed.replace("issuer=", "").trim();
        if (trimmed.startsWith("subject=")) subject = trimmed.replace("subject=", "").trim();
      }

      // Calculate days remaining
      let daysRemaining = -1;
      let isValid = false;
      if (validTo) {
        const expiryDate = new Date(validTo);
        const now = new Date();
        daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        isValid = daysRemaining > 0;
      }

      return NextResponse.json({
        success: true,
        data: {
          domain: safeDomain,
          issuer,
          validFrom,
          validTo,
          daysRemaining,
          isValid,
          subject,
        },
      });
    } finally {
      await closeSSH(ssh);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSL check failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
