"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, HelpCircle, FolderSearch, Monitor, Server } from "lucide-react";
import { useDeployPreflight } from "./useDeployPreflight";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";
import { FileBrowser } from "@/components/ui/FileBrowser";
import { DeployRequirementBanner } from "@/components/deploy/DeployRequirementBanner";
import type { ApiResponse, ServerInfo, ContainerInfo, DeploymentInfo } from "@/types";

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

export function DockerComposeDeploy({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const { safeMode } = useSafeMode();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverId, setServerId] = useState("local");
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [composeContent, setComposeContent] = useState(DEFAULT_COMPOSE);
  const [deploying, setDeploying] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const inspectionRef = useRef(false);
  const submittedAt = useRef(0);
  const [inspection, setInspection] = useState<{ logs: DeploymentInfo[]; containers: ContainerInfo[] } | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; id?: string } | null>(null);
  const { checking, preflight, preflightError, runPreflight, invalidate, readyRef, busyRef } = useDeployPreflight();
  const [showBrowser, setShowBrowser] = useState(false);
  const [deployTarget, setDeployTarget] = useState<"local" | "remote">("local");

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      const json: ApiResponse<ServerInfo[]> = await res.json();
      if (json.success && json.data) {
        setServers(json.data);
      }
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const selectedServer = servers.find((s) => s.id === serverId);

  async function inspectOutcome() {
    if (!busyRef.current || inspectionRef.current || deploying) return;
    inspectionRef.current = true;
    setInspecting(true);
    try {
      const historyResponse = await fetch("/api/deploy", { cache: "no-store" });
      const history: ApiResponse<DeploymentInfo[]> = await historyResponse.json();
      const targetResponse = await fetch(`/api/servers/${encodeURIComponent(serverId)}/docker`, { cache: "no-store" });
      const target: ApiResponse<ContainerInfo[]> = await targetResponse.json();
      if (!historyResponse.ok || history.success !== true || !Array.isArray(history.data) || !targetResponse.ok || target.success !== true || !Array.isArray(target.data) || target.data.some(container => !container || typeof container.id !== "string" || typeof container.name !== "string" || typeof container.image !== "string" || typeof container.state !== "string")) throw new Error("Inspection unavailable");
      const logs = history.data.filter(log => log && typeof log.id === "string" && (log.serverId || "local") === serverId && log.repoUrl === `compose://${projectPath.trim()}` && Date.parse(log.createdAt) >= submittedAt.current);
      setInspection({ logs, containers: target.data });
      // Empty inventory is not proof of absence: existing container readers can swallow host errors.
      if (!logs.length || logs.some(log => !["RUNNING", "FAILED", "UNVERIFIED"].includes(log.status))) throw new Error("No terminal history evidence");
      invalidate();
      setOutcomeUnknown(false);
      busyRef.current = false;
      onBusyChange?.(false);
      setResult({ success: false, message: "Outcome unknown for the submitted request. History and target checked; possible partial assets are shown below. Inspect them before any new deployment, which requires a new pre-flight and may duplicate containers. No automatic retry was attempted." });
    } catch {
      setResult({ success: false, message: "Outcome unknown. History/target inspection is unavailable or the request has no terminal history yet. Partial files, images or containers may remain. Controls stay locked; check again before any retry." });
    } finally { inspectionRef.current = false; setInspecting(false); }
  }

  async function handleDeploy() {
    if (busyRef.current || !readyRef.current || safeMode || deploying || !serverId || !composeContent.trim() || !projectPath.trim()) return;
    const targetLabel = serverId === "local" ? "Local server" : `${selectedServer?.name || serverId} (${selectedServer?.host || serverId})`;
    if (!window.confirm(`Deploy Compose stack to ${targetLabel} at ${projectPath.trim()}? This writes docker-compose.yml and creates a new stack and publishes ports. Partial files/containers remain on failure; automatic rollback is unavailable.`)) return;
    busyRef.current = true;
    onBusyChange?.(true);
    invalidate();
    setDeploying(true);
    setResult(null);
    setInspection(null);
    submittedAt.current = Date.now();
    let unknown = false;

    try {
      const res = await fetch("/api/deploy/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "compose",
          serverId,
          safeModeOff: !safeMode,
          composeContent: composeContent.trim(),
          projectPath: projectPath.trim(),
          projectName: projectName.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!json || typeof json.success !== "boolean" || typeof json.data?.id !== "string" || !json.data.id || !["RUNNING", "FAILED", "UNVERIFIED"].includes(json.data.status) || json.success !== (json.data.status === "RUNNING") || (!res.ok && json.data.status !== "FAILED")) throw new Error("Ambiguous response");
      setResult({
        success: json.success,
        message: json.data?.status === "RUNNING" ? "Running and healthy" : `${json.data?.status || "FAILED"}: ${json.error || "Readiness unverified"}`,
        id: json.data?.id,
      });
    } catch {
      unknown = true;
      setOutcomeUnknown(true);
      setResult({ success: false, message: "Outcome unknown: the deployment response was lost or unreadable. Partial files, images or containers may remain on this target. No automatic retry; check history and target before another deployment." });
    } finally {
      if (!unknown) { busyRef.current = false; onBusyChange?.(false); }
      setDeploying(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <fieldset disabled={deploying || outcomeUnknown}>
      {(deployTarget === "local" || serverId) && (
        <DeployRequirementBanner key={deployTarget === "local" ? "local" : serverId} mode="compose" serverId={deployTarget === "local" ? "local" : serverId} />
      )}
      </fieldset>

      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-3 text-sm text-gray-300">
        <span className="text-gray-500">Target server:</span>{" "}
        <span className="font-medium text-white">
          {deployTarget === "local" ? "Local Server" : selectedServer ? `${selectedServer.name} (${selectedServer.host})` : "Select a remote server"}
        </span>
      </div>

      {result && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            result.success
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : "text-red-400 bg-red-500/10 border-red-500/20"
          }`}
        >
          {result.message}
          {result.id && <a className="block underline" href={`/deploy#deployment-${result.id}`}>View deployment log · {result.id}</a>}
        </div>
      )}

      {outcomeUnknown && <Button variant="secondary" loading={inspecting} disabled={deploying || inspecting} onClick={inspectOutcome}>Check history and target (read-only)</Button>}
      {inspection && <div role="status" className="text-sm text-gray-400 space-y-1">
        <p>Possible assets on this target; this list does not prove ownership, absence or readiness.</p>
        {inspection.logs.map(log => <a key={log.id} className="block underline" href={`/deploy#deployment-${log.id}`}>{log.id} · {log.status}</a>)}
        {inspection.containers.map(container => <p key={container.id}>{container.name || container.id} · {container.image} · {container.state}</p>)}
      </div>}
      <fieldset disabled={deploying || outcomeUnknown} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Deploy Target Selector */}
        <Field label="Deploy Target" tooltip="Choose where to deploy this compose stack — on this server (Local) or on a connected remote server.">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { if (busyRef.current) return; invalidate(); setResult(null); setDeployTarget("local"); setServerId("local"); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                deployTarget === "local"
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <Monitor className="h-4 w-4" />
              Local
            </button>
            <button
              type="button"
              onClick={() => { if (busyRef.current) return; invalidate(); setResult(null); setDeployTarget("remote"); setServerId(""); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                deployTarget === "remote"
                  ? "border-brand-500 bg-brand-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <Server className="h-4 w-4" />
              Remote Server
            </button>
          </div>
        </Field>

        {deployTarget === "remote" && (
        <Field label="Target Server" required tooltip="The server where this compose stack will be deployed and run.">
          <select
            value={serverId}
            onChange={(e) => { if (!busyRef.current) { invalidate(); setServerId(e.target.value); } }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="">Select server</option>
            {servers.filter((s) => s.id !== "local").map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
        </Field>
        )}

        <Field label="Project Name" tooltip="An optional name for this Docker Compose project. Used to group containers together. If empty, the directory name is used.">
          <input
            type="text"
            value={projectName}
            onChange={(e) => { if (!busyRef.current) { invalidate(); setProjectName(e.target.value); } }}
            placeholder="my-stack"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>
      </div>

      {/* Project Path with File Browser */}
      <div className="space-y-2">
        <Field label="Project Path" required tooltip="The directory on the server where the docker-compose.yml file will be saved.">
          <div className="flex gap-2">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => { if (!busyRef.current) { invalidate(); setProjectPath(e.target.value); } }}
              placeholder="/opt/myproject"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none font-mono"
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
        </Field>

        {showBrowser && serverId && (
          <FileBrowser
            serverId={serverId}
            mode="pick-directory"
            selectedPath={projectPath}
            onSelect={(path) => { if (!busyRef.current) { invalidate(); setProjectPath(path); } }}
            initialPath="/opt"
          />
        )}
        {showBrowser && !serverId && (
          <p className="text-xs text-yellow-400">Select a server first to browse its file system.</p>
        )}
      </div>

      <p className="text-xs text-gray-400">Fresh image-based stacks only. Existing directories/projects, builds, bind mounts and external volumes/networks are not supported. A Docker health check is required to confirm readiness.</p>
      <Field label="docker-compose.yml" required tooltip="The YAML configuration that defines your multi-container application. Edit the template below or paste your own compose file.">
        <textarea
          value={composeContent}
          onChange={(e) => { if (!busyRef.current) { invalidate(); setComposeContent(e.target.value); } }}
          rows={16}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-y"
          spellCheck="false"
        />
      </Field>

      </fieldset>
      <Button variant="secondary" loading={checking} disabled={deploying || outcomeUnknown || !serverId || !projectPath.trim()} onClick={() => runPreflight({ type: "compose", serverId, composeContent: composeContent.trim(), projectPath: projectPath.trim(), projectName: projectName.trim() || undefined })}>Run pre-flight</Button>
      <p role="status" className="text-sm text-gray-400">{preflightError || (preflight?.ready ? "Current inputs checked. Deploy creates a new directory and stack; partial assets remain on failure." : preflight ? preflight.checks.map(c => c.detail).join(" ") : "Use a new destination and project. Run pre-flight before deploying.")}</p>
      {safeMode && <p role="status" className="text-sm text-amber-400">Safe Mode is on. Turn it off to deploy containers on the selected server. Requirement checks remain available.</p>}
      <Button
        variant="primary"
        loading={deploying}
        disabled={!preflight?.ready || checking || safeMode || deploying || outcomeUnknown || !serverId || !composeContent.trim() || !projectPath.trim()}
        onClick={handleDeploy}
      >
        <Play className="h-4 w-4 mr-1" /> Deploy Compose Stack
      </Button>
    </div>
  );
}

function Field({
  label,
  tooltip,
  required,
  children,
}: {
  label: string;
  tooltip?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center text-xs text-gray-400 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {tooltip && <Tip text={tooltip} />}
      </label>
      {children}
    </div>
  );
}

const DEFAULT_COMPOSE = `version: "3.8"

services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
    restart: unless-stopped
`;
