"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Edit2, Trash2, Shield, Eye, Wrench, X, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

const ROLE_CONFIG = {
  ADMIN: { label: "Admin", icon: <Shield className="h-3.5 w-3.5" />, color: "text-red-400 bg-red-500/10 border-red-500/20" },
  OPERATOR: { label: "Operator", icon: <Wrench className="h-3.5 w-3.5" />, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  VIEWER: { label: "Viewer", icon: <Eye className="h-3.5 w-3.5" />, color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
} as const;

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("VIEWER");

  // Edit form state
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      if (json.success) setUsers(json.data);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate() {
    setError("");
    if (!newUsername || !newPassword) {
      setError("Username and password are required");
      return;
    }
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`User "${newUsername}" created successfully`);
        setNewUsername(""); setNewPassword(""); setNewRole("VIEWER");
        setShowCreate(false);
        fetchUsers();
      } else {
        setError(json.error || "Failed to create user");
      }
    } catch { setError("Network error"); }
  }

  async function handleUpdate(userId: string) {
    setError("");
    const body: Record<string, string> = {};
    if (editRole) body.role = editRole;
    if (editPassword) body.password = editPassword;

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess("User updated successfully");
        setEditingId(null); setEditRole(""); setEditPassword("");
        fetchUsers();
      } else {
        setError(json.error || "Failed to update user");
      }
    } catch { setError("Network error"); }
  }

  async function handleDelete(userId: string) {
    setError("");
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setSuccess("User deleted");
        setDeleteConfirm(null);
        fetchUsers();
      } else {
        setError(json.error || "Failed to delete user");
      }
    } catch { setError("Network error"); }
  }

  // Clear messages after 4s
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(""); setSuccess(""); }, 4000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-800/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-brand-400" />
          <span className="text-sm text-gray-400">{users.length} users</span>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" />
          Add User
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-brand-500/20 bg-gray-900 p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Create New User</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text" placeholder="Username" value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
            />
            <input
              type="password" placeholder="Password (min 8 chars)" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
            />
            <select
              value={newRole} onChange={e => setNewRole(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="VIEWER">Viewer — Read only</option>
              <option value="OPERATOR">Operator — Can manage</option>
              <option value="ADMIN">Admin — Full access</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* User list */}
      <div className="space-y-2">
        {users.map(user => {
          const roleConf = ROLE_CONFIG[user.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.VIEWER;
          const isEditing = editingId === user.id;

          return (
            <div key={user.id} className="rounded-lg border border-gray-700 bg-gray-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800 text-sm font-bold text-white uppercase">
                    {user.username.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{user.username}</p>
                    <p className="text-xs text-gray-500">
                      Created {new Date(user.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${roleConf.color}`}>
                      {roleConf.icon}
                      {roleConf.label}
                    </span>
                  )}
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={editRole || user.role}
                        onChange={e => setEditRole(e.target.value)}
                        className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:outline-none"
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="OPERATOR">Operator</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <input
                        type="password" placeholder="New password"
                        value={editPassword} onChange={e => setEditPassword(e.target.value)}
                        className="w-32 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
                      />
                      <button onClick={() => handleUpdate(user.id)} className="text-emerald-400 hover:text-emerald-300">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => { setEditingId(null); setEditRole(""); setEditPassword(""); }} className="text-gray-400 hover:text-white">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditingId(user.id); setEditRole(user.role); }}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
                        title="Edit user"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(user.id)}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-500/10 hover:text-red-400"
                        title="Delete user"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {users.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-12 text-center">
            <Users className="h-10 w-10 text-gray-600 mb-3" />
            <p className="text-sm text-gray-400">No users yet</p>
            <p className="text-xs text-gray-500 mt-1">Create your first user to get started</p>
            <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <ConfirmDialog
          open={!!deleteConfirm}
          title="Delete User"
          message="Are you sure you want to delete this user? This action cannot be undone."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
