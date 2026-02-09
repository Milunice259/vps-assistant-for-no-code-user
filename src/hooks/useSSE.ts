"use client";

import { useEffect, useRef, useState } from "react";

interface UseSSEResult<T> {
  data: T | null;
  error: string | null;
  connected: boolean;
}

export function useSSE<T = unknown>(url: string): UseSSEResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as T;
        setData(parsed);
      } catch {
        setError("Failed to parse SSE message");
      }
    };

    source.onerror = () => {
      setConnected(false);
      setError("SSE connection lost");
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [url]);

  return { data, error, connected };
}
