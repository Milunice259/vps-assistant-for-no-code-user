"use client";

import { useTranslation } from "@/lib/i18n";
import { useState, useCallback, useEffect, useRef } from "react";
import { HeartPulse, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface HealthResult {
  status: "healthy" | "unhealthy" | "unknown";
  checkedAt: string;
  containerState: string;
  container?: { status: string; state: string; health: string };
  backend?: { status: "verified" | "failed" | "unavailable" | "unsupported" };
  tls?: { tls: string };
}

export function AppHealthCheck({ appId }: { appId: string }) {
  return <TargetHealthCheck key={appId} appId={appId} />;
}

function TargetHealthCheck({ appId }: { appId: string }) {
  const { formatDate } = useTranslation();
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const runCheck = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setResult(null);
    setError(null);
    const timeout = setTimeout(() => {
      controller.abort();
      if (controller === request.current) {
        setResult(null);
        setError("Readiness check timed out. Try again.");
        setLoading(false);
      }
    }, 20_000);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(appId)}/health`, { cache: "no-store", signal: controller.signal });
      if (controller !== request.current || controller.signal.aborted) return;
      if (!res.ok) {
        setError(res.status === 401 || res.status === 403 ? "Access denied. Previous readiness is hidden." : "Readiness unavailable. Try again.");
        return;
      }
      const json = await res.json();
      if (controller !== request.current || controller.signal.aborted) return;
      if (!json.success || !json.data || !["healthy", "unhealthy", "unknown"].includes(json.data.status) || !Number.isFinite(Date.parse(json.data.checkedAt))) {
        setError("Readiness unavailable. Try again.");
        return;
      }
      setResult(json.data);
    } catch {
      if (controller === request.current) setError("Offline or check timed out. Readiness is not verified.");
    } finally {
      clearTimeout(timeout);
      if (controller === request.current) setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void runCheck();
    return () => { request.current?.abort(); request.current = null; };
  }, [runCheck]);

  const docker = result?.container?.status === "unhealthy" ? "unhealthy" : result?.container?.health || result?.status || "unknown";
  const backend = result?.backend?.status || "unavailable";
  const tls = result?.tls?.tls || "unavailable";
  const labels: Record<string, string> = {
    healthy: "Healthy", unhealthy: "Unhealthy", unknown: "Not verified", none: "No health check", starting: "Starting",
    verified: "Verified", failed: "Failed", unavailable: "Unavailable", unsupported: "Unsupported",
    pending: "Pending", not_requested: "Not configured", certificate_pending_or_unverified: "Not verified",
  };
  return (
    <section className="space-y-3 min-w-0" aria-label="Application readiness" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <HeartPulse className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-white">Application readiness</h3>
        <Button variant="ghost" size="sm" onClick={runCheck} loading={loading} disabled={loading} className="min-h-11">
          <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Check now
        </Button>
      </div>
      <p className="text-xs text-gray-400">Docker health, HTTP response and TLS certificate are independent checks.</p>
      <div role="status" aria-live="polite" className="text-sm text-gray-400 break-words">
        {loading ? "Checking readiness…" : error}
      </div>
      {result && !loading && !error && <>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {[["Docker health", docker], ["HTTP backend", backend], ["TLS certificate", tls]].map(([label, state]) => (
            <div key={label} className="rounded-lg border border-gray-800 p-3 min-w-0">
              <dt className="text-xs text-gray-400">{label}</dt>
              <dd className={`mt-1 ${state === "verified" || state === "healthy" ? "text-emerald-400" : state === "failed" || state === "unhealthy" ? "text-red-400" : "text-gray-300"}`}>{labels[state] || "Not verified"}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-gray-400">Container: {typeof result.containerState === "string" && /^(running|exited|created|paused|restarting|dead|removing)$/.test(result.containerState) ? result.containerState : "unknown"} · Checked {formatDate(result.checkedAt, { timeStyle: "medium" })}</p>
      </>}
    </section>
  );
}
