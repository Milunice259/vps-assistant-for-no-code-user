import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createSSHConnection, closeSSH, executeCommand } from "@/lib/ssh";
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
    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");

    if (!domain) {
      return NextResponse.json(
        { success: false, error: "domain query parameter is required" },
        { status: 400 }
      );
    }

    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    const password = server.encryptedPass ? decrypt(server.encryptedPass) : undefined;
    const privateKey = server.encryptedKey ? decrypt(server.encryptedKey) : undefined;

    const ssh = await createSSHConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      password,
      privateKey,
    });

    try {
      const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, "");

      // Use openssl to check the certificate
      const certOutput = await executeCommand(
        ssh,
        `echo | openssl s_client -servername ${safeDomain} -connect ${safeDomain}:443 2>/dev/null | openssl x509 -noout -dates -issuer -subject 2>&1`,
        15_000
      );

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
