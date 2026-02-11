"use client";

import { useState, useEffect, useCallback } from "react";
import { Server, Box, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse, ServerInfo } from "@/types";

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
        <Field label="Target Server" required>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="">Select server</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Docker Image" required hint="e.g. nginx:latest">
          <input
            type="text"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="nginx:latest"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Container Name" hint="Optional">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Port Mappings" hint="Comma-separated: 8080:80, 443:443">
          <input
            type="text"
            value={ports}
            onChange={(e) => setPorts(e.target.value)}
            placeholder="8080:80"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="CPU Limit (cores)" hint="e.g. 0.5">
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

        <Field label="Memory Limit (MB)" hint="e.g. 512">
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

      <Field label="Restart Policy">
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
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {hint && <span className="text-gray-600 ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
