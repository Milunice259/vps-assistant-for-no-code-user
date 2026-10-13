"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseSSEOptions {
  /** Fallback polling interval if SSE fails (ms). Default: null (no fallback) */
  fallbackPollMs?: number | null;
  /** Whether the SSE connection is enabled. Default: true */
  enabled?: boolean;
  /** Override when the snapshot endpoint isn't the stream's parent. */
  pollUrl?: string;
}

interface UseSSEResult<T> {
  data: T | null;
  error: string | null;
  connected: boolean;
}

/**
 * Deep-merge a delta patch into an existing object.
 * Returns a new object reference (immutable update).
 */
function deepMerge<T>(base: T, delta: Partial<T>): T {
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return (delta as T) ?? base;
  }

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(delta as Record<string, unknown>)) {
    const deltaVal = (delta as Record<string, unknown>)[key];
    const baseVal = result[key];

    if (
      deltaVal !== null &&
      baseVal !== null &&
      typeof deltaVal === "object" &&
      typeof baseVal === "object" &&
      !Array.isArray(deltaVal) &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        deltaVal as Record<string, unknown>
      );
    } else {
      result[key] = deltaVal;
    }
  }

  return result as T;
}

/**
 * React hook for consuming SSE streams with delta compression.
 *
 * Features:
 * - Handles `snapshot` (full replace) and `delta` (merge) events
 * - Auto-reconnect with exponential backoff (1s -> 30s max)
 * - Optional polling fallback on SSE failure
 * - Cleans up on unmount
 *
 * Usage:
 * ```tsx
 * const { data, error, connected } = useSSE<DashboardSummary>("/api/dashboard/stream");
 * ```
 */
export function useSSE<T>(url: string, options?: UseSSEOptions): UseSSEResult<T> {
  const { fallbackPollMs = null, enabled = true, pollUrl = url.replace(/\/stream$/, "") } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSource = useRef<EventSource | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const generation = useRef(0);
  const pollRead = useRef(0);
  const target = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    generation.current++;
    if (eventSource.current) {
      eventSource.current.close();
      eventSource.current = null;
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (fallbackTimer.current) {
      clearInterval(fallbackTimer.current);
      fallbackTimer.current = null;
    }
  }, []);

  // Polling fallback
  const startPollingFallback = useCallback(() => {
    if (!fallbackPollMs || fallbackTimer.current) return;

    const poll = async () => {
      const readGeneration = generation.current;
      const read = ++pollRead.current;
      try {
        const res = await fetch(pollUrl, { cache: "no-store" });
        const json = await res.json();
        if (readGeneration !== generation.current || read !== pollRead.current) return;
        if (res.ok && json.success && json.data) {
          setData(json.data as T);
          setError(null);
        } else {
          setError(json.error || "Failed to refresh data");
        }
      } catch {
        if (readGeneration === generation.current && read === pollRead.current) {
          setError("Unable to refresh data");
        }
      }
    };

    poll(); // Immediate first poll
    fallbackTimer.current = setInterval(poll, fallbackPollMs);
  }, [pollUrl, fallbackPollMs]);

  const connect = useCallback(() => {
    if (!enabled) return;

    cleanup();

    const es = new EventSource(url);
    eventSource.current = es;

    es.addEventListener("snapshot", (e: MessageEvent) => {
      if (eventSource.current !== es) return;
      pollRead.current++;
      try {
        const parsed = JSON.parse(e.data) as T;
        setData(parsed);
        setError(null);
        setConnected(true);
        retryCount.current = 0;

        // Stop fallback polling if running
        if (fallbackTimer.current) {
          clearInterval(fallbackTimer.current);
          fallbackTimer.current = null;
        }
      } catch {
        // Malformed data
      }
    });

    es.addEventListener("delta", (e: MessageEvent) => {
      if (eventSource.current !== es) return;
      try {
        const delta = JSON.parse(e.data) as Partial<T>;
        setData((prev) => (prev ? deepMerge(prev, delta) : prev));
      } catch {
        // Malformed delta
      }
    });

    es.addEventListener("heartbeat", () => {
      // Connection alive — no action needed
    });

    es.addEventListener("error", (e: MessageEvent) => {
      if (eventSource.current !== es) return;
      try {
        const parsed = JSON.parse(e.data);
        setError(parsed.message || "Stream error");
      } catch {
        // Generic error
      }
    });

    es.onerror = () => {
      if (eventSource.current !== es) return;
      generation.current++;
      setConnected(false);
      es.close();
      eventSource.current = null;

      // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
      const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30_000);
      retryCount.current++;

      // After 5 failed retries, switch to polling fallback
      if (retryCount.current >= 5 && fallbackPollMs) {
        startPollingFallback();
        return;
      }

      retryTimer.current = setTimeout(() => connectRef.current(), delay);
    };
  }, [url, enabled, cleanup, fallbackPollMs, startPollingFallback]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    target.current = url;
    setData(null);
    setError(null);
    setConnected(false);
    retryCount.current = 0;
    connect();
    return cleanup;
  }, [url, connect, cleanup]);

  return target.current === url && enabled
    ? { data, error, connected }
    : { data: null, error: null, connected: false };
}
