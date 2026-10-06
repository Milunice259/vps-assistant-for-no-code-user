"use client";
import { useEffect, useRef, useState } from "react";
export type PreflightResult = {
  ready: boolean; checks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>; nextSteps: string[];
};
// Only a revision is retained, never input/Compose/environment snapshots.
export function useDeployPreflight() {
  const sequence = useRef(0);
  const readyRef = useRef(false);
  const busyRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightError, setError] = useState<string | null>(null);
  function invalidate() {
    sequence.current++; readyRef.current = false; setPreflight(null); setError(null); setChecking(false);
  }
  useEffect(() => () => { sequence.current++; readyRef.current = false; }, []);
  async function runPreflight(body: object) {
    if (busyRef.current) return;
    invalidate();
    const revision = sequence.current;
    setChecking(true);
    try {
      const response = await fetch("/api/deploy/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json();
      if (revision !== sequence.current) return;
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Pre-flight failed");
      readyRef.current = json.data.ready === true;
      setPreflight(json.data);
    } catch (error) {
      if (revision === sequence.current) setError(error instanceof Error ? error.message : "Pre-flight failed");
    } finally { if (revision === sequence.current) setChecking(false); }
  }
  return { checking, preflight, preflightError, runPreflight, invalidate, readyRef, busyRef };
}
