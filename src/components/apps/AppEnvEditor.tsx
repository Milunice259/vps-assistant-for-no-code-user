"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Check,
  Loader2,
  AlertCircle,
  Search,
  Copy,
  Lock,
  ChevronDown,
  ChevronRight,
  Zap,
  X,
  Tag,
  Play,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";
import type { ApiResponse } from "@/types";

function EnvRecovery({ appId, onReconciled }: { appId: string; onReconciled: () => Promise<unknown> }) {
  const { safeMode } = useSafeMode();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<{token:string;confirmation:string;canReconcile?:boolean;pending?:boolean;count?:number;keys?:string[];kind:"reconcile"|"baseline-import"} | null>(null);
  useEffect(() => { setPreview(null); setMessage(""); setBaseline(""); setConfirmation(""); }, [appId]);
  async function run(action: "inspect" | "baseline-preview" | "reconcile" | "baseline-import") {
    if (inFlight.current || ((action === "reconcile" || action === "baseline-import") && safeMode)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/apps/${appId}/env/recovery`, action === "inspect" ? {} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,env:action.startsWith("baseline")?JSON.parse(baseline):undefined,token:preview?.token,confirmation,safeModeOff:!safeMode})});
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Recovery unavailable");
      if (action === "inspect" || action === "baseline-preview") {
        setConfirmation("");
        setPreview({...json.data,kind:action === "inspect"?"reconcile":"baseline-import"});
        setMessage(action === "inspect" ? json.data.pending ? json.data.canReconcile ? "Original configuration verified. Confirm its current running or stopped state to unlock saved profiles. No container will be changed." : "Recovery still needs operator attention. No container changes or automatic retries were made." : "No operation is pending." : `Original baseline preview: ${json.data.count} entries. Import changes saved recovery data only, not the container.`);
      } else { setPreview(null); setBaseline(""); setMessage("Saved state reconciled. No container was changed."); await onReconciled(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery unavailable"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <details className="border border-gray-700 rounded-lg p-3">
    <summary className="cursor-pointer text-sm">Environment recovery</summary>
    <div className="space-y-3 mt-3">
      <Button disabled={busy} onClick={() => run("inspect")}>Inspect pending operation</Button>
      <label className="block text-sm">Authoritative original Docker Env array (JSON)
        <textarea aria-label="Original environment baseline" value={baseline} onChange={e => {setBaseline(e.target.value);setPreview(null);}} className="block w-full bg-gray-900 border border-gray-700 rounded p-2" />
      </label>
      <p className="text-xs text-gray-400">Use a trusted original deployment or backup. Current overwritten runtime values are not an original baseline.</p>
      <Button disabled={busy || !baseline} onClick={() => run("baseline-preview")}>Preview baseline import</Button>
      {message && <p role="status" className="text-sm break-words">{message}</p>}
      {preview && (preview.kind === "baseline-import" || preview.canReconcile) && <>
        {preview.keys && <p className="text-xs break-words">Keys: {preview.keys.join(", ")}</p>}
        <label className="block text-sm">Type {preview.confirmation}
          <input aria-label="Recovery confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="block w-full bg-gray-900 border border-gray-700 rounded p-2" />
        </label>
        <Button disabled={busy || safeMode || confirmation !== preview.confirmation} onClick={() => run(preview.kind)}>Confirm saved-state reconciliation</Button>
      </>}
    </div>
  </details>;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface EnvEntry { key: string; value: string }

interface ProfileInfo {
  id: string;
  name: string;
  vars: Record<string, string>;
  isActive: boolean;
}

interface EnvReadResult {
  vars: Record<string, string>;
  runtimeVars: Record<string, string>;
  envPath: string | null;
  source: "file" | "not-found";
  profiles: ProfileInfo[];
  activeProfile: ProfileInfo | null;
}

type ActionStep = "idle" | "working" | "done" | "error";

// ─── Component ────────────────────────────────────────────────────────────

export function AppEnvEditor({ appId, appName = appId }: { appId: string; appName?: string }) {
  const { safeMode } = useSafeMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Runtime env
  const [runtimeVars, setRuntimeVars] = useState<Record<string, string>>({});
  const [runtimeSearch, setRuntimeSearch] = useState("");
  const [showRuntimeValues, setShowRuntimeValues] = useState(false);
  const [runtimeExpanded, setRuntimeExpanded] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Profiles
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileInfo | null>(null);
  const [profilesExpanded, setProfilesExpanded] = useState(true);

  // Profile editor
  const [editingProfile, setEditingProfile] = useState<ProfileInfo | null>(null);
  const [editEntries, setEditEntries] = useState<EnvEntry[]>([]);
  const [showEditValues, setShowEditValues] = useState(false);
  const [editDirty, setEditDirty] = useState(false);

  // New profile creation
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  // Action state
  const [actionStep, setActionStep] = useState<ActionStep>("idle");
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const mutationBusy = actionStep === "working" || outcomeUnknown;
  const mutationInFlight = useRef(false);
  async function inspectUnknownOutcome() {
    try {
      const res = await fetch(`/api/apps/${appId}/env/recovery`);
      const json = await res.json();
      if (!res.ok || !json.success || json.data.pending) throw new Error("Operation still pending; use Environment recovery");
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      if (prompt(`Live container: ${json.data.containerId} (${json.data.running ? "running" : "stopped"}). Active profiles: ${json.data.activeProfileNames.join(", ") || "none"}. No mutation was retried. Type CHECKED to accept this inspected outcome.`) !== "CHECKED") return;
      if (!(await fetchEnv())) throw new Error("Profile inspection unavailable");
      setOutcomeUnknown(false);
    } catch { setActionError("Read-only inspection did not resolve the outcome. Mutations remain locked."); }
  }
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Fetch all data ──

  const fetchEnv = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/env`);
      const json: ApiResponse<EnvReadResult> = await res.json();
      if (json.success && json.data) {
        setRuntimeVars(json.data.runtimeVars || {});
        setProfiles(json.data.profiles || []);
        setActiveProfile(json.data.activeProfile || null);
        return true;
      } else {
        setError(json.error || "Failed to load");
      }
    } catch {
      setError("Could not connect to the server");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => { fetchEnv(); }, [fetchEnv]);

  // ── Filtered runtime vars ──

  const filteredRuntime = useMemo(() => {
    const s = runtimeSearch.toLowerCase();
    return Object.entries(runtimeVars)
      .filter(([k, v]) => k.toLowerCase().includes(s) || v.toLowerCase().includes(s))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [runtimeVars, runtimeSearch]);

  // Active profile keys for override detection
  const activeOverrideKeys = useMemo(
    () => new Set(activeProfile ? Object.keys(activeProfile.vars) : []),
    [activeProfile]
  );

  // ── Profile CRUD ──

  const handleCreateProfile = async () => {
    if (safeMode || mutationInFlight.current || mutationBusy) return;
    if (!newProfileName.trim()) return;
    if (!confirm(`Create profile "${newProfileName.trim()}" for ${appName}?\n\nCreates an empty saved override profile only. The running container will not change until you apply it.`)) return;
    mutationInFlight.current = true;
    setOutcomeUnknown(true);
    setActionStep("working");
    setActionMessage("Creating profile…");
    try {
      const res = await fetch(`/api/apps/${appId}/env/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProfileName.trim(), vars: {}, safeModeOff: !safeMode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        mutationInFlight.current = false;
      setActionStep("error");
        setActionError(json.error);
        return;
      }
      setNewProfileName("");
      setShowCreateForm(false);
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      mutationInFlight.current = false;
      setOutcomeUnknown(false);
      setActionStep("idle");
      await fetchEnv();
      // Open for editing immediately
      openProfileEditor(json.data);
    } catch {
      mutationInFlight.current = false;
      setActionStep("error");
      setActionError("Failed to create profile");
    }
  };

  const handleSaveProfile = async (confirmed = false) => {
    if (safeMode || mutationInFlight.current || mutationBusy || !editingProfile) return false;

    // Validate
    const emptyKeys = editEntries.filter((e) => e.key.trim() === "");
    if (emptyKeys.length > 0) {
      setActionError("Some variables have empty names.");
      return false;
    }
    const keys = editEntries.map((e) => e.key.trim());
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) {
      setActionError(`Duplicate variable: ${dupes[0]}`);
      return false;
    }

    if (!confirmed && !confirm(`Save profile "${editingProfile.name}" for ${appName}?\n\nReplaces the saved overrides; omitted keys, including stored secrets, will be removed. Hidden values kept under the same key stay unchanged. ${profiles.some(p => p.id === editingProfile.id && p.isActive) ? "This profile is active: saving recreates the container immediately, causing downtime; writable-layer data may be lost." : "The running container will not change until you apply the profile."}`)) return false;

    mutationInFlight.current = true;
    setOutcomeUnknown(true);
    setActionStep("working");
    setActionMessage("Saving profile…");
    setActionError(null);

    const vars: Record<string, string> = {};
    for (const e of editEntries) {
      if (e.key.trim()) vars[e.key.trim()] = e.value;
    }

    try {
      const res = await fetch(
        `/api/apps/${appId}/env/profiles/${editingProfile.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vars, safeModeOff: !safeMode }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        mutationInFlight.current = false;
      setActionStep("error");
        setActionError(json.error || "Failed to save profile");
        return false;
      }
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return true; }
      setEditingProfile(json.data);
      setEditEntries(Object.entries(json.data.vars as Record<string, string>).map(([key, value]) => ({ key, value })));
      setEditDirty(false);
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      mutationInFlight.current = false;
      setOutcomeUnknown(false);
      setActionStep("done");
      setActionMessage("Profile saved!");
      await fetchEnv();
      return true;
    } catch {
      mutationInFlight.current = false;
      setActionStep("error");
      setActionError("Failed to save");
      return false;
    }
  };

  const handleDeleteProfile = async (profile: ProfileInfo) => {
    if (safeMode || mutationInFlight.current || mutationBusy) return;
    if (!confirm(`Delete profile "${profile.name}" for ${appName}?\n\n${profile.isActive ? "This profile is active. The container will be recreated without its overrides, causing downtime; data in its writable layer may be lost." : "Removes the saved overrides. The running container will not change."}`)) return;
    mutationInFlight.current = true;
    setOutcomeUnknown(true);
    setActionStep("working");
    setActionMessage(
      profile.isActive
        ? "Deleting profile & reverting container…"
        : "Deleting profile…"
    );
    setActionError(null);
    try {
      const res = await fetch(
        `/api/apps/${appId}/env/profiles/${profile.id}`,
        { method: "DELETE", headers: { "X-Safe-Mode-Off": "true" } }
      );
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        mutationInFlight.current = false;
      setActionStep("error");
        setActionError(json.error);
        return;
      }
      if (editingProfile?.id === profile.id) {
        setEditingProfile(null);
        setEditEntries([]);
      }
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      mutationInFlight.current = false;
      setOutcomeUnknown(false);
      setActionStep("done");
      setActionMessage(
        json.data?.reverted
          ? "Profile deleted, container reverted to original env."
          : "Profile deleted."
      );
      await fetchEnv();
      setTimeout(() => setActionStep("idle"), 3000);
    } catch {
      mutationInFlight.current = false;
      setActionStep("error");
      setActionError("Failed to delete");
    }
  };

  const handleApplyProfile = async (profileId: string, saveFirst = false) => {
    if (safeMode || mutationInFlight.current || mutationBusy) return;
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile || !confirm(`${saveFirst && editDirty ? "Save and apply" : "Apply"} profile "${profile.name}" to ${appName}?\n\n${saveFirst && editDirty ? "Replaces the saved overrides; omitted keys, including stored secrets, will be removed. Hidden values kept under the same key stay unchanged. " : ""}Recreates the container with these overrides. The app will be briefly unavailable; data in its writable layer may be lost.`)) return;
    if (saveFirst && editDirty && !(await handleSaveProfile(true))) return;
    mutationInFlight.current = true;
    setOutcomeUnknown(true);
    setActionStep("working");
    setActionMessage("Applying profile… Recreating container with merged env.");
    setActionError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/env/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, safeModeOff: !safeMode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        mutationInFlight.current = false;
      setActionStep("error");
        setActionError(json.error);
        return;
      }
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      mutationInFlight.current = false;
      setOutcomeUnknown(false);
      setActionStep("done");
      setActionMessage(
        `Profile "${json.data?.profileName}" applied! Container recreated with ${json.data?.mergedCount} env vars.`
      );
      await fetchEnv();
      setTimeout(() => setActionStep("idle"), 4000);
    } catch {
      mutationInFlight.current = false;
      setActionStep("error");
      setActionError("Failed to apply profile");
    }
  };

  const handleDeactivate = async () => {
    if (safeMode || mutationInFlight.current || mutationBusy || !activeProfile) return;
    if (!confirm(`Revert profile "${activeProfile.name}" on ${appName}?\n\nRecreates the container without this profile's overrides. The app will be briefly unavailable; data in its writable layer may be lost.`)) return;
    mutationInFlight.current = true;
    setOutcomeUnknown(true);
    setActionStep("working");
    setActionMessage("Deactivating profile… Reverting container to original env.");
    setActionError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/env/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: null, safeModeOff: !safeMode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        mutationInFlight.current = false;
      setActionStep("error");
        setActionError(json.error);
        return;
      }
      if (json.data.newAppId && json.data.newAppId !== appId) { window.location.replace(`/apps/${json.data.newAppId.split("::").map(encodeURIComponent).join("::")}`); return; }
      mutationInFlight.current = false;
      setOutcomeUnknown(false);
      setActionStep("done");
      setActionMessage("Container reverted to original env.");
      await fetchEnv();
      setTimeout(() => setActionStep("idle"), 3000);
    } catch {
      mutationInFlight.current = false;
      setActionStep("error");
      setActionError("Failed to deactivate");
    }
  };

  // ── Profile editor helpers ──

  const openProfileEditor = (profile: ProfileInfo) => {
    setEditingProfile(profile);
    setEditEntries(
      Object.entries(profile.vars).map(([key, value]) => ({ key, value }))
    );
    setEditDirty(false);
    setShowEditValues(false);
    setActionError(null);
  };

  const copyValue = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // ── Loading/Error ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Reading environment…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 space-y-3">
        <EnvRecovery key={appId} appId={appId} onReconciled={fetchEnv} />
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          {error}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchEnv}>
          <RotateCcw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  const runtimeCount = Object.keys(runtimeVars).length;

  // ── Render ──

  return (
    <div className="space-y-5">
      <EnvRecovery key={appId} appId={appId} onReconciled={fetchEnv} />
      {outcomeUnknown && <Button onClick={inspectUnknownOutcome}>Inspect unknown outcome (read-only)</Button>}
      {/* Global action feedback bar */}
      {actionStep !== "idle" && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm ${
            actionStep === "working"
              ? "bg-blue-500/10 border border-blue-500/20 text-blue-400"
              : actionStep === "done"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
          }`}
        >
          {actionStep === "working" && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
          {actionStep === "done" && <Check className="h-4 w-4 shrink-0" />}
          {actionStep === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{actionStep === "error" ? actionError : actionMessage}</span>
          {actionStep === "error" && (
            <button onClick={() => { setActionStep("idle"); setActionError(null); }} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* ═══ Section 1: Runtime Variables (Read-only) ═══ */}
      <section className="border border-gray-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setRuntimeExpanded(!runtimeExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-900/50 hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {runtimeExpanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
            <Lock className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-sm font-medium text-white">Runtime Variables</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{runtimeCount}</span>
            {activeProfile && (
              <span className="text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">
                Profile: {activeProfile.name}
              </span>
            )}
          </div>
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Read-only</span>
        </button>

        {runtimeExpanded && (
          <div className="px-4 pb-4 pt-2 space-y-3">
            <p className="text-xs text-gray-500">
              Current container env. These are set by Docker and include any active override profile.
            </p>

            {runtimeCount === 0 ? (
              <p className="text-xs text-gray-600 py-4 text-center">No runtime environment variables detected.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-600" />
                    <input
                      type="text"
                      placeholder="Filter variables…"
                      value={runtimeSearch}
                      onChange={(e) => setRuntimeSearch(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setShowRuntimeValues(!showRuntimeValues)}
                    className="text-gray-500 hover:text-gray-300 flex items-center gap-1 text-xs shrink-0"
                  >
                    {showRuntimeValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showRuntimeValues ? "Hide" : "Show"}
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-900/80 sticky top-0">
                        <th className="text-left py-2 px-3 text-gray-500 font-medium w-1/3">Variable</th>
                        <th className="text-left py-2 px-3 text-gray-500 font-medium">Value</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {filteredRuntime.map(([key, value]) => (
                        <tr key={key} className="hover:bg-gray-800/30 group">
                          <td className="py-1.5 px-3 font-mono text-gray-300">
                            <div className="flex items-center gap-1.5">
                              {key}
                              {activeOverrideKeys.has(key) && (
                                <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded font-sans">
                                  overridden
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 px-3 font-mono text-gray-400 max-w-0">
                            <div className="truncate">{showRuntimeValues ? value : "••••••••"}</div>
                          </td>
                          <td className="py-1.5 px-1">
                            <button
                              onClick={() => copyValue(key, value)}
                              className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                              title="Copy value"
                            >
                              {copiedKey === key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {runtimeSearch && filteredRuntime.length === 0 && (
                  <p className="text-xs text-gray-600 text-center py-2">No match for &quot;{runtimeSearch}&quot;</p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* ═══ Section 2: Override Profiles ═══ */}
      <section className="border border-gray-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setProfilesExpanded(!profilesExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-900/50 hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {profilesExpanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
            <Zap className="h-3.5 w-3.5 text-brand-400" />
            <span className="text-sm font-medium text-white">Override Profiles</span>
            {profiles.length > 0 && (
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {profiles.length}
              </span>
            )}
          </div>
          <span className="text-[10px] text-brand-400/60 uppercase tracking-wider">{safeMode ? "Read-only" : "Editable"}</span>
        </button>

        {profilesExpanded && (
          <div className="px-4 pb-4 pt-2 space-y-4">
            <p className="text-xs text-gray-500">
              Create env override profiles. When applied, the profile&apos;s values replace runtime vars and the container is
              recreated. Missing values auto-fallback to the original runtime env.
            </p>

            {/* Profile list */}
            {profiles.length === 0 && !showCreateForm ? (
              <div className="text-center py-6 space-y-3">
                <div className="text-gray-500 text-sm">No profiles yet.</div>
                <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(true)} disabled={safeMode || mutationBusy}>
                  <Plus className="h-4 w-4 mr-1" /> Create first profile
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${
                        profile.isActive
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : editingProfile?.id === profile.id
                            ? "border-brand-500/30 bg-brand-500/5"
                            : "border-gray-800 bg-gray-900/30 hover:bg-gray-800/40"
                      } transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-gray-500" />
                        <span className="text-sm font-medium text-white">{profile.name}</span>
                        <span className="text-xs text-gray-600">
                          {Object.keys(profile.vars).length} var{Object.keys(profile.vars).length !== 1 ? "s" : ""}
                        </span>
                        {profile.isActive && (
                          <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openProfileEditor(profile)}
                          disabled={actionStep === "working"}
                          className="text-xs text-gray-500 hover:text-brand-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                        >
                          {safeMode ? "View" : "Edit"}
                        </button>
                        {!profile.isActive ? (
                          <button
                            onClick={() => handleApplyProfile(profile.id)}
                            className="text-xs text-gray-500 hover:text-emerald-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors flex items-center gap-1"
                            disabled={safeMode || mutationBusy}
                          >
                            <Play className="h-3 w-3" /> Apply
                          </button>
                        ) : (
                          <button
                            onClick={handleDeactivate}
                            className="text-xs text-gray-500 hover:text-amber-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors flex items-center gap-1"
                            disabled={safeMode || mutationBusy}
                          >
                            <Power className="h-3 w-3" /> Revert
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteProfile(profile)}
                          aria-label={`Delete profile ${profile.name}`}
                          className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                          disabled={safeMode || mutationBusy}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Create new profile */}
                {!showCreateForm ? (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    disabled={safeMode || mutationBusy}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 py-1 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> New profile
                  </button>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Profile name (e.g. Debug, Staging)"
                      value={newProfileName}
                      disabled={safeMode || mutationBusy}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateProfile()}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
                      autoFocus
                    />
                    <Button variant="primary" size="sm" onClick={handleCreateProfile} disabled={safeMode || mutationBusy || !newProfileName.trim()}>
                      Create
                    </Button>
                    <button onClick={() => { setShowCreateForm(false); setNewProfileName(""); }} className="text-gray-500 hover:text-gray-300 p-1">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ═══ Profile Editor (inline) ═══ */}
            {editingProfile && (
              <div className="border-t border-gray-800 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-white flex items-center gap-2">
                    {safeMode ? "Viewing:" : "Editing:"} <span className="text-brand-400">{editingProfile.name}</span>
                    {editDirty && <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded">unsaved</span>}
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowEditValues(!showEditValues)}
                      className="text-gray-500 hover:text-gray-300 flex items-center gap-1 text-xs"
                    >
                      {showEditValues ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {showEditValues ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => { setEditingProfile(null); setEditEntries([]); }}
                      className="text-gray-500 hover:text-gray-300 p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-gray-600">
                  Only add variables you want to override. Missing variables will use the original runtime values.
                  {" "}Hidden values stay unchanged unless replaced.
                </p>

                {/* Key-Value Editor */}
                <fieldset disabled={safeMode || mutationBusy} className="space-y-3 disabled:opacity-60">
                <div className="space-y-2">
                  {editEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center group">
                      <input
                        type="text"
                        placeholder="VARIABLE_NAME"
                        value={entry.key}
                        onChange={(e) => {
                          const next = [...editEntries];
                          next[i] = { ...next[i], key: e.target.value };
                          setEditEntries(next);
                          setEditDirty(true);
                        }}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
                      />
                      <span className="text-gray-600">=</span>
                      <input
                        type={showEditValues ? "text" : "password"}
                        placeholder="value"
                        value={entry.value}
                        onChange={(e) => {
                          const next = [...editEntries];
                          next[i] = { ...next[i], value: e.target.value };
                          setEditEntries(next);
                          setEditDirty(true);
                        }}
                        className="flex-[2] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:border-brand-500 focus:outline-none"
                      />
                      {entry.key.trim() && runtimeVars[entry.key.trim()] !== undefined && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded shrink-0" title={`Overrides: ${runtimeVars[entry.key.trim()]}`}>
                          override
                        </span>
                      )}
                      <button
                        aria-label={`Remove variable ${entry.key || i + 1}`}
                        onClick={() => {
                          setEditEntries((prev) => prev.filter((_, idx) => idx !== i));
                          setEditDirty(true);
                        }}
                        className="text-gray-600 hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      setEditEntries((prev) => [...prev, { key: "", value: "" }]);
                      setEditDirty(true);
                    }}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 py-2 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add variable
                  </button>
                </div>

                {/* Editor action bar */}
                {actionError && actionStep !== "working" && (
                  <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSaveProfile()}
                    disabled={safeMode || !editDirty || mutationBusy}
                  >
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                  {!editingProfile.isActive && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleApplyProfile(editingProfile.id, true)}
                      disabled={safeMode || mutationBusy}
                    >
                      <Play className="h-4 w-4 mr-1" /> Save & Apply
                    </Button>
                  )}
                </div>
                </fieldset>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
