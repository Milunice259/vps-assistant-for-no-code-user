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

  const body = useMemo(() => ({
    name,
    host,
    port: Number(port),
    username,
    authMethod,
    ...(authMethod === "PASSWORD" ? { password } : { privateKey }),
  }), [authMethod, host, name, password, port, privateKey, username]);

  const canTest = host && port && username && (isEdit || (authMethod === "PASSWORD" ? password : privateKey));

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Connection test failed");
      setTestResult(json.data);
      if (json.data?.ok) setStep(1);
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
      const url = isEdit ? `/api/servers/${server.id}` : "/api/servers";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
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
          Test SSH first, detect the server, then save it for monitoring and actions.
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

      {testResult && (
        <div className={`rounded-xl border p-4 ${testResult.ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
          <div className="flex items-start gap-3">
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" /> : <XCircle className="mt-0.5 h-5 w-5 text-red-300" />}
            <div className="min-w-0 text-sm">
              <p className={testResult.ok ? "text-emerald-200" : "text-red-200"}>{testResult.message}</p>
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
        <Button type="button" variant="secondary" disabled={!canTest || testing} loading={testing} onClick={testConnection}>Test SSH & Detect</Button>
        <Button type="submit" loading={loading} disabled={!isEdit && !testResult?.ok}>{isEdit ? "Update Server" : "Save Server"}</Button>
      </div>
    </form>
  );
}
