"use client";

import { useEffect, useState } from "react";

interface AuthUser {
  id: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
  role?: string;
}

interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          setUser(null);
          return;
        }
        const json = await res.json();
        if (!cancelled && json.data) {
          setUser(json.data);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  return { user, loading, logout };
}
