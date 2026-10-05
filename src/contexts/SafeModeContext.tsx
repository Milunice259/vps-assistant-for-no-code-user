"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface SafeModeContextValue {
  safeMode: boolean;
  setSafeMode: (value: boolean) => Promise<void>;
  safetyLoading: boolean;
  safetyError: string;
  expiresAt: number | null;
}

const SafeModeContext = createContext<SafeModeContextValue | null>(null);
const STORAGE_KEY = "vps-control-safe-mode";

export function SafeModeProvider({ children }: { children: ReactNode }) {
  const [safeMode, setSafeModeState] = useState(true);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [safetyLoading, setSafetyLoading] = useState(true);
  const [safetyError, setSafetyError] = useState("");
  const changing = useRef(false);
  const revision = useRef(0);
  const revokePending = useRef(false);

  const readSafety = useCallback(async () => {
    if (changing.current) return;
    const current = ++revision.current;
    try {
      const res = await fetch("/api/auth/safety", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Unable to check Safe Mode");
      if (current !== revision.current) return;
      const expiry = Number(json.data?.expiresAt);
      const advanced = json.data?.safeMode === false && Number.isFinite(expiry) && expiry > Date.now();
      // A still-valid old cookie cannot undo an unconfirmed local revocation.
      if (advanced && revokePending.current) return;
      if (!advanced) revokePending.current = false;
      setSafeModeState(!advanced);
      setExpiresAt(advanced ? expiry : null);
      setSafetyError("");
    } catch {
      if (current !== revision.current) return;
      setSafeModeState(true);
      setExpiresAt(null);
      setSafetyError("Cannot confirm server safety setting. Changes are locked; retry the toggle.");
    } finally {
      if (current === revision.current) setSafetyLoading(false);
    }
  }, []);

  useEffect(() => {
    void readSafety();
    const refocus = () => { if (document.visibilityState === "visible") void readSafety(); };
    const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) void readSafety(); };
    window.addEventListener("focus", refocus);
    document.addEventListener("visibilitychange", refocus);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("focus", refocus);
      document.removeEventListener("visibilitychange", refocus);
      window.removeEventListener("storage", storage);
    };
  }, [readSafety]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      setSafeModeState(true);
      setExpiresAt(null);
      void readSafety();
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, readSafety]);

  const setSafeMode = useCallback(async (next: boolean) => {
    if (changing.current) return;
    if (!next && !window.confirm("Enable Advanced Mode for up to 15 minutes? Server changes can interrupt apps or access. Only continue if you understand the impact.")) return;
    changing.current = true;
    revokePending.current = true;
    ++revision.current;
    setSafetyLoading(true);
    setSafetyError("");
    // Lock controls until the server confirms the new state.
    setSafeModeState(true);
    setExpiresAt(null);
    let failure = "";
    try {
      const res = await fetch("/api/auth/safety", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ safeMode: next, acknowledged: true }) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Safety setting failed");
      if (!next) revokePending.current = false;
      // Storage only notifies other tabs; neither old nor new storage values authorize changes.
      try { window.localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* storage may be unavailable */ }
    } catch (error) {
      failure = error instanceof Error ? error.message : "Safety setting failed. Retry.";
    } finally {
      changing.current = false;
      // Read back the exact server-owned setting, also after an uncertain network result.
      await readSafety();
      if (failure && (!next || revokePending.current)) setSafetyError(failure);
      setSafetyLoading(false);
    }
  }, [readSafety]);
  const [locked, setLocked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [hasPasscode, setHasPasscode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    fetch("/api/auth/me").then((res) => res.json()).then((json) => {
      if (!cancelled) setHasPasscode(Boolean(json.data?.passcodeEnabled));
    }).catch(() => undefined);
    fetch("/api/settings/security")
      .then((res) => res.json())
      .then((json) => {
        const idleMinutes = Number(json.data?.idleTimeoutMinutes || 0);
        if (cancelled || locked || !Number.isFinite(idleMinutes) || idleMinutes <= 0) return;
        let timer: ReturnType<typeof setTimeout>;
        const reset = () => {
          clearTimeout(timer);
          timer = setTimeout(() => setLocked(true), idleMinutes * 60_000);
        };
        ["click", "keydown", "mousemove", "scroll"].forEach((event) => window.addEventListener(event, reset));
        reset();
        cleanup = () => {
          clearTimeout(timer);
          ["click", "keydown", "mousemove", "scroll"].forEach((event) => window.removeEventListener(event, reset));
        };
      })
      .catch(() => undefined);
    return () => { cancelled = true; cleanup(); };
  }, [locked]);

  async function unlock() {
    setUnlockError("");
    const res = await fetch("/api/auth/passcode/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setUnlockError(json.error || "Unlock failed");
      return;
    }
    setPasscode("");
    setLocked(false);
  }

  const value = useMemo(() => ({
    safeMode,
    setSafeMode,
    safetyLoading,
    safetyError,
    expiresAt,
  }), [safeMode, setSafeMode, safetyLoading, safetyError, expiresAt]);

  return (
    <SafeModeContext.Provider value={value}>
      {children}
      {locked && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Session locked</h2>
            <p className="mt-1 text-sm text-gray-400">Idle timeout triggered. Quick unlock keeps the session without full login.</p>
            {hasPasscode ? (
              <>
                <input autoFocus type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") unlock(); }} placeholder="Passcode" className="mt-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white outline-none focus:border-brand-500" />
                {unlockError && <p className="mt-2 text-sm text-red-300">{unlockError}</p>}
                <button onClick={unlock} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">Unlock</button>
              </>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">Passcode is not enabled for this user.</p>
            )}
            <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).finally(() => { window.location.href = "/login"; })} className="mt-3 w-full rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:text-white">Use password login</button>
          </div>
        </div>
      )}
    </SafeModeContext.Provider>
  );
}

export function useSafeMode() {
  const ctx = useContext(SafeModeContext);
  if (!ctx) throw new Error("useSafeMode must be used inside SafeModeProvider");
  return ctx;
}
