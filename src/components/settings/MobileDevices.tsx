"use client";
import { useCallback, useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Device = {id:string;label:string;serverIds:string[];pairedAt:string|null;pairingExpiresAt:string;tokenExpiresAt:string|null;lastAccessAt:string|null;revokedAt:string|null};
type Server = {id:string;name:string};
const endpoint="/api/mobile/v1/devices";
export function MobileDevices(){
  const [devices,setDevices]=useState<Device[]>([]);
  const [servers,setServers]=useState<Server[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [label,setLabel]=useState("Android phone");
  const [code,setCode]=useState<{code:string;expiresAt:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    try {
      const res=await fetch(endpoint,{cache:"no-store"});
      if(!res.ok) throw new Error("Unable to load mobile devices");
      const data=await res.json() as {devices:Device[];servers:Server[]};
      setDevices(data.devices);setServers(data.servers);
      setSelected(old=>old.filter(id=>data.servers.some(s=>s.id===id)));setLoaded(true);
    } catch {setLoaded(false);setMessage("Unable to load mobile devices. Refresh to retry.");}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!code)return;
    const timer=setTimeout(()=>setCode(null),Math.max(0,Date.parse(code.expiresAt)-Date.now()));
    return ()=>clearTimeout(timer);
  },[code]);
  async function change(method:"POST"|"DELETE",body:unknown){
    if(busy)return;
    setBusy(true);setMessage("");setCode(null);
    try{
      const res=await fetch(endpoint,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Request failed");
      if(method==="POST")setCode({code:data.code,expiresAt:data.expiresAt});
      await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Request failed");}
    finally{setBusy(false);}
  }
  return <section className="space-y-4">
    <div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-brand-400"/><h2 className="text-lg font-semibold text-white">Mobile Devices</h2></div>
    <p className="text-sm text-gray-400">Pair Android monitoring widgets with read-only access to selected servers. Pairing codes expire in 5 minutes. Device access expires in 90 days.</p>
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
      <label className="block text-sm text-gray-300">Device name<input className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 p-2 text-white" value={label} maxLength={60} onChange={e=>setLabel(e.target.value)} /></label>
      <div className="text-sm text-gray-300">Servers</div>
      <div className="max-h-48 overflow-y-auto space-y-2">
        {servers.map(s=><label key={s.id} className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={selected.includes(s.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id))}/>{s.name}</label>)}
      </div>
      <div className="flex flex-wrap gap-2"><Button variant="primary" size="sm" disabled={!loaded||busy||!label.trim()||!selected.length} onClick={()=>void change("POST",{label,serverIds:selected})}>Generate pairing code</Button><Button variant="secondary" size="sm" disabled={busy} onClick={()=>void refresh()}>Refresh</Button></div>
      {code&&<div className="rounded border border-brand-500/40 p-3 space-y-2"><p className="text-xs text-gray-400">One-time code. Copy directly into the Android app; do not share it. Expires {new Date(code.expiresAt).toLocaleTimeString()}.</p><code className="block break-all select-all text-brand-400">{code.code}</code><Button variant="secondary" size="sm" onClick={()=>void navigator.clipboard.writeText(code.code).then(()=>setMessage("Copied")).catch(()=>setMessage("Select and copy the code manually."))}>Copy code</Button><Button variant="ghost" size="sm" onClick={()=>setCode(null)}>Hide</Button></div>}
      {message&&<p role="status" className="text-sm text-gray-300">{message}</p>}
    </div>
    {devices.map(d=><div key={d.id} className="rounded-lg border border-gray-700 p-3 flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm text-white">{d.label}</div><div className="text-xs text-gray-400">{d.revokedAt?"Revoked":d.pairedAt?(Date.parse(d.tokenExpiresAt||"")<=Date.now()?"Expired":"Paired"):(Date.parse(d.pairingExpiresAt)<=Date.now()?"Expired":"Awaiting pairing")} · {d.serverIds.length} selected · Last access: {d.lastAccessAt?new Date(d.lastAccessAt).toLocaleString():"—"}</div></div>{!d.revokedAt&&<Button variant="secondary" size="sm" disabled={busy} onClick={()=>{if(confirm("Revoke this device?"))void change("DELETE",{id:d.id});}}>Revoke</Button>}</div>)}
    {loaded&&!devices.length&&<p className="text-sm text-gray-400">No mobile devices yet.</p>}
  </section>;
}
