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

  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
    fetch("/api/settings/security")
      .then((res) => res.json())
      .then((json) => {
        if (typeof json.data?.defaultSafeMode === "boolean") setSafeModeState(json.data.defaultSafeMode);
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo(() => ({
    safeMode,
    setSafeMode: (next: boolean) => {
      setSafeModeState(next);
      window.localStorage.setItem(STORAGE_KEY, String(next));
    },
  }), [safeMode]);

  return <SafeModeContext.Provider value={value}>{children}</SafeModeContext.Provider>;
}

export function useSafeMode() {
  const ctx = useContext(SafeModeContext);
  if (!ctx) throw new Error("useSafeMode must be used inside SafeModeProvider");
  return ctx;
}
