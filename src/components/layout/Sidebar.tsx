"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Network,
  AppWindow,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  SquareTerminal,
  Menu,
  X,
  Users,
  Database,
  BookOpen,
} from "lucide-react";
import clsx from "clsx";
import { useSidebar } from "@/contexts/SidebarContext";
import { useSafeMode } from "@/contexts/SafeModeContext";
import { useAuth } from "@/hooks/useAuth";
import { can, type Role } from "@/lib/permissions";
import { useState, useEffect } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  minRole?: Role;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Monitoring",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-5 w-5" /> },
      { label: "Servers", href: "/servers", icon: <Server className="h-5 w-5" /> },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Apps", href: "/apps", icon: <AppWindow className="h-5 w-5" /> },
      { label: "Deploy", href: "/deploy", icon: <GitBranch className="h-5 w-5" />, minRole: "OPERATOR" },
      { label: "Network", href: "/network", icon: <Network className="h-5 w-5" />, minRole: "OPERATOR" },
      { label: "Terminal", href: "/terminal", icon: <SquareTerminal className="h-5 w-5" />, minRole: "OPERATOR" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users", href: "/users", icon: <Users className="h-5 w-5" />, minRole: "ADMIN" },
      { label: "Backups", href: "/backup", icon: <Database className="h-5 w-5" />, minRole: "ADMIN" },
      { label: "Audit Log", href: "/audit", icon: <Shield className="h-5 w-5" /> },
      { label: "Docs", href: "/docs", icon: <BookOpen className="h-5 w-5" /> },
      { label: "Settings", href: "/settings", icon: <Settings className="h-5 w-5" />, minRole: "ADMIN" },
    ],
  },
];

/**
 * Renders sidebar inner content.
 * @param showLabels — when true, group headers + nav labels are visible.
 *                     Mobile drawer always passes true; desktop follows `collapsed`.
 */
function SidebarInner({
  showLabels,
  onMobileClose,
}: {
  showLabels: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { safeMode, setSafeMode } = useSafeMode();
  const { user } = useAuth();

  return (
    <>
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-700 px-4">
        <img src="/logo.svg" alt="VPS Control" className="h-8 w-8 shrink-0 rounded-lg" />
        {showLabels && (
          <span className="text-lg font-bold text-white">VPS Control</span>
        )}
        {/* Mobile close button */}
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            className="ml-auto text-gray-400 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation with groups */}
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {showLabels && (
              <span className="mb-1 block px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {group.label}
              </span>
            )}
            <div className="space-y-1">
              {group.items.filter((item) => (!item.minRole || can(user?.role, item.minRole)) && (!safeMode || item.href !== "/terminal")).map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-brand-600/20 text-brand-400"
                        : "text-gray-400 hover:bg-gray-800 hover:text-white"
                    )}
                    title={!showLabels ? item.label : undefined}
                    onClick={onMobileClose}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {showLabels && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {showLabels && (
        <div className="border-t border-gray-700 p-3">
          <button
            onClick={() => setSafeMode(!safeMode)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-gray-600"
          >
            <span>{safeMode ? "Safe Mode On" : "Advanced Mode"}</span>
            <span className={safeMode ? "text-emerald-400" : "text-yellow-400"}>{safeMode ? "Safe" : "Risk"}</span>
          </button>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  return (
    <>
      {/* Mobile hamburger button — flush with the header bar */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed left-0 top-0 z-50 flex h-16 w-16 items-center justify-center border-b border-gray-700 bg-gray-800 text-gray-400 hover:text-white md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Mobile drawer — always shows labels regardless of collapsed state */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-50 flex h-screen h-[100dvh] w-64 flex-col border-r border-gray-700 bg-gray-900 transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarInner showLabels onMobileClose={closeMobileMenu} />
      </aside>

      {/* Desktop sidebar — respects collapsed state */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-40 hidden flex-col border-r border-gray-700 bg-gray-900 transition-all duration-300 md:flex",
          "h-screen h-[100dvh]",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <button
          onClick={toggle}
          className="absolute -right-3 top-5 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-gray-400 shadow-lg transition-colors hover:border-gray-600 hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
        <SidebarInner showLabels={!collapsed} />
        {/* Collapse toggle — desktop only */}
        <div className="shrink-0 border-t border-gray-700 p-3">
          <button
            onClick={toggle}
            className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <>
                <PanelLeftClose className="h-5 w-5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
