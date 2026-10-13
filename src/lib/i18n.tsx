"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import en from "@/locales/en.json";
import vi from "@/locales/vi.json";

type Locale = "en" | "vi";
const LOCALE_DATA: Record<Locale, Record<string, string>> = { en, vi };
const LOCALE_LABELS: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };
const availableLocales = Object.entries(LOCALE_LABELS).map(([code, label]) => ({ code: code as Locale, label }));

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

export function formatDateTime(value: string | number | Date, locale: Locale, timeZone: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { ...options, timeZone }).format(date);
}

export function calendarDate(value: string | number | Date, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  timeZone: string;
  setTimeZone: (timeZone: string) => void;
  preferencesReady: boolean;
  preferenceError: boolean;
  t: (key: string, fallback?: string) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  localeLabel: string;
  availableLocales: typeof availableLocales;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en", setLocale: () => {}, timeZone: "UTC", setTimeZone: () => {},
  preferencesReady: false, preferenceError: false,
  t: (key, fallback) => LOCALE_DATA.en[key] || fallback || key,
  formatDate: (value, options) => formatDateTime(value, "en", "UTC", options),
  localeLabel: "English", availableLocales,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  // Stable server/first-client snapshot; browser preferences are read only after hydration.
  const [locale, setLocaleState] = useState<Locale>("en");
  const [timeZone, setTimeZoneState] = useState("UTC");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [localeError, setLocaleError] = useState(false);
  const [zoneError, setZoneError] = useState(false);
  const preferenceError = localeError || zoneError;

  // Browser-only preference hydration must follow the matching server snapshot.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let storedLocale: string | null = null;
    let storedZone: string | null = null;
    try {
      storedLocale = localStorage.getItem("vps-locale");
      storedZone = localStorage.getItem("vps-timezone");
    } catch { setLocaleError(true); setZoneError(true); }
    setLocaleState(storedLocale === "en" || storedLocale === "vi" ? storedLocale : navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en");
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimeZoneState(isTimeZone(storedZone) ? storedZone : isTimeZone(browserZone) ? browserZone : "UTC");
    setPreferencesReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persist = useCallback((key: string, value: string) => {
    const setError = key === "vps-locale" ? setLocaleError : setZoneError;
    try {
      localStorage.setItem(key, value);
      setError(localStorage.getItem(key) !== value);
    } catch { setError(true); }
  }, []);

  const setLocale = useCallback((value: Locale) => {
    if (value !== "en" && value !== "vi") return;
    setLocaleState(value);
    persist("vps-locale", value);
  }, [persist]);

  const setTimeZone = useCallback((value: string) => {
    if (!isTimeZone(value)) return;
    setTimeZoneState(value);
    persist("vps-timezone", value);
  }, [persist]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = useCallback((key: string, fallback?: string) => LOCALE_DATA[locale][key] || LOCALE_DATA.en[key] || fallback || key, [locale]);
  const formatDate = useCallback((value: string | number | Date, options?: Intl.DateTimeFormatOptions) => formatDateTime(value, locale, timeZone, options), [locale, timeZone]);

  return <I18nContext.Provider value={{ locale, setLocale, timeZone, setTimeZone, preferencesReady, preferenceError, t, formatDate, localeLabel: LOCALE_LABELS[locale], availableLocales }}>{children}</I18nContext.Provider>;
}

export function useTranslation() { return useContext(I18nContext); }
