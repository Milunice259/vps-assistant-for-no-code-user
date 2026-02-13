"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Eye, EyeOff, Save, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface AppEnvEditorProps {
  appId: string;
}

interface EnvEntry {
  key: string;
  value: string;
}

export function AppEnvEditor({ appId }: AppEnvEditorProps) {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchEnv = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/env`);
      const json: ApiResponse<{ vars: Record<string, string> }> = await res.json();
      if (json.success && json.data) {
        const vars = json.data.vars;
        setEntries(
          Object.entries(vars).map(([key, value]) => ({ key, value }))
        );
      }
    } catch {
      setError("Failed to load environment variables");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  function addEntry() {
    setEntries([...entries, { key: "", value: "" }]);
  }

  function removeEntry(index: number) {
    setEntries(entries.filter((_, i) => i !== index));
  }

  function updateEntry(index: number, field: "key" | "value", val: string) {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: val };
    setEntries(updated);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const vars: Record<string, string> = {};
      for (const e of entries) {
        if (e.key.trim()) {
          vars[e.key.trim()] = e.value;
        }
      }

      const res = await fetch(`/api/apps/${appId}/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });
      const json: ApiResponse = await res.json();
      if (json.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(json.error || "Failed to save");
      }
    } catch {
      setError("Failed to save environment variables");
    } finally {
      setSaving(false);
    }
  }

  async function loadRuntimeEnv() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "env" }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();
      if (json.success && json.data?.output) {
        const parsed: EnvEntry[] = json.data.output
          .split("\n")
          .filter((line: string) => line.includes("=") && !line.startsWith("#"))
          .map((line: string) => {
            const idx = line.indexOf("=");
            return { key: line.slice(0, idx), value: line.slice(idx + 1) };
          })
          .filter((e: EnvEntry) => e.key.trim());
        if (parsed.length > 0) {
          setEntries(parsed);
        } else {
          setError("No environment variables found in the container.");
        }
      } else {
        setError(json.error || "Failed to read runtime environment.");
      }
    } catch {
      setError("Could not connect to the container to read environment variables.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-300">Environment Variables</h3>
          <button
            onClick={() => setShowValues(!showValues)}
            className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1"
          >
            {showValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showValues ? "Hide" : "Show"} values
          </button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={loadRuntimeEnv} title="Load env vars from the running container">
            <Download className="h-4 w-4 mr-1" /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={addEntry}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            onClick={handleSave}
          >
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {success && (
        <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          Environment variables saved successfully
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No environment variables configured.
          <br />
          <span className="text-xs text-gray-600 block mt-1">Click &quot;Import&quot; to load variables from the running container, or add them manually.</span>
          <button onClick={addEntry} className="text-brand-400 hover:underline mt-2 inline-block">
            Add your first variable
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="KEY"
                value={entry.key}
                onChange={(e) => updateEntry(i, "key", e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
              />
              <input
                type={showValues ? "text" : "password"}
                placeholder="value"
                value={entry.value}
                onChange={(e) => updateEntry(i, "value", e.target.value)}
                className="flex-[2] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
              />
              <button
                onClick={() => removeEntry(i)}
                className="text-gray-500 hover:text-red-400 p-2"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600">
        Variables are encrypted at rest. Changes require container restart to take effect.
      </p>
    </div>
  );
}
