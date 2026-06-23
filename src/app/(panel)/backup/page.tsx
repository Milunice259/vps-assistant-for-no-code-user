"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
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
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/backup");
      const json = await res.json();
      if (json.success) setBackups(json.data || []);
      else setError(json.error);
    } catch {
      setError("Failed to load backups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Backup created: ${json.data?.name}`);
        fetchBackups();
      } else setError(json.error);
    } catch { setError("Failed to create backup"); }
    finally { setCreating(false); }
  }

  async function handleRestore(name: string) {
    setError(null);
    try {
      const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", name }) });
      const json = await res.json();
      if (json.success) setSuccess(json.message);
      else setError(json.error);
    } catch { setError("Restore failed"); }
    setConfirmRestore(null);
  }

  async function handleDelete(name: string) {
    setError(null);
    try {
      const res = await fetch(`/api/backup?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Deleted ${name}`);
        fetchBackups();
      } else setError(json.error);
    } catch { setError("Failed to delete backup"); }
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-brand-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Backup & Restore</h1>
            <p className="text-sm text-gray-400">Save a safe checkpoint before fixes, updates, or risky changes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={fetchBackups}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>
            <Plus className="h-4 w-4 mr-1" /> Create Backup
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
        Backups protect panel data. For what is included and when to restore, see <Link href="/docs#backup" className="text-brand-400 hover:text-brand-300">Backup docs</Link>.
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
          <p className="text-sm text-gray-500 mb-4">Create your first backup to protect your data.</p>
          <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>
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
                      <Button variant="secondary" size="sm" onClick={() => setConfirmRestore(b.name)}>
                        <RotateCw className="h-3.5 w-3.5 mr-1" /> Restore
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setConfirmDelete(b.name)}>
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
        open={!!confirmRestore}
        title="Restore Backup"
        message={`Are you sure you want to restore from "${confirmRestore}"? A pre-restore backup will be created automatically.`}
        confirmLabel="Restore"
        onConfirm={() => confirmRestore && handleRestore(confirmRestore)}
        onCancel={() => setConfirmRestore(null)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Backup"
        message={`Are you sure you want to permanently delete "${confirmDelete}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
