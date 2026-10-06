"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, Server, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { can } from "@/lib/permissions";

export function OnboardingWizard() {
  const { user, loading } = useAuth();
  const [dismissed, setDismissed] = useState(true);
  const [checks, setChecks] = useState<Record<string, boolean | null>>({});
  const [checkedActor, setCheckedActor] = useState("");
  const actor = user?.id || "";
  const admin = can(user?.role, "ADMIN");
  const operator = can(user?.role, "OPERATOR");
  const dismissalKey = `vps-onboarding-dismissed-v3:${actor}`;

  useEffect(() => {
    if (loading || !actor || !admin) return;
    let cancelled = false;
    const wasDismissed = localStorage.getItem(dismissalKey) === "1";
    const read = async (url: string, evaluate: (data: unknown) => boolean) => {
      try {
        const response = await fetch(url);
        const json = await response.json();
        return response.ok && json.success ? evaluate(json.data) : null;
      } catch { return null; }
    };
    Promise.all([
      read("/api/servers", data => Array.isArray(data) && data.some(server => server.id !== "local" && server.isActive)),
      read("/api/notifications", data => Array.isArray(data) && data.some(channel => channel.enabled && channel.alertRules?.some((rule: { enabled: boolean }) => rule.enabled))),
    ]).then(([remote, notifications]) => {
      if (cancelled) return;
      setDismissed(wasDismissed);
      setChecks({ remote, notifications });
      setCheckedActor(actor);
    });
    return () => { cancelled = true; };
  }, [loading, actor, admin, dismissalKey]);

  if (loading || !user || !operator) return null;
  // ponytail: no persisted deploy-check achievement; every operation checks its current inputs.
  if (!admin) return <Link href="/deploy" className="text-sm text-brand-400 hover:text-brand-300">Prepare a deployment</Link>;
  if (dismissed || checkedActor !== actor) return null;
  const steps = [
    { id: "remote", title: "Connect a remote server", text: "Optional for local-only use. Test the connection on the Servers page.", icon: Server, href: "/servers", action: "Open servers" },
    { id: "notifications", title: "Configure notification alerts", text: "An enabled channel and rule confirm configuration, not delivery.", icon: Bell, href: "/settings", action: "Open settings" },
  ];
  return <section className="relative rounded-xl border border-gray-700 bg-gray-800/40 p-4">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-semibold text-white">Optional setup</h2>
      <button aria-label="Dismiss optional setup" className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-white" onClick={() => { localStorage.setItem(dismissalKey, "1"); setDismissed(true); }}><X className="h-4 w-4" /></button>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{steps.map(step => <div key={step.id}>
      <div className="flex items-center gap-2 text-sm font-medium text-white">{checks[step.id] ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <step.icon className="h-4 w-4 text-gray-400" />}{step.title}</div>
      <p className="my-2 text-xs text-gray-400">{checks[step.id] === null ? "Could not check configuration. Open the page to retry." : step.text}</p>
      <Link href={step.href} className="inline-flex min-h-11 items-center text-sm text-brand-400 hover:text-brand-300">{step.action}</Link>
    </div>)}</div>
    <Link href="/deploy" className="mt-4 inline-flex min-h-11 items-center text-sm text-brand-400 hover:text-brand-300">Prepare a deployment</Link>
  </section>;
}
