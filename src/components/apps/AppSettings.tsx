"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";
import type { AppDetailInfo } from "@/types";
import type { ConfigurationInput, configurationView, previewConfiguration } from "@/lib/app-configuration";

type View = Awaited<ReturnType<typeof configurationView>>;
type Preview = Awaited<ReturnType<typeof previewConfiguration>>;
const inputClass = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white";

export function AppSettings({ app, onSaved }: { app: AppDetailInfo; onSaved: () => void }) {
  const { safeMode } = useSafeMode();
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<ConfigurationInput | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [healthEdit, setHealthEdit] = useState(false);
  const [routingEdit, setRoutingEdit] = useState(false);
  const [portText, setPortText] = useState("");
  const flight = useRef(false);
  const epoch = useRef(0);
  const identity = useRef(app.id);
  identity.current = app.id;
  const current = view?.appId === app.id;

  async function inspect(id = app.id) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(null); setPreview(null); setTyped("");
    const seq = ++epoch.current;
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(id)}/configuration`, { cache: "no-store" });
      const json = await res.json();
      if (identity.current !== id || seq !== epoch.current) return;
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Inspection unavailable");
      const data: View = json.data;
      setView(data); setForm(data.runtime); setPortText(JSON.stringify(data.runtime.ports, null, 2)); setHealthEdit(false); setRoutingEdit(false); setUncertain(false);
    } catch (e) { if (identity.current === id && seq === epoch.current) { setError(e instanceof Error ? e.message : "Inspection unavailable"); setView(null); setForm(null); } }
    finally { if (seq === epoch.current) { flight.current = false; setBusy(false); } }
  }
  useEffect(() => {
    epoch.current++; flight.current = false;
    setView(null); setForm(null); setPreview(null); setTyped(""); setError(null); setResult(null); setUncertain(false);
    void inspect(app.id);
    return () => {
      // Sequence counter, not a DOM ref: invalidate reads from the closed target.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
    };
    // Target identity, not metadata refresh, owns the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);
  function update<K extends keyof ConfigurationInput>(key: K, value: ConfigurationInput[K]) {
    setForm(prev => prev ? { ...prev, [key]: value } : prev); setPreview(null); setTyped(""); setResult(null);
  }
  async function requestPreview(action: "apply" | "adopt") {
    if (flight.current || !current || !form || uncertain || view.pending) return;
    const id = app.id, seq = ++epoch.current;
    flight.current = true; setBusy(true); setError(null); setPreview(null); setTyped("");
    try {
      const settings = action === "adopt" ? view.runtime : { ...form, ports: JSON.parse(portText) };
      if (action === "apply" && !routingEdit) { delete settings.domain; delete settings.routing; }
      const res = await fetch(`/api/apps/${encodeURIComponent(id)}/configuration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", action, revision: view.revision, settings }) });
      const json = await res.json();
      if (id !== identity.current || seq !== epoch.current) return;
      if (!res.ok || !json.success || !json.data?.token) throw new Error(json.error || "Preview unavailable");
      setPreview(json.data);
    } catch (e) { if (id === identity.current && seq === epoch.current) setError(e instanceof Error ? e.message : "Preview unavailable"); }
    finally { if (seq === epoch.current) { flight.current = false; setBusy(false); } }
  }
  async function apply() {
    if (flight.current || safeMode || !current || !preview || typed !== preview.confirmation || uncertain) return;
    const id = app.id, seq = ++epoch.current;
    flight.current = true; setBusy(true); setUncertain(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(id)}/configuration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "apply", token: preview.token, confirmation: typed, safeModeOff: !safeMode }) });
      const json = await res.json();
      if (id !== identity.current || seq !== epoch.current) return;
      if (!res.ok || !json.success || json.data?.verified !== true) throw new Error(json.error || "Outcome not verified");
      setResult(json.data.adopted ? "Inspected runtime adopted. Reload inspection to continue." : `Replacement configuration verified. Readiness: ${json.data.readiness}. Routing: ${json.data.routing?.activeProxy || "unverified"}; TLS: ${json.data.routing?.tls || "unverified"}. Original retained: ${json.data.recoveryContainerId?.slice(0,12)}.`);
      setPreview(null); setTyped("");
      if (json.data.newAppId && json.data.newAppId !== id) router.push(`/apps/${encodeURIComponent(json.data.newAppId)}?tab=settings`);
      onSaved();
    } catch (e) { if (id === identity.current && seq === epoch.current) { setError(`${e instanceof Error ? e.message : "Response lost"}. Reload inspection before another operation; do not retry automatically.`); setPreview(null); } }
    finally { if (seq === epoch.current) { flight.current = false; setBusy(false); } }
  }
  return <div className="max-w-2xl space-y-5">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-gray-200">Docker configuration</h3><Button variant="secondary" disabled={busy} onClick={() => void inspect()}>Reload inspection</Button></div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {result && <p role="status" className="text-sm text-emerald-400 break-words">{result}</p>}
    {!current || !form ? <p className="text-sm text-gray-400">{busy ? "Inspecting this container…" : "Live configuration is unavailable. Reload inspection; saved metadata is not runtime evidence."}</p> : <>
      <p className="text-xs text-gray-400 break-words">{app.serverName} · {view.containerName} · {view.containerId.slice(0,12)} · {view.running ? "Running" : "Stopped"} · {view.adopted ? "Adopted" : "Not adopted"}</p>
      <details className="text-xs text-gray-400"><summary className="cursor-pointer py-2">Runtime vs saved metadata</summary><pre className="whitespace-pre-wrap break-all mt-2">{JSON.stringify({ metadata: view.metadata, saved: view.saved }, null, 2)}</pre><p className="mt-2">Controls below use inspected Docker runtime. Metadata above does not enforce limits.</p></details>
      {view.pending && <p role="alert" className="text-sm text-amber-400">An operation is pending. Use Environment → Recovery inspection before changing this app.</p>}
      {!view.replacementSupported && <p className="text-sm text-amber-400">This runtime uses settings that recoverable replacement cannot preserve safely. Apply is unavailable; the original is unchanged.</p>}
      {uncertain && <p role="status" className="text-sm text-amber-400">Reload inspection before any further operation.</p>}
      <fieldset disabled={busy || uncertain || view.pending || !view.replacementSupported} className="space-y-4 disabled:opacity-60">
        <Field label="Display name"><input className={inputClass} value={form.name} onChange={e => update("name", e.target.value)} /></Field>
        <section className="space-y-3 border-b border-gray-700 pb-4">
          <h4 className="text-sm text-gray-300">Domain and HTTPS · {view.routing.capability}</h4>
          <p className="text-xs text-gray-400 break-words">{view.routing.domain || "No panel-owned domain"} · {view.routing.routeStatus} · TLS: {view.routing.tls}</p>
          <label className="flex gap-2 items-center text-sm min-h-11"><input type="checkbox" checked={routingEdit} disabled={view.routing.capability !== "supported" && !view.routing.owned} onChange={e => { setRoutingEdit(e.target.checked); setPreview(null); setTyped(""); }} />Edit panel-owned domain route</label>
          {routingEdit && <>
            <Field label="Domain (blank removes only the panel-owned route)"><input className={inputClass} placeholder="app.example.com" value={form.domain || ""} onChange={e => { update("domain", e.target.value || null); if (!e.target.value) update("routing", null); }} /></Field>
            <Field label="Existing reverse proxy"><select className={inputClass} value={form.routing?.proxyId || ""} onChange={e => { const p = view.routing.proxies.find(p => p.id === e.target.value); if (p) { update("routing", { proxyId: p.id, backendPort: form.routing?.backendPort || 80, entrypoint: p.entrypoints[0]?.name || "", resolver: null, network: p.networks[0] || "" }); update("networks", Array.from(new Set([...form.networks, p.networks[0]].filter(Boolean)))); } }}><option value="">Select a supported proxy</option>{view.routing.proxies.map(p => <option key={p.id} value={p.id} disabled={!p.supported}>{p.name}{p.supported ? "" : " (unsupported)"}</option>)}</select></Field>
            {form.routing && (() => { const r = form.routing!; const p = view.routing.proxies.find(p => p.id === r.proxyId); return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Backend port"><input type="number" min="1" max="65535" className={inputClass} value={r.backendPort} onChange={e => update("routing", { ...r, backendPort: Number(e.target.value) })} /></Field>
              <Field label="Proxy entrypoint"><select className={inputClass} value={r.entrypoint} onChange={e => update("routing", { ...r, entrypoint: e.target.value })}>{p?.entrypoints.map(e => <option key={e.name} value={e.name}>{e.name} (:{e.port})</option>)}</select></Field>
              <Field label="HTTPS certificate resolver"><select className={inputClass} value={r.resolver || ""} onChange={e => update("routing", { ...r, resolver: e.target.value || null })}><option value="">No TLS requested</option>{p?.resolvers.map(v => <option key={v}>{v}</option>)}</select></Field>
              <Field label="Proxy network"><select className={inputClass} value={r.network} onChange={e => { update("routing", { ...r, network: e.target.value }); update("networks", Array.from(new Set([...form.networks, e.target.value]))); }}>{p?.networks.map(v => <option key={v}>{v}</option>)}</select></Field>
            </div>; })()}
          </>}
          <p className="text-xs text-gray-400">DNS is not changed. Point the domain only at this server before previewing. Native proxy labels and network are verified after apply. TLS is checked read-only against this server's published proxy port with trusted CA, DNS SAN and certificate dates; backend readiness is separate. Reload inspection to repeat the check while issuance is pending.</p>
          {view.routing.capability !== "supported" && <p className="text-xs text-amber-400">No supported Traefik Docker proxy discovered. Existing foreign routes and assets are preserved; this editor does not install or replace a proxy.</p>}
        </section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="CPU limit (cores)"><input type="number" min="0.001" step="0.001" className={inputClass} placeholder="Unlimited" value={form.cpuLimit ?? ""} onChange={e => update("cpuLimit", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Memory limit (MiB)"><input type="number" min="6" step="1" className={inputClass} placeholder="Unlimited" value={form.memoryLimit ?? ""} onChange={e => update("memoryLimit", e.target.value ? Number(e.target.value) : null)} /></Field>
        </div>
        <Field label="Restart policy"><select className={inputClass} value={form.restartPolicy} onChange={e => { update("restartPolicy", e.target.value as ConfigurationInput["restartPolicy"]); update("maximumRetryCount", 0); }}>{["no", "always", "unless-stopped", "on-failure"].map(p => <option key={p}>{p}</option>)}</select></Field>
        {form.restartPolicy === "on-failure" && <Field label="Maximum retries (0 means unlimited)"><input type="number" min="0" className={inputClass} value={form.maximumRetryCount} onChange={e => update("maximumRetryCount", Number(e.target.value))} /></Field>}
        <section className="space-y-2"><h4 className="text-sm text-gray-300">Health check · {view.health.status}</h4><pre className="text-xs text-gray-400 whitespace-pre-wrap break-all">{JSON.stringify({ configured: view.health.configured, type: view.health.type, intervalNs: view.health.intervalNs, timeoutNs: view.health.timeoutNs, retries: view.health.retries }, null, 2)}</pre><label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" checked={healthEdit} onChange={e => { setHealthEdit(e.target.checked); update("healthCheck", e.target.checked ? null : undefined); }} />Replace health check command</label>{healthEdit && <Field label="Health command (blank disables check)"><input className={inputClass} value={form.healthCheck || ""} onChange={e => update("healthCheck", e.target.value || null)} /></Field>}</section>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Log driver"><select className={inputClass} value={form.logDriver} onChange={e => { update("logDriver", e.target.value); update("logMaxSize", ""); update("logMaxFiles", null); }}>{Array.from(new Set([form.logDriver, ...view.logDrivers.filter(d => ["json-file", "local", "none"].includes(d))])).map(d => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Max log size (e.g. 10m)"><input disabled={!["json-file", "local"].includes(form.logDriver)} className={inputClass} placeholder="Driver default" value={form.logMaxSize} onChange={e => update("logMaxSize", e.target.value)} /></Field>
          <Field label="Max log files"><input disabled={!["json-file", "local"].includes(form.logDriver)} type="number" min="1" className={inputClass} placeholder="Driver default" value={form.logMaxFiles ?? ""} onChange={e => update("logMaxFiles", e.target.value ? Number(e.target.value) : null)} /></Field>
        </div>
        <details><summary className="text-sm cursor-pointer py-3">Advanced: ports and networks</summary><div className="space-y-3 mt-2"><Field label="Published ports (JSON array)"><textarea rows={7} className={`${inputClass} font-mono text-xs`} value={portText} onChange={e => { setPortText(e.target.value); setPreview(null); setTyped(""); }} /><span className="text-xs text-gray-400">Each entry: hostIp, hostPort, containerPort, protocol (tcp or udp). Empty hostIp publishes on all interfaces.</span></Field><fieldset><legend className="text-sm text-gray-300">Bridge networks</legend>{Array.from(new Set([...form.networks, ...view.availableNetworks])).map(n => <label key={n} className="flex gap-2 items-center text-sm min-h-11 break-all"><input type="checkbox" checked={form.networks.includes(n)} onChange={e => update("networks", e.target.checked ? [...form.networks, n] : form.networks.filter(v => v !== n))} />{n}</label>)}</fieldset></div></details>
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={() => void requestPreview("apply")}>Preview changes</Button>{!view.adopted && <Button variant="secondary" disabled={busy} onClick={() => void requestPreview("adopt")}>Preview adoption</Button>}</div>
      </fieldset>
      <details className="text-xs text-gray-400"><summary className="py-2 cursor-pointer">Storage quota capability</summary><p>{view.storage.driver} · {view.storage.backingFilesystem} · {view.storage.capability}</p><p className="mt-1">{view.storage.reason}</p>{view.storage.configuredSize && <p>Inspected writable-layer size: {view.storage.configuredSize}</p>}</details>

      {preview && <section className="border-t border-gray-700 pt-4 space-y-3"><h4 className="text-sm text-gray-200">Confirm {preview.action === "adopt" ? "adoption" : "replacement"}</h4><p className="text-xs text-gray-400">{preview.impact}</p><p className="text-xs text-gray-400">Changed fields: {preview.changes.join(", ") || "none"}</p><Field label={`Type ${preview.confirmation}`}><input className={inputClass} autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} /></Field><Button variant="danger" disabled={safeMode || busy || uncertain || typed !== preview.confirmation} onClick={() => void apply()}>Apply {preview.action === "adopt" ? "adoption" : "configuration"}</Button>{safeMode && <p className="text-xs text-amber-400">Turn Safe Mode off before applying.</p>}</section>}
    </>}
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="block text-xs text-gray-400">{label}</span>{children}</label>;
}
