"use client";

import { FormEvent, useState } from "react";
import type { ServerInfo } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface ServerFormProps {
  server?: ServerInfo;
  onSuccess: () => void;
}

export function ServerForm({ server, onSuccess }: ServerFormProps) {
  const isEdit = !!server;

  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(String(server?.port ?? 22));
  const [username, setUsername] = useState(server?.username ?? "root");
  const [authMethod, setAuthMethod] = useState<"PASSWORD" | "KEY">(
    server?.authMethod ?? "PASSWORD"
  );
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const body = {
      name,
      host,
      port: Number(port),
      username,
      authMethod,
      ...(authMethod === "PASSWORD" ? { password } : { privateKey }),
    };

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

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-lg font-semibold text-white">
        {isEdit ? "Edit Server" : "Add Server"}
      </h3>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          placeholder="My VPS"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Host"
          placeholder="192.168.1.100"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          required
        />
        <Input
          label="Port"
          type="number"
          placeholder="22"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          required
        />
        <Input
          label="Username"
          placeholder="root"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>

      {/* Auth method selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">
          Auth Method
        </label>
        <select
          value={authMethod}
          onChange={(e) => setAuthMethod(e.target.value as "PASSWORD" | "KEY")}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          <option value="PASSWORD">Password</option>
          <option value="KEY">SSH Key</option>
        </select>
      </div>

      {authMethod === "PASSWORD" ? (
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isEdit}
        />
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            Private Key
          </label>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            rows={5}
            required={!isEdit}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={loading}>
          {isEdit ? "Update Server" : "Add Server"}
        </Button>
      </div>
    </form>
  );
}
