"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AppDetailInfo, UpdateAppInput, ApiResponse } from "@/types";

interface AppSettingsProps {
  app: AppDetailInfo;
  onSaved: () => void;
}

const RESTART_POLICIES = [
  { value: "", label: "None (do not restart)" },
  { value: "always", label: "Always" },
  { value: "unless-stopped", label: "Unless stopped" },
  { value: "on-failure", label: "On failure" },
];

export function AppSettings({ app, onSaved }: AppSettingsProps) {
  const [form, setForm] = useState<UpdateAppInput>({
    name: app.name,
    domain: app.domain || "",
    cpuLimit: app.cpuLimit,
    memoryLimit: app.memoryLimit,
    storageLimit: app.storageLimit,
    restartPolicy: app.restartPolicy || "",
    healthCheck: app.healthCheck || "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateField<K extends keyof UpdateAppInput>(key: K, value: UpdateAppInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Clean up nullish values
      const payload: UpdateAppInput = { ...form };
      if (payload.cpuLimit === null || payload.cpuLimit === 0) payload.cpuLimit = null;
      if (payload.memoryLimit === null || payload.memoryLimit === 0) payload.memoryLimit = null;
      if (payload.storageLimit === null || payload.storageLimit === 0) payload.storageLimit = null;
      if (payload.restartPolicy === "") payload.restartPolicy = null;
      if (payload.healthCheck === "") payload.healthCheck = null;

      const res = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json: ApiResponse<AppDetailInfo> = await res.json();
      if (json.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        onSaved();
      } else {
        setError(json.error || "Failed to save");
      }
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          Settings saved successfully
        </div>
      )}

      {/* General */}
      <section>
        <h3 className="text-sm font-medium text-gray-300 mb-1">General</h3>
        <p className="text-xs text-gray-500 mb-3">Basic identification for this application.</p>
        <div className="space-y-3">
          <Field label="App Name" hint="Display name used in the dashboard and logs">
            <input
              type="text"
              value={form.name || ""}
              onChange={(e) => updateField("name", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            />
          </Field>
          <Field label="Domain" hint="Custom domain for accessing this app via Traefik reverse proxy">
            <input
              type="text"
              placeholder="e.g., myapp.example.com"
              value={form.domain || ""}
              onChange={(e) => updateField("domain", e.target.value || undefined)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </Field>
        </div>
      </section>

      {/* Resource Limits */}
      <section>
        <h3 className="text-sm font-medium text-gray-300 mb-1">Resource Limits</h3>
        <p className="text-xs text-gray-500 mb-3">Control how much server resources this app can use. Leave empty for unlimited.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="CPU Limit (cores)" hint="0.5 = half a CPU core, 1 = one core. Leave empty for no limit.">
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="Unlimited"
              value={form.cpuLimit ?? ""}
              onChange={(e) =>
                updateField("cpuLimit", e.target.value ? parseFloat(e.target.value) : null)
              }
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </Field>
          <Field label="Memory Limit (MB)" hint="512 = 512 megabytes of RAM. Prevents app from using too much memory.">
            <input
              type="number"
              min="0"
              placeholder="Unlimited"
              value={form.memoryLimit ?? ""}
              onChange={(e) =>
                updateField("memoryLimit", e.target.value ? parseInt(e.target.value) : null)
              }
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </Field>
          <Field label="Storage Limit (MB)" hint="Maximum disk space this container can use.">
            <input
              type="number"
              min="0"
              placeholder="Unlimited"
              value={form.storageLimit ?? ""}
              onChange={(e) =>
                updateField("storageLimit", e.target.value ? parseInt(e.target.value) : null)
              }
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </Field>
        </div>
      </section>

      {/* Container Config */}
      <section>
        <h3 className="text-sm font-medium text-gray-300 mb-1">Container Configuration</h3>
        <p className="text-xs text-gray-500 mb-3">Docker container behavior and health monitoring settings.</p>
        <div className="space-y-3">
          <Field label="Restart Policy" hint="What should Docker do when the container crashes or the server reboots?">
            <select
              value={form.restartPolicy || ""}
              onChange={(e) => updateField("restartPolicy", e.target.value || null)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              {RESTART_POLICIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Health Check Command" hint="A command that Docker runs periodically to check if your app is healthy. If it fails, Docker marks the container as unhealthy.">
            <input
              type="text"
              placeholder="No health check"
              value={form.healthCheck || ""}
              onChange={(e) => updateField("healthCheck", e.target.value || null)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono text-xs focus:border-brand-500 focus:outline-none"
            />
          </Field>
        </div>
      </section>

      {/* Save */}
      <div className="pt-2">
        <Button variant="primary" loading={saving} onClick={handleSave}>
          <Save className="h-4 w-4 mr-1" /> Save Settings
        </Button>
        <p className="text-xs text-gray-600 mt-2">
          Resource limit changes require container recreate to take effect.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        {label}
        {hint && <span className="text-gray-600 ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
