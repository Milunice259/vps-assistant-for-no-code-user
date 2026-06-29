"use client";

import { LogOut, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { roleLabel } from "@/lib/permissions";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { user, loading, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-700 bg-gray-800 px-4 pl-16 md:px-6 md:pl-6">
      <h1 className="min-w-0 truncate text-lg font-semibold text-white md:text-xl">
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-2 md:gap-4 ml-3">
        {loading ? (
          <div className="h-5 w-24 animate-pulse rounded bg-gray-700" />
        ) : user ? (
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden items-center gap-2 text-sm text-gray-300 sm:flex">
              <User className="h-4 w-4" />
              <span>{user.displayName || user.username}</span>
              <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                {roleLabel(user.role)}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
