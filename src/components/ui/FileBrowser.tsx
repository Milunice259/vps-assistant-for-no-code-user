"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  HardDrive,
  FolderSearch,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

/* ── Types ── */

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

interface FileBrowserProps {
  serverId: string;
  /** When set, the browser acts as a directory picker */
  mode?: "browse" | "pick-directory";
  /** Called when a directory is selected (pick-directory mode) */
  onSelect?: (path: string) => void;
  /** Currently selected path */
  selectedPath?: string;
  /** Initial root path */
  initialPath?: string;
}

/* ── File icon helper ── */

function FileIcon({ name, type }: { name: string; type: "file" | "directory" }) {
  if (type === "directory") return <Folder className="h-4 w-4 text-blue-400 shrink-0" />;
  const ext = name.split(".").pop()?.toLowerCase();
  if (["yml", "yaml", "json", "toml", "env", "conf", "cfg", "ini"].includes(ext || ""))
    return <FileCode className="h-4 w-4 text-yellow-400 shrink-0" />;
  if (["md", "txt", "log", "csv"].includes(ext || ""))
    return <FileText className="h-4 w-4 text-gray-400 shrink-0" />;
  if (["sh", "bash", "py", "js", "ts", "tsx", "jsx", "go", "rs"].includes(ext || ""))
    return <FileCode className="h-4 w-4 text-emerald-400 shrink-0" />;
  return <File className="h-4 w-4 text-gray-500 shrink-0" />;
}

/* ── File size formatter ── */

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/* ── Tree Node ── */

function TreeNode({
  entry,
  serverId,
  depth,
  mode,
  selectedPath,
  onSelect,
}: {
  entry: FileEntry;
  serverId: string;
  depth: number;
  mode: "browse" | "pick-directory";
  selectedPath?: string;
  onSelect?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirectory = entry.type === "directory";
  const isSelected = selectedPath === entry.path;

  const loadChildren = useCallback(async () => {
    if (!isDirectory || children !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(entry.path)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load");
      setChildren(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [serverId, entry.path, isDirectory, children]);

  const handleClick = () => {
    if (isDirectory) {
      if (!expanded) loadChildren();
      setExpanded(!expanded);
      if (mode === "pick-directory" && onSelect) {
        onSelect(entry.path);
      }
    }
  };

  // Skip files in directory picker mode
  if (mode === "pick-directory" && !isDirectory) return null;

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md transition-colors hover:bg-gray-700/50 group ${
          isSelected ? "bg-brand-500/10 border border-brand-500/30" : ""
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand arrow */}
        {isDirectory ? (
          <span className="w-4 flex items-center justify-center shrink-0">
            {loading ? (
              <RefreshCw className="h-3 w-3 animate-spin text-gray-500" />
            ) : expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
            )}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Icon */}
        {isDirectory && expanded ? (
          <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
        ) : (
          <FileIcon name={entry.name} type={entry.type} />
        )}

        {/* Name */}
        <span className={`truncate ${isDirectory ? "text-white font-medium" : "text-gray-400"}`}>
          {entry.name}
        </span>

        {/* Size (files only in browse mode) */}
        {!isDirectory && mode === "browse" && (
          <span className="ml-auto text-xs text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatSize(entry.size)}
          </span>
        )}

        {/* Selected indicator */}
        {isSelected && mode === "pick-directory" && (
          <span className="ml-auto text-xs text-brand-400 font-medium">Selected</span>
        )}
      </button>

      {/* Error */}
      {error && (
        <div
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-red-400"
          style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
        >
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      {/* Children */}
      {expanded && children && (
        <div>
          {children.length === 0 ? (
            <div
              className="px-2 py-1.5 text-xs text-gray-600 italic"
              style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
            >
              Empty folder
            </div>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                serverId={serverId}
                depth={depth + 1}
                mode={mode}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const ALL_QUICK_DIRS = [
  { name: "Root", path: "/" },
  { name: "Home", path: "/home" },
  { name: "Opt", path: "/opt" },
  { name: "Var/www", path: "/var/www" },
  { name: "Etc", path: "/etc" },
];

/* ── Main Component ── */

export function FileBrowser({
  serverId,
  mode = "browse",
  onSelect,
  selectedPath,
  initialPath = "/",
}: FileBrowserProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(initialPath);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setCurrentPath(path);
    try {
      const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load directory");
      setRootEntries(json.data || []);
    } catch (err) {
      setRootEntries(null);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    loadDirectory(initialPath);
  }, [initialPath, loadDirectory]);

  // Breadcrumb navigation
  const pathParts = currentPath.split("/").filter(Boolean);
  const breadcrumbs = [
    { name: "/", path: "/" },
    ...pathParts.map((part, i) => ({
      name: part,
      path: "/" + pathParts.slice(0, i + 1).join("/"),
    })),
  ];

  // Quick access directories are filtered to only existing paths.
  const [quickDirs, setQuickDirs] = useState(ALL_QUICK_DIRS.slice(0, 1));

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const results = await Promise.all(
        ALL_QUICK_DIRS.map(async (d) => {
          if (d.path === "/") return d;
          try {
            const res = await fetch(
              `/api/servers/${serverId}/files?path=${encodeURIComponent(d.path)}`
            );
            return res.ok ? d : null;
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) {
        setQuickDirs(results.filter(Boolean) as typeof ALL_QUICK_DIRS);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [serverId]);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="text-sm font-medium text-white">
            {mode === "pick-directory" ? "Select Directory" : "File Browser"}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => loadDirectory(currentPath)}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Quick access bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30 overflow-x-auto">
        {quickDirs.map((d) => (
          <button
            key={d.path}
            onClick={() => loadDirectory(d.path)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
              currentPath === d.path
                ? "bg-brand-500/10 text-brand-400 border border-brand-500/30"
                : "text-gray-400 hover:text-white hover:bg-gray-700/50"
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 text-xs text-gray-500 overflow-x-auto border-b border-gray-700/30">
        {breadcrumbs.map((b, i) => (
          <span key={b.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-700">/</span>}
            <button
              onClick={() => loadDirectory(b.path)}
              className="hover:text-white transition-colors"
            >
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* Tree content */}
      <div className="max-h-[350px] overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertCircle className="h-6 w-6 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => loadDirectory(currentPath)}>
              Retry
            </Button>
          </div>
        ) : rootEntries && rootEntries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FolderSearch className="h-6 w-6 text-gray-600" />
            <p className="text-sm text-gray-500">This directory is empty</p>
          </div>
        ) : (
          rootEntries?.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              serverId={serverId}
              depth={0}
              mode={mode}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {/* Selected path display */}
      {mode === "pick-directory" && selectedPath && (
        <div className="px-4 py-2.5 border-t border-gray-700 bg-gray-800">
          <div className="flex items-center gap-2">
            <Folder className="h-3.5 w-3.5 text-brand-400 shrink-0" />
            <span className="text-xs text-gray-400">Selected:</span>
            <span className="text-xs text-white font-mono truncate">{selectedPath}</span>
          </div>
        </div>
      )}
    </div>
  );
}
