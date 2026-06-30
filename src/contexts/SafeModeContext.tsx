"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

interface SafeModeContextValue {
  safeMode: boolean;
  setSafeMode: (value: boolean) => void;
}

const SafeModeContext = createContext<SafeModeContextValue | null>(null);
const STORAGE_KEY = "vps-control-safe-mode";

export function SafeModeProvider({ children }: { children: ReactNode }) {
  const [safeMode, setSafeModeState] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored !== "false";
  });
  const [locked, setLocked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [hasPasscode, setHasPasscode] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((res) => res.json()).then((json) => setHasPasscode(Boolean(json.data?.passcodeEnabled))).catch(() => undefined);
    fetch("/api/settings/security")
      .then((res) => res.json())
      .then((json) => {
        if (window.localStorage.getItem(STORAGE_KEY) === null && typeof json.data?.defaultSafeMode === "boolean") {
          setSafeModeState(json.data.defaultSafeMode);
        }
        const idleMinutes = Number(json.data?.idleTimeoutMinutes || 0);
        if (!idleMinutes) return;
        let timer: ReturnType<typeof setTimeout>;
        const reset = () => {
          if (locked) return;
          clearTimeout(timer);
          timer = setTimeout(() => setLocked(true), idleMinutes * 60_000);
        };
        ["click", "keydown", "mousemove", "scroll"].forEach((event) => window.addEventListener(event, reset));
        reset();
        return () => {
          clearTimeout(timer);
          ["click", "keydown", "mousemove", "scroll"].forEach((event) => window.removeEventListener(event, reset));
        };
      })
      .catch(() => undefined);
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
    setSafeMode: (next: boolean) => {
      setSafeModeState(next);
      window.localStorage.setItem(STORAGE_KEY, String(next));
    },
  }), [safeMode]);

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
