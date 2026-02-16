"use client";

import { useState, useEffect, useCallback } from "react";
import { Play, HelpCircle, Monitor, Server } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse, ServerInfo } from "@/types";

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

export function DockerImageDeploy() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverId, setServerId] = useState("");
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [ports, setPorts] = useState(""); // comma-separated like 8080:80,443:443
  const [cpuLimit, setCpuLimit] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("");
  const [restartPolicy, setRestartPolicy] = useState("unless-stopped");
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deployTarget, setDeployTarget] = useState<"local" | "remote">("local");

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      const json: ApiResponse<ServerInfo[]> = await res.json();
      if (json.success && json.data) {
        setServers(json.data);
        if (json.data.length > 0 && !serverId) {
          setServerId(json.data[0].id);
        }
      }
    } catch { /* ok */ }
  }, [serverId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  async function handleDeploy() {
    if (!serverId || !image) return;
    setDeploying(true);
    setResult(null);

    try {
      const portList = ports
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch("/api/deploy/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          serverId,
          image: image.trim(),
          name: name.trim() || undefined,
          ports: portList.length > 0 ? portList : undefined,
          cpuLimit: cpuLimit ? parseFloat(cpuLimit) : undefined,
          memoryLimit: memoryLimit ? parseInt(memoryLimit) : undefined,
          restartPolicy: restartPolicy || undefined,
        }),
      });

      const json = await res.json();
      setResult({
        success: json.success,
        message: json.success
          ? "Container deployed successfully!"
          : json.error || "Deployment failed",
      });
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {result && (
        <div
          className={`text-sm px-3 py-2 rounded-lg border ${
            result.success
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : "text-red-400 bg-red-500/10 border-red-500/20"
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Deploy Target Selector */}
        <Field label="Deploy Target" tooltip="Choose where to deploy this Docker image — on this server (Local) or on a connected remote server.">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setDeployTarget("local"); setServerId("local"); }}
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
              onClick={() => { setDeployTarget("remote"); setServerId(""); }}
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
        <Field label="Target Server" required tooltip="The server where this Docker container will run. Select any connected remote server.">
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
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

        <Field label="Docker Image" required tooltip="The Docker image name and tag to pull. Examples: nginx:latest, postgres:16, node:20-alpine">
          <input
            type="text"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="nginx:latest"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Container Name" tooltip="A friendly name for this container. If left empty, Docker will auto-generate a random name.">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Port Mappings" tooltip="Map host ports to container ports so you can access the app. Format: HOST_PORT:CONTAINER_PORT. Separate multiple with commas. Example: 8080:80, 443:443">
          <input
            type="text"
            value={ports}
            onChange={(e) => setPorts(e.target.value)}
            placeholder="8080:80"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="CPU Limit (cores)" tooltip="Maximum CPU cores this container can use. Example: 0.5 = half a core, 2 = two cores. Leave empty for no limit.">
          <input
            type="number"
            step="0.1"
            min="0"
            value={cpuLimit}
            onChange={(e) => setCpuLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Memory Limit (MB)" tooltip="Maximum memory (RAM) in megabytes this container can use. Example: 512 = 512 MB. Leave empty for no limit.">
          <input
            type="number"
            min="0"
            value={memoryLimit}
            onChange={(e) => setMemoryLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Restart Policy" tooltip="Controls when Docker should auto-restart this container. 'Unless Stopped' is recommended — the container restarts automatically unless you manually stop it.">
        <select
          value={restartPolicy}
          onChange={(e) => setRestartPolicy(e.target.value)}
          className="w-full max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
        >
          <option value="">None</option>
          <option value="always">Always</option>
          <option value="unless-stopped">Unless Stopped</option>
          <option value="on-failure">On Failure</option>
        </select>
      </Field>

      <Button variant="primary" loading={deploying} disabled={!serverId || !image} onClick={handleDeploy}>
        <Play className="h-4 w-4 mr-1" /> Deploy Image
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
