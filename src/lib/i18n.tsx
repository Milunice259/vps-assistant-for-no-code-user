"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ─── Locale data ───

import en from "@/locales/en.json";
import vi from "@/locales/vi.json";

type Locale = "en" | "vi";

const LOCALE_DATA: Record<Locale, Record<string, string>> = { en, vi };

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

// ─── Context ───

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, fallback?: string) => string;
  localeLabel: string;
  availableLocales: { code: Locale; label: string }[];
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
  localeLabel: "English",
  availableLocales: [],
});

// ─── Provider ───

const STORAGE_KEY = "vps-locale";

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "vi" || stored === "en") return stored;
  // Detect browser language
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("vi")) return "vi";
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      return LOCALE_DATA[locale]?.[key] || LOCALE_DATA.en?.[key] || fallback || key;
    },
    [locale]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t,
        localeLabel: LOCALE_LABELS[locale],
        availableLocales: Object.entries(LOCALE_LABELS).map(([code, label]) => ({
          code: code as Locale,
          label,
        })),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
