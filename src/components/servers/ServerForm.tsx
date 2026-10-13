"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Server, ShieldCheck, Wifi, XCircle } from "lucide-react";
import type { ServerInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ServerFormProps {
  server?: ServerInfo;
  onSuccess: () => void;
}

interface TestResult {
  ok: boolean;
  message: string;
  os?: string;
  docker?: boolean;
  systemd?: boolean;
  fingerprint?: string;
  previousFingerprint?: string | null;
  identityStatus?: "unverified" | "verified" | "changed";
}

const steps = ["Connection", "Review", "Save"];

export function ServerForm({ server, onSuccess }: ServerFormProps) {
  const isEdit = !!server;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(String(server?.port ?? 22));
  const [username, setUsername] = useState(server?.username ?? "root");
  const [authMethod, setAuthMethod] = useState<"PASSWORD" | "KEY">(server?.authMethod ?? "PASSWORD");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [trustedBody, setTrustedBody] = useState<string | null>(null);
  const [testedBody, setTestedBody] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(server?.id ?? null);

  const body = useMemo(() => ({
    name,
    host,
    port: Number(port),
    username,
    authMethod,
    ...(authMethod === "PASSWORD" ? (password ? { password } : {}) : (privateKey ? { privateKey } : {})),
    ...(server ? { serverId: server.id } : {}),
  }), [authMethod, host, name, password, port, privateKey, username, server]);

  const currentTest = testedBody === JSON.stringify(body);
  const confirmed = currentTest && trustedBody === JSON.stringify(body) && !!testResult?.fingerprint;
  const canTest = host && port && username && (isEdit || (authMethod === "PASSWORD" ? password : privateKey));

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    setTrustedBody(null);
    try {
      const unchanged = server && host === server.host && Number(port) === server.port && username === server.username && !password && !privateKey;
      const res = await fetch(unchanged ? `/api/servers/${server.id}/test` : "/api/servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Connection test failed");
      setTestedBody(JSON.stringify(body));
      setTestResult(json.data);
      if (json.data?.fingerprint || json.data?.ok) setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = savedId ? `/api/servers/${savedId}` : "/api/servers";
      const method = savedId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Request failed");
      setSavedId(json.data.id);
      if (confirmed && testResult?.fingerprint) {
        const trustResponse = await fetch(`/api/servers/${json.data.id}/test`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trust: true, fingerprint: testResult.fingerprint, previousFingerprint: testResult.previousFingerprint ?? null }),
        });
        const trustResult = await trustResponse.json();
        if (!trustResponse.ok || !trustResult.success || !trustResult.data?.ok) {
          throw new Error(trustResult.error || trustResult.data?.message || "Server saved but identity is not verified. Open Edit Server and test again.");
        }
      }
      setStep(2);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white">{isEdit ? "Edit Server" : "Add Remote Server"}</h3>
        <p className="mt-1 text-sm text-gray-400">
          Test the SSH identity, verify its fingerprint with your provider, then explicitly trust it. Saved unverified servers cannot connect.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {steps.map((label, index) => (
          <div key={label} className={`rounded-lg border px-3 py-2 text-xs ${index <= step ? "border-brand-500/40 bg-brand-500/10 text-brand-200" : "border-gray-700 bg-gray-900 text-gray-500"}`}>
            {index + 1}. {label}
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Server name" placeholder="Production VPS" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Host / IP" placeholder="203.0.113.10" value={host} onChange={(e) => { setHost(e.target.value); setTestResult(null); }} required />
        <Input label="SSH port" type="number" placeholder="22" value={port} onChange={(e) => { setPort(e.target.value); setTestResult(null); }} required />
        <Input label="SSH username" placeholder="root" value={username} onChange={(e) => { setUsername(e.target.value); setTestResult(null); }} required />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">Auth Method</label>
        <select
          value={authMethod}
          onChange={(e) => { setAuthMethod(e.target.value as "PASSWORD" | "KEY"); setTestResult(null); }}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          <option value="PASSWORD">Password</option>
          <option value="KEY">SSH Key</option>
        </select>
      </div>

      {authMethod === "PASSWORD" ? (
        <Input label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => { setPassword(e.target.value); setTestResult(null); }} required={!isEdit} />
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">Private Key</label>
          <textarea
            value={privateKey}
            onChange={(e) => { setPrivateKey(e.target.value); setTestResult(null); }}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            rows={5}
            required={!isEdit}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      )}

      {testResult && currentTest && (
        <div className={`rounded-xl border p-4 ${testResult.ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
          <div className="flex items-start gap-3">
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" /> : <XCircle className="mt-0.5 h-5 w-5 text-red-300" />}
            <div className="min-w-0 text-sm">
              <p className={testResult.ok ? "text-emerald-200" : "text-red-200"}>{testResult.message}</p>
              {testResult.fingerprint && (
                <div className="mt-3 space-y-3">
                  <p className="font-mono break-all text-xs text-gray-200">{testResult.fingerprint}</p>
                  {testResult.previousFingerprint && testResult.identityStatus === "changed" && <p className="font-mono break-all text-xs text-red-200">Previously trusted: {testResult.previousFingerprint}</p>}
                  <label className="flex items-start gap-3 text-gray-200">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setTrustedBody(e.target.checked ? JSON.stringify(body) : null)} className="mt-1 h-4 w-4" />
                    <span>I verified this fingerprint independently. {testResult.identityStatus === "changed" ? "Replace the previously trusted key." : "Trust this server identity."}</span>
                  </label>
                </div>
              )}
              {testResult.ok && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-300"><Server className="h-4 w-4" /> {testResult.os || "Linux"}</span>
                  <span className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-300"><Wifi className="h-4 w-4" /> Docker {testResult.docker ? "found" : "missing"}</span>
                  <span className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-300"><ShieldCheck className="h-4 w-4" /> systemd {testResult.systemd ? "found" : "missing"}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!canTest || testing || loading} loading={testing} onClick={testConnection}>Test SSH identity</Button>
        <Button type="submit" loading={loading} disabled={testing || (!isEdit && !confirmed)}>{confirmed ? "Save & trust identity" : "Update Server (no new trust)"}</Button>
      </div>
    </form>
  );
}
