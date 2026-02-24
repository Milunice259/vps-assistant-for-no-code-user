"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

// Map route segments to friendly labels
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  servers: "Servers",
  network: "Network",
  apps: "Applications",
  deploy: "Deploy",
  terminal: "Terminal",
  audit: "Audit Log",
  settings: "Settings",
  users: "Users",
};

export function Breadcrumbs() {
  const pathname = usePathname();

  // Don't show on root pages
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = SEGMENT_LABELS[seg] || (seg.length > 20 ? seg.slice(0, 12) + "…" : seg);
    const isLast = i === segments.length - 1;

    return { href, label, isLast };
  });

  return (
    <nav className="flex items-center gap-1.5 text-xs text-gray-500 mb-4" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-white transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3" />
          {crumb.isLast ? (
            <span className="text-gray-300 font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-white transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
