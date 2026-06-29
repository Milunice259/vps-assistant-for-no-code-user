"use client";

import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { can, roleLabel, type Role } from "@/lib/permissions";

export function PermissionGate({ minimum, children }: { minimum: Role; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-gray-800/50" />;
  if (can(user?.role, minimum)) return <>{children}</>;
  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-6 text-yellow-200">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5" />
        <div>
          <p className="font-medium">Permission required: {roleLabel(minimum)}+</p>
          <p className="mt-1 text-sm text-yellow-200/70">Your role is {roleLabel(user?.role)}.</p>
        </div>
      </div>
    </div>
  );
}
