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
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || "");
    setEmail(user.email || "");
    setPasscodeOpen(Boolean(user.passcodeEnabled));
  }, [user]);

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as ThemeMode | null) || "dark";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  async function saveProfile(passwordOnly = false) {
    setSaving(true); setError(""); setMessage("");
    try {
      const body = passwordOnly
        ? { currentPassword, newPassword }
        : { displayName, email };
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Save failed");
      setCurrentPassword(""); setNewPassword("");
      setMessage(passwordOnly ? "Password changed." : "Profile updated.");
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
      setPasscode(""); setPasscodeOpen(enabled);
      setMessage(enabled ? "Passcode enabled/updated." : "Passcode disabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passcode update failed");
      setPasscodeOpen(Boolean(user.passcodeEnabled));
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <div className="text-gray-400">Loading profile...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {(message || error) && <div className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>{error || message}</div>}

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-lg shadow-black/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Account information</h2>
            <p className="mt-1 text-sm text-gray-400">Thông tin cơ bản hiển thị trong hệ thống.</p>
          </div>
          <Button className="w-full sm:w-auto sm:shrink-0" loading={saving} onClick={() => saveProfile(false)}>Save account</Button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-300">Username
            <input disabled value={user.username} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-500" />
          </label>
          <label className="text-sm font-medium text-gray-300">Role
            <input disabled value={user.role} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-500" />
          </label>
          <label className="text-sm font-medium text-gray-300">Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Tên hiển thị" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
          <label className="text-sm font-medium text-gray-300">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-lg shadow-black/10">
        <h2 className="text-lg font-semibold text-white">Security</h2>
        <p className="mt-1 text-sm text-gray-400">Đổi mật khẩu đăng nhập chính và cấu hình passcode mở khóa nhanh.</p>

        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-medium text-white">Change password</h3>
              <p className="mt-1 text-sm text-gray-400">Dùng khi muốn đổi mật khẩu đăng nhập chính. Cần nhập mật khẩu hiện tại để xác nhận.</p>
            </div>
            <Button className="w-full sm:w-auto sm:shrink-0" variant="secondary" loading={saving} onClick={() => saveProfile(true)}>Update password</Button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-300">Current password
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Nhập mật khẩu hiện tại" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
            </label>
            <label className="text-sm font-medium text-gray-300">New password
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nhập mật khẩu mới" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
            </label>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-medium text-white">Quick unlock passcode</h3>
              <p className="mt-1 text-sm text-gray-400">Passcode chỉ dùng để mở khóa nhanh khi session còn sống, không thay thế mật khẩu đăng nhập.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={passcodeOpen}
              onClick={() => user.passcodeEnabled ? savePasscode(false) : setPasscodeOpen((value) => !value)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${passcodeOpen ? "bg-brand-600" : "bg-gray-700"}`}
            >
              <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${passcodeOpen ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${user.passcodeEnabled ? "bg-emerald-400" : "bg-gray-500"}`} />
            <span className="text-gray-400">{user.passcodeEnabled ? "Enabled" : "Disabled"}</span>
          </div>
          {passcodeOpen && (
            <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
              <label className="text-sm font-medium text-gray-300">Passcode
                <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="4-32 ký tự" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" loading={saving} onClick={() => savePasscode(true)}>{user.passcodeEnabled ? "Update passcode" : "Enable passcode"}</Button>
                {!user.passcodeEnabled && <Button variant="ghost" onClick={() => { setPasscodeOpen(false); setPasscode(""); }}>Cancel</Button>}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-lg shadow-black/10">
        <h2 className="text-lg font-semibold text-white">Appearance</h2>
        <p className="mt-1 text-sm text-gray-400">Lưu lựa chọn giao diện cho trình duyệt hiện tại.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["dark", "light", "system"] as ThemeMode[]).map((mode) => (
            <Button key={mode} variant={theme === mode ? "primary" : "secondary"} onClick={() => { setTheme(mode); applyTheme(mode); }}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
