"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";

interface Preview { revision: string; confirmation: string; rollbackScope?: string; serverId?: string; pending?: boolean; drift?: boolean; originalDefinitionAvailable?: boolean; kind?: string; }

export function DeploymentLifecycle({ id, serverId, kind, disabled, onBusyChange }: { id: string; serverId: string; kind: "image" | "compose" | "git"; disabled?: boolean; onBusyChange?: (busy: boolean) => boolean | void }) {
  const { safeMode } = useSafeMode();
  const lock = useRef(false);
  const sequence = useRef(0);
  const reading = useRef(false);
  const [working, setWorking] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [action, setAction] = useState("rollback");
  const [image, setImage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [dataCompatibility, setData] = useState("");
  const [schemaCompatibility, setSchema] = useState("");
  const [layerConsent, setLayerConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<{ pending: boolean; containerIds: string[]; retainedContainerIds: string[]; phase: string } | null>(null);
  const endpoint = `/api/deploy/${encodeURIComponent(id)}`;
  function invalidate() { sequence.current++; setPreview(null); setConfirmation(""); setData(""); setSchema(""); setLayerConsent(false); setMessage(""); }
  async function inspectRecovery() {
    if (reading.current || disabled || working || lock.current && !unknown) return;
    reading.current = true; setWorking(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store" }); const json = await response.json();
      if (!response.ok || json.success !== true || json.data?.serverId !== serverId) throw new Error();
      const d = json.data;
      setRecovery({ pending: d.pending === true, containerIds: Array.isArray(d.containerIds) ? d.containerIds.filter((id: unknown) => typeof id === "string") : [], retainedContainerIds: Array.isArray(d.retainedContainerIds) ? d.retainedContainerIds.filter((id: unknown) => typeof id === "string") : [], phase: typeof d.recovery?.phase === "string" ? d.recovery.phase : "not reported" });
      setMessage("Read-only recovery evidence loaded. This does not unlock uncertain operations or prove application health. Inspect these exact containers on the original target; no deletion or automatic recovery was attempted.");
    } catch { setMessage("Recovery evidence unavailable; no mutation or retry was attempted."); }
    finally { reading.current = false; setWorking(false); }
  }
  async function review() {
    if (reading.current || lock.current || disabled) return;
    if (onBusyChange?.(true) === false) return;
    lock.current = true; setWorking(true);
    invalidate(); const current = sequence.current;
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", action, ...(action === "update" ? { image } : {}) }) });
      const json = await res.json();
      if (!res.ok || json.success !== true || typeof json.data?.revision !== "string" || typeof json.data?.confirmation !== "string") throw new Error();
      if (current === sequence.current) setPreview({ revision: json.data.revision, confirmation: json.data.confirmation, rollbackScope: json.data.rollbackScope });
    } catch { setMessage("Preview unavailable. Inspect deployment ownership, drift and access before continuing."); }
    finally { lock.current = false; setWorking(false); onBusyChange?.(false); }
  }
  async function inspect() {
    if (!unknown || reading.current || working) return;
    reading.current = true; setWorking(true);
    try {
      const [detail, target, history] = await Promise.all([fetch(endpoint, { cache: "no-store" }), fetch(`/api/servers/${encodeURIComponent(serverId)}/docker`, { cache: "no-store" }), fetch("/api/deploy", { cache: "no-store" })]);
      const [d, t, h] = await Promise.all([detail.json(), target.json(), history.json()]);
      if (!detail.ok || !target.ok || !history.ok || d.success !== true || t.success !== true || h.success !== true || d.data?.serverId !== serverId || d.data?.pending !== false || d.data?.drift === true || !Array.isArray(d.data?.containerIds) || !d.data.containerIds.length || !Array.isArray(t.data) || !d.data.containerIds.every((cid: string) => t.data.some((c: { id: string }) => c.id === cid)) || !Array.isArray(h.data) || !h.data.some((entry: { id: string; status: string }) => entry.id === id && ["RUNNING", "FAILED", "UNVERIFIED"].includes(entry.status))) throw new Error();
      invalidate(); setUnknown(false); lock.current = false; onBusyChange?.(false);
      setMessage("History and original target inspected. No retry was attempted. Review a fresh preview before another operation; application health is separate.");
    } catch { setMessage("Outcome remains uncertain or pending. Controls stay locked. Read-only inspection can be repeated."); }
    finally { reading.current = false; setWorking(false); }
  }
  async function apply() {
    if (reading.current || lock.current || disabled || safeMode || !layerConsent || !preview || confirmation !== preview.confirmation || (!dataCompatibility || !schemaCompatibility)) return;
    if (onBusyChange?.(true) === false) return;
    lock.current = true; setWorking(true); setMessage("");
    const submitted = preview; setPreview(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "apply", action, ...(action === "update" ? { image } : {}), revision: submitted.revision, confirmation, dataCompatibility, schemaCompatibility, safeModeOff: true, writableLayerLoss: true }) });
      const json = await res.json();
      if (!res.ok || json.success !== true || !json.data) throw new Error();
      // Successful execution still requires exact-target readback; never infer readiness from HTTP success.
      const readback = await fetch(endpoint, { cache: "no-store" }); const checked = await readback.json();
      if (!readback.ok || checked.success !== true || checked.data?.serverId !== serverId || checked.data?.pending !== false || checked.data?.drift === true) throw new Error();
      invalidate(); lock.current = false; onBusyChange?.(false);
      setMessage("Native configuration read back. Check application health. Database, schema and external data were not restored.");
    } catch { setUnknown(true); setMessage("Response lost, rejected or readback unavailable. No automatic retry. Inspect history and the original target before continuing."); }
    finally { reading.current = false; setWorking(false); }
  }
  return <div className="mt-3 space-y-3 border-t border-gray-700 pt-3">
    <p className="text-xs text-gray-400">Lifecycle · {serverId} · {id}. Original definitions are required; legacy or drifted targets fail closed.</p>
    <fieldset disabled={working || unknown || disabled} className="space-y-3">
      <label className="block text-sm">Operation<select aria-label="Lifecycle operation" value={action} onChange={e => { if (lock.current) return; invalidate(); setAction(e.target.value); }} className="ml-2 rounded bg-gray-900 p-2"><option value="rollback">Rollback original configuration</option>{kind === "image" && <><option value="update">Update image</option><option value="recreate">Recreate current configuration</option></>}</select></label>
      {action === "update" && <label className="block text-sm">New image<input aria-label="New image" className="ml-2 rounded bg-gray-900 p-2" value={image} onChange={e => { if (!lock.current) { invalidate(); setImage(e.target.value); } }} /></label>}
      <Button size="sm" variant="secondary" onClick={review} disabled={action === "update" && !image.trim()}>Review operation (read-only)</Button>
      {preview && <div className="space-y-3 text-sm">
        <p>{preview.rollbackScope || "Container configuration and images only; database, schema and external data are not restored."}</p>
        {<>{[["External data compatibility", dataCompatibility, setData], ["Database/schema compatibility", schemaCompatibility, setSchema]].map(([label, value, setter]) => <label className="block" key={String(label)}>{String(label)}<select aria-label={String(label)} value={String(value)} onChange={e => (setter as (value: string) => void)(e.target.value)} className="ml-2 rounded bg-gray-900 p-2"><option value="">Choose explicitly</option><option value="unchanged">Unchanged</option><option value="operator-confirmed">Reviewed and compatible</option></select></label>)}</>}
        <label className="block">Type <strong>{preview.confirmation}</strong><input aria-label="Exact lifecycle confirmation" autoComplete="off" className="block w-full rounded bg-gray-900 p-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        <label className="block"><input type="checkbox" checked={layerConsent} onChange={e => setLayerConsent(e.target.checked)} /> I accept writable-layer loss on replacement; rollback does not restore writable layers or external data.</label>
        <Button size="sm" variant="danger" onClick={apply} disabled={safeMode || !layerConsent || confirmation !== preview.confirmation || (!dataCompatibility || !schemaCompatibility)}>Apply reviewed operation</Button>
      </div>}
    </fieldset>
    <Button size="sm" variant="secondary" onClick={inspectRecovery} disabled={working || disabled}>Inspect retained recovery (read-only)</Button>
    {recovery && <div className="text-xs text-gray-400 break-all"><p>Pending: {recovery.pending ? "yes" : "no"} · Phase: {recovery.phase}</p><p>Current container IDs: {recovery.containerIds.join(", ") || "not reported"}</p><p>Retained container IDs: {recovery.retainedContainerIds.join(", ") || "not reported"}</p><a className="underline" href={serverId === "local" ? "/apps" : `/servers/${encodeURIComponent(serverId)}`}>Inspect original target</a></div>}
    {unknown && <Button size="sm" variant="secondary" onClick={inspect} loading={working}>Check history and original target (read-only)</Button>}
    {safeMode && <p className="text-xs text-amber-400">Safe Mode locks apply. Review remains read-only; apply requires signed Advanced access and Admin permission.</p>}
    {message && <p role="status" className="text-sm text-gray-300">{message}</p>}
  </div>;
}
