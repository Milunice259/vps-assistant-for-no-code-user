"use client";

import { FormEvent, useEffect, useState } from "react";
import { Rocket, Monitor, Server, HelpCircle, FolderSearch, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { FileBrowser } from "@/components/ui/FileBrowser";
import type { ServerInfo } from "@/types";

interface DeployResult {
  id: string;
  detectedStack: string;
  status: string;
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
  const [showBrowser, setShowBrowser] = useState(false);

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
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Guided Deploy Wizard</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            { label: "1. Source", done: Boolean(repoUrl), text: "Paste GitHub URL" },
            { label: "2. Destination", done: deployTarget === "local" || Boolean(selectedServerId), text: "Choose server" },
            { label: "3. Access", done: true, text: "Domain/env optional" },
            { label: "4. Review", done: Boolean(repoUrl) && (deployTarget === "local" || Boolean(selectedServerId)), text: "Press Deploy" },
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
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            onChange={(e) => setRepoUrl(e.target.value)}
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
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div>
            <label className="flex items-center text-sm font-medium text-gray-300 mb-1.5">
              Domain (optional)
              <Tip text="A custom domain to route web traffic to this app. The domain's DNS must already point to your server's IP address." />
            </label>
            <Input
              placeholder="app.example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
        </div>

        {/* Deploy Target Selector */}
        <div className="space-y-2">
          <label className="flex items-center text-sm font-medium text-gray-300">
            Deploy Target
            <Tip text="Choose where to deploy your application — on this server (Local) or on a connected remote server." />
          </label>
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
            <label className="flex items-center text-sm font-medium text-gray-300">
              Target Server
              <Tip text="Select which remote server to deploy this application on. Make sure the server is online and accessible." />
            </label>
            <select
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
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

        {/* Custom Path with File Browser */}
        <div>
          <label className="flex items-center text-sm font-medium text-gray-300 mb-1.5">
            Custom Path (optional)
            <Tip text="The directory on the server where your app will be deployed. Leave empty to use the default location (/opt/apps/)." />
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="/var/www/myapp"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
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
                onSelect={(path) => setCustomPath(path)}
                initialPath="/opt"
              />
            </div>
          )}
        </div>

        {/* Environment Variables */}
        <div className="space-y-2">
          <label className="flex items-center text-sm font-medium text-gray-300">
            Environment Variables (optional)
            <Tip text="Secret configuration values your app needs to run. Enter one KEY=VALUE per line. Example: DATABASE_URL=postgres://..." />
          </label>
          <textarea
            placeholder={"NODE_ENV=production\nDATABASE_URL=postgres://..."}
            value={envVars}
            onChange={(e) => setEnvVars(e.target.value)}
            rows={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
          <p className="text-xs text-gray-500">One per line: KEY=value. Values are stored encrypted and hidden from logs. If you are unsure, leave this empty and add it later.</p>
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
