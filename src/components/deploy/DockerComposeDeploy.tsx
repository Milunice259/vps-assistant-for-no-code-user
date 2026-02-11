"use client";

import { useState, useEffect, useCallback } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse, ServerInfo } from "@/types";

export function DockerComposeDeploy() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverId, setServerId] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [composeContent, setComposeContent] = useState(DEFAULT_COMPOSE);
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
    if (!serverId || !composeContent.trim() || !projectPath.trim()) return;
    setDeploying(true);
    setResult(null);

    try {
      const res = await fetch("/api/deploy/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "compose",
          serverId,
          composeContent: composeContent.trim(),
          projectPath: projectPath.trim(),
          projectName: projectName.trim() || undefined,
        }),
      });

      const json = await res.json();
      setResult({
        success: json.success,
        message: json.success
          ? "Compose stack deployed successfully!"
          : json.error || "Deployment failed",
      });
    } catch {
      setResult({ success: false, message: "Network error" });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

        <Field label="Project Path" required hint="Remote directory">
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="/opt/myproject"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Project Name" hint="Optional">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="my-stack"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="docker-compose.yml" required>
        <textarea
          value={composeContent}
          onChange={(e) => setComposeContent(e.target.value)}
          rows={16}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:border-brand-500 focus:outline-none resize-y"
          spellCheck="false"
        />
      </Field>

      <Button
        variant="primary"
        loading={deploying}
        disabled={!serverId || !composeContent.trim() || !projectPath.trim()}
        onClick={handleDeploy}
      >
        <Play className="h-4 w-4 mr-1" /> Deploy Compose Stack
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

const DEFAULT_COMPOSE = `version: "3.8"

services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
    restart: unless-stopped
`;
