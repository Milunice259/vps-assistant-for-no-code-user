"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";

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
