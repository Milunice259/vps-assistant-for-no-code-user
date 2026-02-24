"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Network,
  AppWindow,
  GitBranch,
  Terminal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  SquareTerminal,
  Menu,
  X,
  Users,
  Database,
} from "lucide-react";
import clsx from "clsx";
import { useSidebar } from "@/contexts/SidebarContext";
import { useState, useEffect } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
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
      { label: "Deploy", href: "/deploy", icon: <GitBranch className="h-5 w-5" /> },
      { label: "Network", href: "/network", icon: <Network className="h-5 w-5" /> },
      { label: "Terminal", href: "/terminal", icon: <SquareTerminal className="h-5 w-5" /> },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users", href: "/users", icon: <Users className="h-5 w-5" /> },
      { label: "Backups", href: "/backup", icon: <Database className="h-5 w-5" /> },
      { label: "Audit Log", href: "/audit", icon: <Shield className="h-5 w-5" /> },
      { label: "Settings", href: "/settings", icon: <Settings className="h-5 w-5" /> },
    ],
  },
];

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-700 px-4">
        <Terminal className="h-6 w-6 shrink-0 text-brand-400" />
        {!collapsed && (
          <span className="text-lg font-bold text-white">VPS Control</span>
        )}
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto text-gray-400 hover:text-white md:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation with groups */}
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <span className="mb-1 block px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {group.label}
              </span>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
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
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      <div className="hidden shrink-0 border-t border-gray-700 p-3 md:block">
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
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-gray-800 p-2 text-gray-400 shadow-lg hover:text-white md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-50 flex h-screen h-[100dvh] w-64 flex-col border-r border-gray-700 bg-gray-900 transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-40 hidden flex-col border-r border-gray-700 bg-gray-900 transition-all duration-300 md:flex",
          "h-screen h-[100dvh]",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
