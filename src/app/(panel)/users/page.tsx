"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Check, Edit2, Eye, Plus, Shield, Trash2, UserRound, Users, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PASSWORD_POLICY_TEXT } from "@/lib/password-policy";
import { PermissionGate } from "@/components/ui/PermissionGate";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
type ServerAccessMode = "ALL" | "SELECTED";

type User = {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  serverAccessMode: ServerAccessMode;
  serverIds: string[];
  passcodeEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const ROLES: Record<Role, { label: string; desc: string; icon: React.ReactNode; tone: "danger" | "warning" | "info" }> = {
  OWNER: { label: "Owner", desc: "System owner", icon: <Crown className="h-3.5 w-3.5" />, tone: "danger" },
  ADMIN: { label: "Admin", desc: "Global admin", icon: <Shield className="h-3.5 w-3.5" />, tone: "danger" },
  MANAGER: { label: "Manager", desc: "Scoped server control", icon: <Wrench className="h-3.5 w-3.5" />, tone: "warning" },
  OPERATOR: { label: "Operator", desc: "Legacy manager", icon: <Wrench className="h-3.5 w-3.5" />, tone: "warning" },
  VIEWER: { label: "Viewer", desc: "Read only", icon: <Eye className="h-3.5 w-3.5" />, tone: "info" },
};

const blank = { username: "", email: "", displayName: "", password: "", role: "VIEWER" as Role, serverAccessMode: "ALL" as ServerAccessMode, serverIds: [] as string[] };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ displayName: "", email: "", role: "VIEWER" as Role, password: "", isActive: true, serverAccessMode: "ALL" as ServerAccessMode, serverIds: [] as string[] });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.isActive).length,
    admins: users.filter((u) => (u.role === "OWNER" || u.role === "ADMIN") && u.isActive).length,
  }), [users]);
  const visibleUsers = roleFilter ? users.filter((u) => u.role === roleFilter) : users;

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      if (json.success) setUsers(json.data);
      else setError(json.error || "Failed to load users");
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetch("/api/servers").then((r) => r.json()).then((j) => { if (j.success) setServers(j.data); }).catch(() => {});
  }, [fetchUsers]);
  useEffect(() => {
    if (!error && !success) return;
    const t = setTimeout(() => { setError(""); setSuccess(""); }, 4000);
    return () => clearTimeout(t);
  }, [error, success]);

  async function save(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
    setError(""); setSuccess("");
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Request failed");
    await fetchUsers();
    return json.data;
  }

  async function createUser() {
    try {
      await save("/api/users", "POST", form);
      setSuccess(`Created ${form.username}`);
      setForm(blank); setCreate(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to create user"); }
  }

  async function updateUser() {
    if (!editing) return;
    try {
      await save(`/api/users/${editing.id}`, "PUT", editForm);
      setSuccess(`Updated ${editing.username}`);
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update user"); }
  }

  async function savePasscode(user: User, enabled: boolean) {
    try {
      await save(`/api/users/${user.id}/passcode`, "PUT", { enabled, passcode });
      setSuccess(enabled ? `Passcode enabled for ${user.username}` : `Passcode disabled for ${user.username}`);
      setPasscode("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update passcode"); }
  }

  async function deleteUser() {
    if (!deleteId) return;
    try {
      await save(`/api/users/${deleteId}`, "DELETE");
      setSuccess("User deleted");
      setDeleteId(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to delete user"); }
  }

  function startEdit(user: User) {
    setEditing(user);
    setPasscode("");
    setEditForm({ displayName: user.displayName || "", email: user.email || "", role: user.role, password: "", isActive: user.isActive, serverAccessMode: user.serverAccessMode || "ALL", serverIds: user.serverIds || [] });
  }

  if (loading) return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-800/50" />)}</div>;

  return (
    <PermissionGate minimum="ADMIN">
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div>}

      <section className="rounded-2xl border border-gray-700 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-300"><Users className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-semibold text-white">Users & permissions</h2>
              <p className="text-sm text-gray-400">Admin-created accounts only. No public registration.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setCreate((v) => !v)}><Plus className="mr-1 h-4 w-4" />Add user</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Total" value={stats.total} />
          <MiniStat label="Active" value={stats.active} />
          <MiniStat label="Active admins" value={stats.admins} />
        </div>
      </section>

      <section className="space-y-3">
        {roleFilter && (
          <button
            onClick={() => setRoleFilter(null)}
            className="text-xs text-brand-300 hover:text-brand-200"
          >
            Clear filter: {ROLES[roleFilter].label}
          </button>
        )}
        <div className="grid gap-3 lg:grid-cols-3">
        {(Object.keys(ROLES) as Role[]).map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(roleFilter === role ? null : role)}
            className={`rounded-xl border p-4 text-left transition-colors ${roleFilter === role ? "border-brand-500 bg-brand-500/10" : "border-gray-700 bg-gray-900 hover:border-gray-600"}`}
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">{ROLES[role].icon}{ROLES[role].label}</div>
            <p className="text-sm text-gray-400">{ROLES[role].desc}</p>
            <p className="mt-3 text-xs text-gray-500">
              {users.filter((u) => u.role === role).length} users · {users.filter((u) => u.role === role && u.isActive).length} active
            </p>
          </button>
        ))}
        </div>
      </section>

      {create && (
        <section className="rounded-xl border border-brand-500/20 bg-gray-900 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Input label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} placeholder="john" />
            <Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="john@example.com" />
            <Input label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="John Doe" />
            <Input label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="Strong password" />
            <Select label="Role" value={form.role} onChange={(v) => setForm({ ...form, role: v as Role })} />
          </div>
          <ServerAccessForm mode={form.serverAccessMode} ids={form.serverIds} servers={servers} onMode={(v) => setForm({ ...form, serverAccessMode: v })} onIds={(v) => setForm({ ...form, serverIds: v })} />
          <p className="mt-3 text-xs text-gray-500">{PASSWORD_POLICY_TEXT}</p>
          <div className="mt-4 flex gap-2"><Button size="sm" onClick={createUser}>Create</Button><Button size="sm" variant="ghost" onClick={() => setCreate(false)}>Cancel</Button></div>
        </section>
      )}

      <section className="space-y-2">
        {visibleUsers.map((user) => {
          const isEditing = editing?.id === user.id;
          return (
            <div key={user.id} className="rounded-xl border border-gray-700 bg-gray-900 p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-800 text-white"><UserRound className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-white">{user.displayName || user.username}</p>
                      <Badge variant={user.isActive ? "success" : "default"}>{user.isActive ? "Active" : "Disabled"}</Badge>
                      <Badge variant={ROLES[user.role].tone}>{ROLES[user.role].label}</Badge>
                    </div>
                    <p className="text-xs text-gray-500">@{user.username}{user.email ? ` · ${user.email}` : ""} · {user.serverAccessMode === "SELECTED" ? `${user.serverIds.length} servers` : "all servers"} · updated {new Date(user.updatedAt).toLocaleDateString()}</p>
                  </div>
                </div>

                {isEditing ? (
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-end">
                    <Input label="Display" value={editForm.displayName} onChange={(v) => setEditForm({ ...editForm, displayName: v })} />
                    <Input label="Email" type="email" value={editForm.email} onChange={(v) => setEditForm({ ...editForm, email: v })} />
                    <Select label="Role" value={editForm.role} onChange={(v) => setEditForm({ ...editForm, role: v as Role })} />
                    <Input label="New password" type="password" value={editForm.password} onChange={(v) => setEditForm({ ...editForm, password: v })} placeholder="Optional" />
                    <ServerAccessForm mode={editForm.serverAccessMode} ids={editForm.serverIds} servers={servers} onMode={(v) => setEditForm({ ...editForm, serverAccessMode: v })} onIds={(v) => setEditForm({ ...editForm, serverIds: v })} compact />
                    <label className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300">
                      <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} /> Active
                    </label>
                    <div className="md:col-span-2 flex flex-wrap items-end gap-2 rounded-lg border border-gray-700 bg-gray-800 p-2">
                      <Input label={editing?.passcodeEnabled ? "New passcode" : "Passcode"} type="password" value={passcode} onChange={setPasscode} placeholder="4-32 chars" />
                      <Button size="sm" onClick={() => editing && savePasscode(editing, true)}>Enable/update</Button>
                      {editing?.passcodeEnabled && <Button size="sm" variant="ghost" onClick={() => editing && savePasscode(editing, false)}>Disable</Button>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={updateUser} className="rounded p-2 text-emerald-400 hover:bg-emerald-500/10"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditing(null)} className="rounded p-2 text-gray-400 hover:bg-gray-800"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(user)} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-white" title="Edit user"><Edit2 className="h-4 w-4" /></button>
                    <button onClick={() => setDeleteId(user.id)} className="rounded p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-400" title="Delete user"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {deleteId && <ConfirmDialog open title="Delete user" message="Delete this user? This cannot be undone." confirmLabel="Delete" variant="danger" onConfirm={deleteUser} onCancel={() => setDeleteId(null)} />}
    </div>
    </PermissionGate>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-gray-700/60 bg-gray-800/50 px-3 py-2"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-semibold text-white">{value}</p></div>;
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-500">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" /></label>;
}

function Select({ label, value, onChange }: { label: string; value: Role; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-500">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none">{(Object.keys(ROLES) as Role[]).map((role) => <option key={role} value={role}>{ROLES[role].label} — {ROLES[role].desc}</option>)}</select></label>;
}

function ServerAccessForm({ mode, ids, servers, onMode, onIds, compact = false }: { mode: ServerAccessMode; ids: string[]; servers: { id: string; name: string }[]; onMode: (v: ServerAccessMode) => void; onIds: (v: string[]) => void; compact?: boolean }) {
  const toggle = (id: string) => onIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return <div className={compact ? "md:col-span-2" : "mt-3"}>
    <div className="flex flex-wrap gap-3 text-xs text-gray-300">
      <label><input type="radio" checked={mode === "ALL"} onChange={() => onMode("ALL")} /> All servers</label>
      <label><input type="radio" checked={mode === "SELECTED"} onChange={() => onMode("SELECTED")} /> Selected servers</label>
    </div>
    {mode === "SELECTED" && <div className="mt-2 flex flex-wrap gap-2">
      {servers.map((s) => <label key={s.id} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300"><input className="mr-1" type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>)}
      {servers.length === 0 && <span className="text-xs text-gray-500">No remote servers yet.</span>}
    </div>}
  </div>;
}
