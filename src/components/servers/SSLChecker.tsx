"use client";

import { useState, useCallback } from "react";
import { Shield, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";
import type { ApiResponse } from "@/types";

interface SSLCheckerProps {
  serverId: string;
  defaultDomain?: string;
}

interface SSLInfo {
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isValid: boolean;
  subject: string;
}

export function SSLChecker({ serverId, defaultDomain }: SSLCheckerProps) {
  const { safeMode } = useSafeMode();
  const [domain, setDomain] = useState(defaultDomain || "");
  const [result, setResult] = useState<SSLInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSSL = useCallback(async () => {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/ssl?domain=${encodeURIComponent(domain.trim())}`);
      const json: ApiResponse<SSLInfo> = await res.json();
      if (json.success && json.data) {
        setResult(json.data);
      } else {
        setError(json.error || "SSL check failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [serverId, domain]);

  const needsOpenSSL = error?.toLowerCase().includes("openssl") && error.toLowerCase().includes("not found");

  async function installOpenSSL() {
    if (!confirm("Install openssl on this target so SSL checks can run?")) return;
    setInstalling(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/dependencies/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: "openssl" }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Install failed");
      await checkSSL();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  function getStatusIcon() {
    if (!result) return null;
    if (!result.isValid) return <XCircle className="h-5 w-5 text-red-400" />;
    if (result.daysRemaining < 30) return <AlertTriangle className="h-5 w-5 text-amber-400" />;
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  }

  function getStatusColor(): string {
    if (!result) return "border-gray-700";
    if (!result.isValid) return "border-red-500/30 bg-red-500/5";
    if (result.daysRemaining < 30) return "border-amber-500/30 bg-amber-500/5";
    return "border-emerald-500/30 bg-emerald-500/5";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-medium text-white">SSL Certificate</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          onKeyDown={(e) => e.key === "Enter" && checkSSL()}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={checkSSL}
          loading={loading}
          disabled={!domain.trim()}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Check
        </Button>
      </div>

      {error && (
        <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <p>{error}</p>
          {needsOpenSSL && (
            <Button variant="secondary" size="sm" loading={installing} disabled={safeMode} onClick={installOpenSSL} title={safeMode ? "Turn Safe Mode off to install packages" : undefined}>
              <Download className="mr-1 h-3.5 w-3.5" /> {safeMode ? "Install locked by Safe Mode" : "Install openssl and retry"}
            </Button>
          )}
        </div>
      )}

      {result && (
        <div className={`rounded-lg border p-4 ${getStatusColor()}`}>
          <div className="flex items-center gap-2 mb-3">
            {getStatusIcon()}
            <span className="text-sm font-semibold text-white">{result.domain}</span>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <span className="text-gray-500">Issuer</span>
              <p className="text-gray-300 mt-0.5 break-all">{result.issuer || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Subject</span>
              <p className="text-gray-300 mt-0.5 break-all">{result.subject || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Valid From</span>
              <p className="text-gray-300 mt-0.5">{result.validFrom || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Valid To</span>
              <p className="text-gray-300 mt-0.5">{result.validTo || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Days Remaining</span>
              <p className={`mt-0.5 font-semibold ${
                result.daysRemaining < 30 ? "text-amber-400" : "text-emerald-400"
              }`}>
                {result.daysRemaining >= 0 ? result.daysRemaining : "Expired"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Status</span>
              <p className={`mt-0.5 font-semibold ${result.isValid ? "text-emerald-400" : "text-red-400"}`}>
                {result.isValid ? "Valid" : "Invalid / Expired"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
