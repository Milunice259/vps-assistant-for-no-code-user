"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
const themeEvent = "panel-theme-change";
let sessionTheme: ThemeMode | null = null;
let persistenceError = false;

function readTheme(): ThemeMode {
  if (sessionTheme) return sessionTheme;
  try {
    const saved = localStorage.getItem("theme");
    persistenceError = false;
    if (saved === "light" || saved === "system") return saved;
  } catch { persistenceError = true; return "dark"; }
  return "dark";
}

export function useTheme() {
  // Match the server on first render; read browser preferences only after hydration.
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [themeError, setThemeError] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const mode = readTheme();
      setTheme(mode);
      setThemeError(persistenceError);
      const dark = mode === "dark" || (mode === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.classList.toggle("dark", dark);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "theme" || event.key === null) { sessionTheme = null; sync(); }
    };
    sync();
    media.addEventListener("change", sync);
    window.addEventListener(themeEvent, sync);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener(themeEvent, sync);
      window.removeEventListener("storage", storage);
    };
  }, []);

  function changeTheme(mode: ThemeMode) {
    if (mode !== "dark" && mode !== "light" && mode !== "system") return;
    try {
      localStorage.setItem("theme", mode);
      if (localStorage.getItem("theme") !== mode) throw new Error("Theme not saved");
      sessionTheme = null; persistenceError = false;
    } catch { sessionTheme = mode; persistenceError = true; } // Storage denial must not disable the control.
    window.dispatchEvent(new Event(themeEvent));
  }

  return { theme, changeTheme, themeError };
}
