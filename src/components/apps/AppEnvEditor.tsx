"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Check,
  Loader2,
  FileText,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface EnvEntry {
  key: string;
  value: string;
}

interface EnvReadResult {
  vars: Record<string, string>;
  envPath: string | null;
  source: "file" | "not-found";
}

interface EnvSaveResult {
  backed_up: boolean;
  saved: boolean;
  restarted: boolean;
  envPath: string;
}

type SaveStep = "idle" | "saving" | "restarting" | "done" | "error";

interface AppEnvEditorProps {
  appId: string;
}

export function AppEnvEditor({ appId }: AppEnvEditorProps) {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showValues, setShowValues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envPath, setEnvPath] = useState<string | null>(null);
  const [source, setSource] = useState<"file" | "not-found">("not-found");
  const [hasChanges, setHasChanges] = useState(false);
  const [showPathEdit, setShowPathEdit] = useState(false);
  const [customPath, setCustomPath] = useState("");

  // Save & restart flow
  const [saveStep, setSaveStep] = useState<SaveStep>("idle");
  const [saveResult, setSaveResult] = useState<EnvSaveResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Original entries for change detection
  const [originalEntries, setOriginalEntries] = useState<string>("");

  const fetchEnv = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/env`);
      const json: ApiResponse<EnvReadResult> = await res.json();
      if (json.success && json.data) {
        const vars = json.data.vars;
        const parsed = Object.entries(vars).map(([key, value]) => ({
          key,
          value,
        }));
        setEntries(parsed);
        setOriginalEntries(JSON.stringify(parsed));
        setEnvPath(json.data.envPath);
        setSource(json.data.source);
        setHasChanges(false);
      } else {
        setError(json.error || "Failed to load");
      }
    } catch {
      setError("Could not connect to the server");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  // Track changes
  useEffect(() => {
    const current = JSON.stringify(entries);
    setHasChanges(current !== originalEntries);
  }, [entries, originalEntries]);

  // ── Entry mutations ───────────────────────────────────────────────

  const updateEntry = (i: number, field: "key" | "value", val: string) => {
    setEntries((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeEntry = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  };

  // ── Save & Restart ────────────────────────────────────────────────

  const handleSave = async (restart: boolean = true) => {
    // Validate — no empty keys
    const emptyKeys = entries.filter((e) => e.key.trim() === "");
    if (emptyKeys.length > 0) {
      setSaveError("Some variables have empty names. Please fill them in or remove them.");
      return;
    }

    // Check for duplicates
    const keys = entries.map((e) => e.key.trim());
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) {
      setSaveError(`Duplicate variable: ${dupes[0]}`);
      return;
    }

    setSaveStep("saving");
    setSaveError(null);
    setSaveResult(null);

    try {
      const vars: Record<string, string> = {};
      for (const e of entries) {
        if (e.key.trim()) vars[e.key.trim()] = e.value;
      }

      const res = await fetch(`/api/apps/${appId}/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars,
          envPath: envPath || "/app/.env",
          restart,
        }),
      });

      const json: ApiResponse<EnvSaveResult> = await res.json();

      if (!json.success) {
        setSaveStep("error");
        setSaveError(json.error || "Save failed");
        return;
      }

      const result = json.data!;
      setSaveResult(result);

      if (result.saved && restart && result.restarted) {
        setSaveStep("restarting");
        // Brief delay to show restarting state
        await new Promise((r) => setTimeout(r, 1500));
        setSaveStep("done");
      } else if (result.saved) {
        setSaveStep("done");
      } else {
        setSaveStep("error");
        setSaveError("Could not write the file to the container");
      }

      // Update original state
      setOriginalEntries(JSON.stringify(entries));
      setHasChanges(false);
      setSource("file");

      // Auto-clear success after 4s
      setTimeout(() => {
        setSaveStep("idle");
        setSaveResult(null);
      }, 4000);
    } catch {
      setSaveStep("error");
      setSaveError("Could not connect to the server");
    }
  };

  // ── Loading state ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Reading environment file…
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────

  if (error) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          {error}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchEnv}>
          <RotateCcw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* File path info */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-gray-400">
          <FileText className="h-3.5 w-3.5" />
          {source === "file" ? (
            <span>
              Reading from <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">{envPath}</code>
            </span>
          ) : (
            <span className="text-amber-400">
              No .env file found — will create at{" "}
              <code className="bg-gray-800 px-1.5 py-0.5 rounded text-amber-300">{envPath}</code>
            </span>
          )}
          <button
            onClick={() => {
              setShowPathEdit(!showPathEdit);
              setCustomPath(envPath || "/app/.env");
            }}
            className="text-gray-500 hover:text-gray-300 underline underline-offset-2"
          >
            change
          </button>
        </div>
        <button
          onClick={() => setShowValues(!showValues)}
          className="text-gray-500 hover:text-gray-300 flex items-center gap-1"
        >
          {showValues ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          {showValues ? "Hide" : "Show"} values
        </button>
      </div>

      {/* Custom path editor */}
      {showPathEdit && (
        <div className="flex gap-2 items-center">
          <FolderOpen className="h-4 w-4 text-gray-500 shrink-0" />
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/app/.env"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-brand-500 focus:outline-none"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEnvPath(customPath || "/app/.env");
              setShowPathEdit(false);
              fetchEnv(); // re-read from new path
            }}
          >
            Apply
          </Button>
        </div>
      )}

      {/* Variable editor */}
      {entries.length === 0 && source === "not-found" ? (
        <div className="text-center py-10 space-y-3">
          <div className="text-gray-500 text-sm">
            No .env file exists in this container yet.
          </div>
          <Button variant="ghost" size="sm" onClick={addEntry}>
            <Plus className="h-4 w-4 mr-1" /> Create your first variable
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="flex gap-2 items-center group">
              <input
                type="text"
                placeholder="VARIABLE_NAME"
                value={entry.key}
                onChange={(e) => updateEntry(i, "key", e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
              />
              <span className="text-gray-600">=</span>
              <input
                type={showValues ? "text" : "password"}
                placeholder="value"
                value={entry.value}
                onChange={(e) => updateEntry(i, "value", e.target.value)}
                className="flex-[2] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
              />
              <button
                onClick={() => removeEntry(i)}
                className="text-gray-600 hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove variable"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {/* Add button inline */}
          <button
            onClick={addEntry}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 py-2 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add variable
          </button>
        </div>
      )}

      {/* Validation error */}
      {saveError && saveStep !== "saving" && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Save progress indicator */}
      {saveStep !== "idle" && saveStep !== "error" && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-6 text-sm">
            <StepIndicator
              label="Saving"
              state={
                saveStep === "saving"
                  ? "active"
                  : saveStep === "restarting" || saveStep === "done"
                  ? "done"
                  : "pending"
              }
            />
            <div className="h-px w-6 bg-gray-700" />
            <StepIndicator
              label="Restarting"
              state={
                saveStep === "restarting"
                  ? "active"
                  : saveStep === "done"
                  ? saveResult?.restarted
                    ? "done"
                    : "skipped"
                  : "pending"
              }
            />
            <div className="h-px w-6 bg-gray-700" />
            <StepIndicator
              label="Applied"
              state={saveStep === "done" ? "done" : "pending"}
            />
          </div>
          {saveStep === "done" && saveResult?.backed_up && (
            <p className="text-xs text-gray-500 mt-2">
              Previous version backed up to {saveResult.envPath}.bak
            </p>
          )}
        </div>
      )}

      {/* Action bar */}
      {(entries.length > 0 || source === "not-found") && saveStep === "idle" && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
          <p className="text-xs text-gray-600">
            {hasChanges
              ? "You have unsaved changes"
              : source === "file"
              ? "All changes saved"
              : "Add variables and save to create the .env file"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={!hasChanges && source === "file"}
              title="Save without restarting"
            >
              <Save className="h-4 w-4 mr-1" /> Save Only
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSave(true)}
              disabled={!hasChanges && source === "file"}
            >
              <Save className="h-4 w-4 mr-1" /> Save & Restart
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step indicator sub-component ──────────────────────────────────────

function StepIndicator({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done" | "skipped";
}) {
  return (
    <div className="flex items-center gap-2">
      {state === "active" && (
        <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
      )}
      {state === "done" && (
        <div className="h-4 w-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Check className="h-3 w-3 text-emerald-400" />
        </div>
      )}
      {state === "pending" && (
        <div className="h-4 w-4 rounded-full border border-gray-600" />
      )}
      {state === "skipped" && (
        <div className="h-4 w-4 rounded-full bg-gray-700 flex items-center justify-center">
          <span className="text-[10px] text-gray-500">—</span>
        </div>
      )}
      <span
        className={
          state === "active"
            ? "text-brand-400"
            : state === "done"
            ? "text-emerald-400"
            : state === "skipped"
            ? "text-gray-600"
            : "text-gray-500"
        }
      >
        {label}
      </span>
    </div>
  );
}
