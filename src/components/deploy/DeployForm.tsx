"use client";

import { FormEvent, useState } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface DeployResult {
  id: string;
  detectedStack: string;
  status: string;
}

export function DeployForm() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl,
          branch: branch || "main",
          ...(domain ? { domain } : {}),
        }),
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
