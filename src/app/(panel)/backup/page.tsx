"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Database,
  Download,
  RefreshCw,
  Trash2,
  RotateCw,
  Plus,
  HardDrive,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PermissionGate } from "@/components/ui/PermissionGate";
import { useSafeMode } from "@/contexts/SafeModeContext";

interface BackupEntry {
  name: string;
  size: number;
  created: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupPage() {
  const { safeMode } = useSafeMode();
  const busy = useRef(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/backup");
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.data)) throw new Error(json.error || "Failed to verify backup list");
      setBackups(json.data);
      return json.data as BackupEntry[];
    } catch {
      setBackups([]);
      setError("Failed to load backups");
      throw new Error("Backup list unavailable; refresh to verify the outcome before retrying.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups().catch(() => {}); }, [fetchBackups]);

  async function handleCreate() {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const json = await res.json();
      if (json.success) {
        const files = await fetchBackups();
        if (!files.some(file => file.name === json.data?.name)) throw new Error("Creation completed, but the snapshot was not found in readback. Refresh before retrying.");
        setSuccess(`Backup created and listed: ${json.data?.name}`);
      } else setError(json.error);
    } catch (error) { setSuccess(null); setError(error instanceof Error ? error.message : "Creation outcome unknown. Refresh before retrying."); }
    finally { busy.current = false; setCreating(false); }
  }

  async function handleDelete(name: string) {
    if (safeMode || busy.current) return;
    busy.current = true;
    setDeleting(name);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/backup?name=${encodeURIComponent(name)}`, { method: "DELETE", headers: { "X-Safe-Mode-Off": "true" } });
      const json = await res.json();
      if (json.success) {
        const files = await fetchBackups();
        if (files.some(file => file.name === name)) throw new Error("Deletion completed, but the checkpoint remains in readback. Refresh before retrying.");
        setSuccess(`Deletion verified: ${name}`);
      } else setError(json.error);
    } catch (error) { setSuccess(null); setError(error instanceof Error ? error.message : "Deletion outcome unknown. Refresh before retrying."); }
    finally { busy.current = false; setDeleting(null); setConfirmDelete(null); }
  }

  return (
    <PermissionGate minimum="ADMIN">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-brand-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Panel database backups</h1>
            <p className="text-sm text-gray-400">Panel database checkpoints — not VPS or app backups</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={creating || !!deleting} onClick={() => { setError(null); fetchBackups().catch(() => {}); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate} loading={creating} disabled={!!deleting}>
            <Plus className="h-4 w-4 mr-1" /> Create Backup
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
        SQLite-consistent snapshots with an integrity check before saving. Includes panel data only, not VPS files, apps, volumes or encryption keys. Live restore stays locked: recovery requires stopping the panel and preserving a pre-restore snapshot. See <Link href="/docs#backup" className="text-brand-400 hover:text-brand-300">Recovery steps</Link>.
        {safeMode && <p className="mt-2 text-amber-300">Safe Mode is on: deletion is locked. You can still create a panel checkpoint.</p>}
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white">×</button>
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
          <Download className="h-4 w-4 shrink-0" /> {success}
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-300 hover:text-white">×</button>
        </div>
      )}

      {/* Backup List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : backups.length === 0 ? (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <HardDrive className="h-10 w-10 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400 mb-2">No backups yet</p>
          <p className="text-sm text-gray-500 mb-4">Save an integrity-checked snapshot of the panel database.</p>
          <Button variant="primary" size="sm" onClick={handleCreate} loading={creating} disabled={!!deleting}>
            <Plus className="h-4 w-4 mr-1" /> Create First Backup
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/50">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name} className="border-b border-gray-700/50 hover:bg-gray-800/80 transition-colors">
                  <td className="px-4 py-3 text-white font-mono text-xs">{b.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="info">{formatSize(b.size)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(b.created).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="secondary" size="sm" disabled title="Maintenance-only: safe restore is not yet implemented">
                        <RotateCw className="h-3.5 w-3.5 mr-1" /> Restore
                      </Button>
                      <Button variant="danger" size="sm" disabled={safeMode || creating || !!deleting} loading={deleting === b.name} aria-label={`Delete ${b.name}`} title={safeMode ? "Turn off Safe Mode to delete this checkpoint" : "Permanently delete this panel checkpoint"} onClick={() => setConfirmDelete(b.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={!!confirmDelete && !safeMode}
        title="Delete Backup"
        message={`Permanently delete panel database checkpoint "${confirmDelete}"? This removes this recovery file and cannot be undone. It does not delete the live panel database or any VPS/app files.`}
        confirmLabel="Delete"
        confirmationText="DELETE"
        variant="danger"
        loading={!!deleting}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => { if (!busy.current) setConfirmDelete(null); }}
      />
    </div>
    </PermissionGate>
  );
}
