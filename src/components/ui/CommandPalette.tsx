"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  Search,
  Server,
  LayoutDashboard,
  Network,
  AppWindow,
  Rocket,
  Terminal,
  Shield,
  Settings,
  Users,
  Database,
  BookOpen,
  X,
} from "lucide-react";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const items: PaletteItem[] = [
    { id: "dashboard", label: "Dashboard", description: "View system overview", icon: <LayoutDashboard className="h-4 w-4" />, action: () => router.push("/dashboard"), keywords: ["home", "overview", "stats"] },
    { id: "servers", label: "Servers", description: "Manage VPS servers", icon: <Server className="h-4 w-4" />, action: () => router.push("/servers"), keywords: ["vps", "ssh", "remote"] },
    { id: "apps", label: "Applications", description: "View running applications", icon: <AppWindow className="h-4 w-4" />, action: () => router.push("/apps"), keywords: ["containers", "docker"] },
    { id: "network", label: "Network Map", description: "Network topology", icon: <Network className="h-4 w-4" />, action: () => router.push("/network"), keywords: ["topology", "ports", "map"] },
    { id: "deploy", label: "Deploy", description: "Deploy from GitHub", icon: <Rocket className="h-4 w-4" />, action: () => router.push("/deploy"), keywords: ["github", "git", "clone"] },
    { id: "terminal", label: "Terminal", description: "SSH terminal", icon: <Terminal className="h-4 w-4" />, action: () => router.push("/terminal"), keywords: ["ssh", "shell", "console"] },
    { id: "audit", label: "Audit Log", description: "Security audit trail", icon: <Shield className="h-4 w-4" />, action: () => router.push("/audit"), keywords: ["logs", "security", "activity"] },
    { id: "backup", label: "Backups", description: "Database backups", icon: <Database className="h-4 w-4" />, action: () => router.push("/backup"), keywords: ["database", "snapshot", "restore"] },
    { id: "docs", label: "Docs", description: "Beginner VPS guide", icon: <BookOpen className="h-4 w-4" />, action: () => router.push("/docs"), keywords: ["help", "guide", "documentation"] },
    { id: "users", label: "Users", description: "User management", icon: <Users className="h-4 w-4" />, action: () => router.push("/users"), keywords: ["accounts", "roles", "team"] },
    { id: "settings", label: "Settings", description: "App configuration", icon: <Settings className="h-4 w-4" />, action: () => router.push("/settings"), keywords: ["config", "preferences"] },
  ];

  const filtered = query
    ? items.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.keywords?.some((k) => k.includes(q))
        );
      })
    : items;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Open with Ctrl+K / Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      // Close with Escape
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    },
    [open]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleSelect(item: PaletteItem) {
    item.action();
    setOpen(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette Card */}
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
          <Search className="h-4 w-4 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, actions..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleInputKeyDown}
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-[10px] text-gray-400 font-mono">ESC</kbd>
          </div>
          <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  i === selectedIndex ? "bg-brand-500/20 text-white" : "text-gray-300 hover:bg-gray-800"
                }`}
              >
                <span className={i === selectedIndex ? "text-brand-400" : "text-gray-500"}>{item.icon}</span>
                <div>
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.description && <span className="text-xs text-gray-500 ml-2">{item.description}</span>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-700 flex gap-3 text-[10px] text-gray-500">
          <span><kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">↵</kbd> Open</span>
          <span><kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">Ctrl+K</kbd> Toggle</span>
        </div>
      </div>
    </div>
  );
}

/** Small trigger button for the header */
export function CommandPaletteTrigger() {
  return (
    <button
      onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
      className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-xs"
    >
      <Command className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-[10px] font-mono">⌘K</kbd>
    </button>
  );
}
