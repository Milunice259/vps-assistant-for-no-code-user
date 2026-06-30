"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";

type ThemeMode = "dark" | "light" | "system";

function applyTheme(mode: ThemeMode) {
  localStorage.setItem("theme", mode);
  document.documentElement.dataset.theme = mode;
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passcode, setPasscode] = useState("");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || "");
    setEmail(user.email || "");
  }, [user]);

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as ThemeMode | null) || "dark";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  async function saveProfile() {
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Save failed");
      setCurrentPassword(""); setNewPassword(""); setMessage("Profile updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function savePasscode(enabled: boolean) {
    if (!user) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/users/${user.id}/passcode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, passcode: enabled ? passcode : undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Passcode update failed");
      setPasscode(""); setMessage(enabled ? "Passcode enabled/updated." : "Passcode disabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passcode update failed");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <div className="text-gray-400">Loading profile...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {(message || error) && <div className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>{error || message}</div>}

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold text-white">Account</h2>
        <p className="mt-1 text-sm text-gray-400">Personal information for your session.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-300">Username
            <input disabled value={user.username} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-500" />
          </label>
          <label className="text-sm text-gray-300">Role
            <input disabled value={user.role} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-500" />
          </label>
          <label className="text-sm text-gray-300">Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
          <label className="text-sm text-gray-300">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold text-white">Security</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-300">Current password
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
          <label className="text-sm text-gray-300">New password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
        </div>
        <div className="mt-5 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-white">Quick unlock passcode</p>
              <p className="text-sm text-gray-400">Status: {user.passcodeEnabled ? "Enabled" : "Disabled"}</p>
            </div>
            {user.passcodeEnabled && <Button variant="danger" size="sm" loading={saving} onClick={() => savePasscode(false)}>Disable</Button>}
          </div>
          <div className="mt-3 flex gap-2">
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="4-32 chars" className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
            <Button variant="secondary" loading={saving} onClick={() => savePasscode(true)}>Enable/update</Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold text-white">Appearance</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["dark", "light", "system"] as ThemeMode[]).map((mode) => (
            <Button key={mode} variant={theme === mode ? "primary" : "secondary"} onClick={() => { setTheme(mode); applyTheme(mode); }}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Theme preference is saved on this browser.</p>
      </section>

      <Button loading={saving} onClick={saveProfile}>Save profile</Button>
    </div>
  );
}
