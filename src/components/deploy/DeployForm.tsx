"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Rocket, Monitor, Server, HelpCircle, FolderSearch, CheckCircle, ShieldCheck, AlertTriangle } from "lucide-react";
import { useDeployPreflight } from "./useDeployPreflight";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { FileBrowser } from "@/components/ui/FileBrowser";
import { DeployRequirementBanner } from "@/components/deploy/DeployRequirementBanner";
import type { DeployStatus, ServerInfo } from "@/types";

interface DeployResult {
  id: string;
  detectedStack: string;
  status: DeployStatus;
}

/* ── Tooltip wrapper ── */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1 cursor-help">
      <HelpCircle className="h-3.5 w-3.5 text-gray-500 group-hover:text-gray-300 transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-gray-700 px-3 py-2 text-xs text-gray-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

export function DeployForm({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const { safeMode } = useSafeMode();
  const [operation, setOperation] = useState<"analyze" | "deploy">("analyze");
  const execution = operation === "deploy";
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const inspectionRef = useRef(false);
  const submittedAt = useRef(0);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [composeMode, setComposeMode] = useState<"create" | "update">("create");
  const [deploymentId, setDeploymentId] = useState("");
  const [directoryConsent, setDirectoryConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [layerConsent, setLayerConsent] = useState(false);
  const [dataCompatibility, setDataCompatibility] = useState("");
  const [schemaCompatibility, setSchemaCompatibility] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [deployTarget, setDeployTarget] = useState<"local" | "remote">("local");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { checking, preflight, preflightError, runPreflight: checkInputs, invalidate: invalidatePreflight, readyRef, busyRef } = useDeployPreflight();

  // Fetch servers for remote deployment selector
  useEffect(() => {
    fetch("/api/servers")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setServers(json.data || []);
      })
      .catch(() => {});
  }, []);

  function invalidate() { setLayerConsent(false); setReviewed(false); invalidatePreflight(); }
  function gitInput() {
    const serverId = deployTarget === "local" ? "local" : selectedServerId;
    const risks = preflight?.gitPlan?.risks;
    return { type: "git", repoUrl, branch: branch || "main", customPath, serverId,
      composeDeploymentId: composeMode === "update" ? deploymentId : undefined,
      compose: { type: "compose", serverId, projectPath: customPath, composeMode,
        composeDeploymentId: composeMode === "update" ? deploymentId : undefined,
        dataCompatibility: dataCompatibility || undefined, schemaCompatibility: schemaCompatibility || undefined,
        composeConsent: { directory: directoryConsent ? customPath : undefined,
          ...(reviewed && risks ? { builds: risks.builds, foreignBinds: risks.foreignBinds, externalVolumes: risks.externalVolumes, externalNetworks: risks.externalNetworks, recreate: risks.recreate, writableLayerLoss: layerConsent } : {}) } } };
  }
  const runPreflight = () => { setLayerConsent(false); setReviewed(false); return checkInputs(gitInput()); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current || loading || (execution && (!readyRef.current || !reviewed || !preflight?.gitPlan?.risks || (preflight.gitPlan.risks.recreate && !layerConsent) || (composeMode === "update" && (!deploymentId || !dataCompatibility || !schemaCompatibility)) || safeMode || (deployTarget === "remote" && !selectedServerId) || !customPath))) return;
    if (execution) {
      const server = servers.find((item) => item.id === selectedServerId);
      if (!window.confirm(`Deploy ${repoUrl} (${branch || "main"}) to ${deployTarget === "local" ? "Local server" : `${server?.name || selectedServerId} (${server?.host || selectedServerId})`} at ${customPath || "the deploy path"}? This writes project files and creates or updates containers and published ports.`)) return;
    }
    const submittedInput = execution ? gitInput() : null;
    busyRef.current = true;
    onBusyChange?.(true);
    invalidate();
    setLoading(true);
    setError(null);
    setResult(null);
    submittedAt.current = Date.now();
    let unknown = false;

    try {
      const body: Record<string, unknown> = {
        action: operation,
        serverId: deployTarget === "local" ? "local" : selectedServerId,
        safeModeOff: !safeMode,
        repoUrl,
        branch: branch || "main",
      };

      if (execution) {
        Object.assign(body, submittedInput);
        if (preflight?.gitPlan) Object.assign(body, { commitHash: preflight.gitPlan.commitHash, expectedCommit: preflight.gitPlan.expectedCommit, revision: preflight.gitPlan.revision });
        body.serverId = deployTarget === "local" ? "local" : selectedServerId;
      }

      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!json || typeof json.success !== "boolean" || typeof json.data?.id !== "string" || !["ANALYZED", "PREPARED", "RUNNING", "FAILED", "UNVERIFIED"].includes(json.data.status)) throw new Error();
      unknown = execution && (json.data.pending !== false || json.data.uncertain === true);
      if (unknown) setOutcomeUnknown(true);
      setResult(json.data);
      if (unknown) setError("Outcome uncertain or pending. Controls remain locked until read-only history and original-target inspection.");
      if (!res.ok || !json.success) setError(execution ? "Deployment did not confirm readiness. Inspect its history before continuing." : "Analysis failed.");
    } catch {
      unknown = execution;
      if (unknown) setOutcomeUnknown(true);
      setError(execution ? "Outcome unknown: response lost or unreadable. No automatic retry. Check history and the original target before continuing." : "Analysis unavailable.");
    } finally {
      if (!unknown) { busyRef.current = false; onBusyChange?.(false); }
      setLoading(false);
    }
  };

  async function inspectOutcome() {
    if (!outcomeUnknown || loading || inspectionRef.current) return;
    inspectionRef.current = true; setInspecting(true);
    const targetId = deployTarget === "local" ? "local" : selectedServerId;
    try {
      const [hr, tr] = await Promise.all([fetch("/api/deploy", { cache: "no-store" }), fetch(`/api/servers/${encodeURIComponent(targetId)}/docker`, { cache: "no-store" })]);
      const [h, t] = await Promise.all([hr.json(), tr.json()]);
      if (!hr.ok || !tr.ok || h.success !== true || t.success !== true || !Array.isArray(h.data) || !Array.isArray(t.data)) throw new Error();
      const entries = h.data.filter((entry: { id: string; serverId: string; repoUrl: string; branch: string; customPath: string; createdAt: string }) => (entry.serverId || "local") === targetId && entry.repoUrl === repoUrl && entry.branch === (branch || "main") && entry.customPath === customPath && (result ? entry.id === result.id : Date.parse(entry.createdAt) >= submittedAt.current));
      if (entries.length !== 1 || !["RUNNING", "FAILED", "UNVERIFIED", "PREPARED"].includes(entries[0].status)) throw new Error();
      const detailResponse = await fetch(`/api/deploy/${encodeURIComponent(entries[0].id)}`, { cache: "no-store" });
      const detail = await detailResponse.json();
      if (!detailResponse.ok || detail.success !== true || detail.data?.serverId !== targetId || detail.data?.pending !== false || detail.data?.uncertain === true || detail.data?.drift === true || !Array.isArray(detail.data?.containerIds) || !detail.data.containerIds.length || !detail.data.containerIds.every((cid: string) => /^[a-f0-9]{64}$/.test(cid) && t.data.filter((container: { id: string }) => /^[a-f0-9]{12,64}$/.test(container.id) && cid.startsWith(container.id)).length === 1)) throw new Error();
      setResult(entries[0]); invalidate(); busyRef.current = false; setOutcomeUnknown(false); onBusyChange?.(false);
      setError("History and original target inspected. No retry was attempted. Review remaining assets and run fresh pre-flight before another deployment.");
    } catch { setError("History or target is unavailable, ambiguous or still pending. Controls remain locked."); }
    finally { inspectionRef.current = false; setInspecting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">{execution ? "Guided Deploy Wizard" : "Repository analysis"}</h3>
        <div className={`grid gap-2 ${!execution ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
          {[
            { label: "1. Source", done: Boolean(repoUrl), text: "Paste GitHub URL" },
            { label: "2. Destination", done: deployTarget === "local" || Boolean(selectedServerId), text: "Choose server" },
            ...(execution ? [{ label: "3. Pre-flight", done: Boolean(preflight?.ready), text: "Check safety first" }] : []),
            { label: !execution ? "3. Analyze" : "4. Deploy", done: result?.status === "ANALYZED" || result?.status === "RUNNING", text: !execution ? "Detect repository stack" : "Watch deployment logs" },
          ].map((step) => (
            <div key={step.label} className="rounded-lg border border-gray-700 bg-gray-900/70 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-200">
                <CheckCircle className={`h-3.5 w-3.5 ${step.done ? "text-emerald-400" : "text-gray-600"}`} />
                {step.label}
              </div>
              <p className="text-[11px] text-gray-500">{step.text}</p>
            </div>
          ))}
        </div>
        {!execution && <p className="mt-3 text-xs text-gray-400">Clones a temporary copy to detect the stack, then removes it. This does not deploy an application or publish ports.</p>}
      </div>

      <fieldset disabled={loading || outcomeUnknown}>{(deployTarget === "local" || selectedServerId) && (
        <DeployRequirementBanner key={deployTarget === "local" ? "local" : selectedServerId} mode="git" serverId={deployTarget === "local" ? "local" : selectedServerId} />
      )}</fieldset>
      {safeMode && <p role="status" className="text-sm text-amber-400">Safe Mode is on. Package installation and execution are locked; repository analysis remains available.</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={loading || outcomeUnknown} className="space-y-4">
        <label className="block text-sm">Git operation<select aria-label="Git operation" value={operation} onChange={e => { if (!busyRef.current) { invalidate(); setResult(null); setOperation(e.target.value as "analyze" | "deploy"); } }} className="ml-2 rounded bg-gray-900 p-2"><option value="analyze">Analyze repository (no deploy)</option><option value="deploy">Execute deployment</option></select></label>
        {error && (
          <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div>
          <label className="flex items-center text-sm font-medium text-gray-300 mb-1.5">
            GitHub Repo URL
            <Tip text="The HTTPS URL of your Git repository. Example: https://github.com/user/repo" />
          </label>
          <Input
            placeholder="https://github.com/user/repo"
            value={repoUrl}
            onChange={(e) => { if (!busyRef.current) { invalidate(); setRepoUrl(e.target.value); } }}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center text-sm font-medium text-gray-300 mb-1.5">
              Branch
              <Tip text="The Git branch to deploy from. Default is 'main'. You can also use 'master', 'develop', or any other branch name." />
            </label>
            <Input
              placeholder="main"
              value={branch}
              onChange={(e) => { if (!busyRef.current) { invalidate(); setBranch(e.target.value); } }}
            />
          </div>

        </div>

        {/* Deploy Target Selector */}
        <div className="space-y-2">
          <label className="flex items-center text-sm font-medium text-gray-300">
            Target
            <Tip text="Choose Local or Remote independently of analysis or execution." />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { if (busyRef.current) return; setDeployTarget("local"); setResult(null); setError(null); invalidate(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                deployTarget === "local"
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <Monitor className="h-4 w-4" />
              Local server
            </button>
            <button
              type="button"
              onClick={() => { if (busyRef.current) return; setDeployTarget("remote"); setResult(null); setError(null); invalidate(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                deployTarget === "remote"
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <Server className="h-4 w-4" />
              Remote Server
            </button>
          </div>
        </div>

        {/* Remote server selector */}
        {deployTarget === "remote" && (
          <div className="space-y-2">
            <label className="flex items-center text-sm font-medium text-gray-300">
              Target Server
              <Tip text="Select which remote server to deploy this application on. Make sure the server is online and accessible." />
            </label>
            <select
              value={selectedServerId}
              onChange={(e) => { if (!busyRef.current) { invalidate(); setSelectedServerId(e.target.value); } }}
              required={deployTarget === "remote"}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select a server...</option>
              {servers.filter((s) => s.id !== "local").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
            {servers.length === 0 && (
              <p className="text-xs text-gray-500">No servers available. Add one first.</p>
            )}
          </div>
        )}

        {execution && <>
        {/* Custom Path with File Browser */}
        <div>
          <label className="flex items-center text-sm font-medium text-gray-300 mb-1.5">
            Custom Path (required)
            <Tip text="The directory on the selected server where the repository and containers will be deployed." />
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="/var/www/myapp"
              required
              value={customPath}
              onChange={(e) => { if (!busyRef.current) { invalidate(); setCustomPath(e.target.value); } }}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => setShowBrowser(!showBrowser)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
                showBrowser
                  ? "bg-brand-500/10 border-brand-500/30 text-brand-400"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
              }`}
            >
              <FolderSearch className="h-3.5 w-3.5" />
              Browse
            </button>
          </div>
          {showBrowser && (
            <div className="mt-2">
              <FileBrowser
                serverId={deployTarget === "local" ? "local" : selectedServerId}
                mode="pick-directory"
                selectedPath={customPath}
                onSelect={(path) => { if (!busyRef.current) { invalidate(); setCustomPath(path); } }}
                initialPath="/opt"
              />
            </div>
          )}
        </div>

        <label className="block text-sm">Git deployment operation<select aria-label="Git deployment operation" value={composeMode} onChange={e => { if (!busyRef.current) { invalidate(); setComposeMode(e.target.value as "create" | "update"); } }} className="ml-2 rounded bg-gray-900 p-2"><option value="create">Create managed stack</option><option value="update">Update managed Git stack</option></select></label>
        {composeMode === "update" && <>
          <label className="block text-sm">Managed deployment ID<input aria-label="Git managed deployment ID" value={deploymentId} onChange={e => { if (!busyRef.current) { invalidate(); setDeploymentId(e.target.value); } }} className="block w-full rounded bg-gray-900 p-2" /></label>
          {[["External data compatibility", dataCompatibility, setDataCompatibility], ["Database/schema compatibility", schemaCompatibility, setSchemaCompatibility]].map(([label, value, setter]) => <label key={String(label)} className="block text-sm">{String(label)}<select aria-label={String(label)} value={String(value)} onChange={e => { if (!busyRef.current) { invalidate(); (setter as (value: string) => void)(e.target.value); } }} className="ml-2 rounded bg-gray-900 p-2"><option value="">Choose explicitly</option><option value="unchanged">Unchanged</option><option value="operator-confirmed">Reviewed and compatible</option></select></label>)}
        </>}
        <label className="block text-sm"><input type="checkbox" checked={directoryConsent} onChange={e => { if (!busyRef.current) { invalidate(); setDirectoryConsent(e.target.checked); } }} /> I reviewed this exact destination directory (creation requires a new or empty directory).</label>
        <p className="text-xs text-gray-400">The repository Compose definition supplies environment configuration. Domain routing requires a separate reviewed routing operation. Rollback does not restore database, schema or external data.</p>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Safe Deployment Assistant
            </h3>
            <p className="mt-1 text-xs text-gray-400">Final pre-flight: repository, target, disk, memory, Git and Docker. Rollback requires a saved managed definition and explicit review.</p>
          </div>
          <Button type="button" variant="secondary" loading={checking} disabled={loading || (deployTarget === "remote" && !selectedServerId) || !customPath || !repoUrl} onClick={runPreflight}>
            Run pre-flight
          </Button>
        </div>

        {preflight?.gitPlan?.risks && <div className="mt-3 space-y-2 text-sm break-words">
          <p>Commit: {preflight.gitPlan.commitHash} · Managed ID: {preflight.gitPlan.composeDeploymentId || deploymentId || "new stack"}</p>
          <p>Services: {preflight.gitPlan.services?.join(", ") || "not reported"}</p>
          <p>Directory: {preflight.gitPlan.risks.directory} · Recreate: {preflight.gitPlan.risks.recreate ? "yes" : "no"}</p>
          {(["builds", "foreignBinds", "externalVolumes", "externalNetworks"] as const).map(key => <p key={key}>{key}: {preflight.gitPlan!.risks![key].join(", ") || "none"}</p>)}
          {preflight.gitPlan.risks.recreate && <label className="block"><input type="checkbox" checked={layerConsent} onChange={e => { if (!busyRef.current) setLayerConsent(e.target.checked); }} /> I accept writable-layer loss on replacement; rollback does not restore writable layers.</label>}
          <label className="block"><input type="checkbox" checked={reviewed} onChange={e => { if (!busyRef.current) setReviewed(e.target.checked); }} /> I consent to these exact build services, bind paths, external volumes/networks and recreation.</label>
        </div>}
        {preflight && (
          <div className="mt-4 space-y-3">
            <div className={`rounded-lg border px-3 py-2 text-sm ${preflight.ready ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}>
              {preflight.ready ? "Ready to deploy. Review warnings if any." : "Not safe to deploy yet. Fix failed checks first."}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {preflight.checks.map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-700 bg-gray-900/70 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                    {item.status === "pass" ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className={`h-4 w-4 ${item.status === "warn" ? "text-amber-400" : "text-red-400"}`} />}
                    {item.label}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{item.detail}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-950 p-3 text-xs text-gray-400">
              <p className="mb-2 font-medium text-gray-300">After deploy</p>
              <ul className="list-disc space-y-1 pl-4">
                {preflight.nextSteps.map((step) => <li key={step}>{step}</li>)}
                <li>Inspect deployment logs after execution. Use history to review available lifecycle actions; external data/schema are not restored.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
        </>}

        </fieldset>
        {preflightError && <p role="alert" className="text-sm text-red-400">{preflightError}</p>}
        {execution && !preflight?.ready && <p role="status" className="text-sm text-gray-400">Run pre-flight for the current inputs to unlock deployment.</p>}
        {safeMode && execution && <p role="status" className="text-sm text-amber-400">Turn Safe Mode off to deploy on the selected server.</p>}
        <div className="flex justify-end">
          <Button type="submit" loading={loading} disabled={loading || outcomeUnknown || (execution && (!preflight?.ready || !reviewed || !preflight?.gitPlan?.risks || (preflight.gitPlan.risks.recreate && !layerConsent) || (composeMode === "update" && (!deploymentId || !dataCompatibility || !schemaCompatibility)) || checking || safeMode || (deployTarget === "remote" && !selectedServerId) || !customPath))}>
            {!execution ? <FolderSearch className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            {!execution ? "Analyze repository" : "Execute deployment"}
          </Button>
        </div>
      </form>
      {outcomeUnknown && <Button variant="secondary" loading={inspecting} onClick={inspectOutcome}>Check history and original target (read-only)</Button>}

      {result && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <h3 className="text-sm font-medium text-gray-300">
            {result.status === "ANALYZED" ? "Analysis complete" : result.status === "PREPARED" ? "Repository prepared — not deployed" : result.status === "UNVERIFIED" ? "Readiness unverified" : result.status === "RUNNING" ? "Target services running and healthy" : "Deployment failed"}
          </h3>
          {result.status === "ANALYZED" && <p className="mt-1 text-xs text-gray-400">Repository stack detected. Application not deployed.</p>}
          {result.status === "PREPARED" && <p className="mt-1 text-xs text-gray-400">No Compose file found. Files remain on the remote server; manual setup required.</p>}
          {result.status === "UNVERIFIED" && <p className="mt-1 text-xs text-gray-400">Project files were written on the selected target, but application readiness is not confirmed. Check deployment logs before relying on the app.</p>}
          <div className="mt-2 flex items-center gap-3">
            <Badge variant={result.status === "FAILED" ? "danger" : result.status === "UNVERIFIED" ? "warning" : "info"}>{result.status}</Badge>
            <span className="text-sm text-gray-400">
              Stack: <strong className="text-white">{result.detectedStack}</strong>
            </span>
          </div>
          <a className="mt-2 block text-sm underline text-gray-300" href={`/deploy#deployment-${result.id}`}>View log · {result.id}</a>
        </div>
      )}
    </div>
  );
}
