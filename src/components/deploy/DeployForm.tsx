"use client";

import { FormEvent, useEffect, useState } from "react";
import { Rocket, Monitor, Server } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import type { ServerInfo } from "@/types";

interface DeployResult {
  id: string;
  detectedStack: string;
  status: string;
}

export function DeployForm() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [domain, setDomain] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [envVars, setEnvVars] = useState("");
  const [deployTarget, setDeployTarget] = useState<"local" | "remote">("local");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);

  // Fetch servers for remote deployment selector
  useEffect(() => {
    fetch("/api/servers")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setServers(json.data || []);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body: Record<string, string> = {
        repoUrl,
        branch: branch || "main",
      };

      if (domain) body.domain = domain;
      if (customPath) body.customPath = customPath;
      if (envVars) body.envVars = envVars;
      if (deployTarget === "remote" && selectedServerId) {
        body.serverId = selectedServerId;
      }

      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Deployment failed");

      setResult(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-lg font-semibold text-white">New Deployment</h2>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <Input
          label="GitHub Repo URL"
          placeholder="https://github.com/user/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Branch"
            placeholder="main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <Input
            label="Domain (optional)"
            placeholder="app.example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>

        {/* Deploy Target Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">Deploy Target</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDeployTarget("local")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
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
              onClick={() => setDeployTarget("remote")}
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
            <label className="text-sm font-medium text-gray-300">Target Server</label>
            <select
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
              required={deployTarget === "remote"}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select a server...</option>
              {servers.map((s) => (
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

        {/* Custom Path */}
        <Input
          label="Custom Path (optional)"
          placeholder="/var/www/myapp"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
        />

        {/* Environment Variables */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            Environment Variables (optional)
          </label>
          <textarea
            placeholder={"NODE_ENV=production\nDATABASE_URL=postgres://..."}
            value={envVars}
            onChange={(e) => setEnvVars(e.target.value)}
            rows={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
          <p className="text-xs text-gray-600">One per line: KEY=value</p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            <Rocket className="h-4 w-4" />
            Deploy
          </Button>
        </div>
      </form>

      {result && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <h3 className="text-sm font-medium text-gray-300">
            Deployment Created
          </h3>
          <div className="mt-2 flex items-center gap-3">
            <Badge variant="info">{result.status}</Badge>
            <span className="text-sm text-gray-400">
              Stack: <strong className="text-white">{result.detectedStack}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
