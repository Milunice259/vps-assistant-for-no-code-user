"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCircle2, Rocket, Server, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  checkFn: () => Promise<boolean>;
  actionLabel: string;
  actionHref: string;
}

const ONBOARDING_KEY = "vps-onboarding-dismissed-v2";

export function OnboardingWizard() {
  const [dismissed, setDismissed] = useState(true);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const steps: OnboardingStep[] = [
    {
      id: "remote-server",
      title: "Add remote server",
      description: "Connect another VPS with the SSH test wizard.",
      icon: <Server className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/servers");
          const json = await res.json();
          return json.success && (json.data ?? []).some((server: { id: string }) => server.id !== "local");
        } catch { return false; }
      },
      actionLabel: "Open servers",
      actionHref: "/servers",
    },
    {
      id: "notifications",
      title: "Configure watchdog",
      description: "Turn on alerts for server or deploy issues.",
      icon: <Bell className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/notifications");
          const json = await res.json();
          const d = json.data;
          return Boolean(d?.discordWebhook || d?.slackWebhook || d?.telegramToken || d?.emailTo);
        } catch { return false; }
      },
      actionLabel: "Open settings",
      actionHref: "/settings",
    },
    {
      id: "safe-deploy",
      title: "Run safe deploy check",
      description: "Use Deploy Assistant before changing a server.",
      icon: <ShieldCheck className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/dashboard/summary");
          const json = await res.json();
          return (json.data?.deployments?.total ?? 0) > 0;
        } catch { return false; }
      },
      actionLabel: "Open deploy",
      actionHref: "/deploy",
    },
  ];

  useEffect(() => {
    const wasDismissed = localStorage.getItem(ONBOARDING_KEY);
    if (wasDismissed) {
      setDismissed(true);
      setLoading(false);
      return;
    }
    setDismissed(false);
    Promise.all(steps.map(async (s) => [s.id, await s.checkFn()] as const))
      .then((results) => {
        const map: Record<string, boolean> = {};
        for (const [id, done] of results) map[id] = done;
        setCompleted(map);
        if (Object.values(map).every(Boolean)) {
          localStorage.setItem(ONBOARDING_KEY, "1");
          setDismissed(true);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dismissed || loading) return null;

  const doneCount = Object.values(completed).filter(Boolean).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="relative rounded-xl border border-brand-800/40 bg-gradient-to-r from-brand-900/30 to-gray-900 p-5">
      <button
        onClick={() => { localStorage.setItem(ONBOARDING_KEY, "1"); setDismissed(true); }}
        className="absolute right-3 top-3 p-1 text-gray-500 transition-colors hover:text-white"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="mb-3 flex items-center gap-2">
        <Rocket className="h-5 w-5 text-brand-400" />
        <h2 className="text-base font-semibold text-white">Fleet setup checklist</h2>
        <span className="ml-auto pr-7 text-xs text-gray-500">{doneCount}/{steps.length} complete</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
        <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {steps.map((step) => {
          const isDone = completed[step.id];
          return (
            <div key={step.id} className={`rounded-lg border p-3 transition-colors ${isDone ? "border-emerald-800/30 bg-emerald-900/20" : "border-gray-700/50 bg-gray-800/50 hover:border-brand-700/50"}`}>
              <div className="mb-1.5 flex items-center gap-2">
                {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <span className="text-brand-400">{step.icon}</span>}
                <span className={`text-sm font-medium ${isDone ? "text-emerald-300" : "text-white"}`}>{step.title}</span>
              </div>
              <p className="mb-2 text-xs leading-relaxed text-gray-500">{step.description}</p>
              {!isDone && <a href={step.actionHref}><Button variant="secondary" size="sm">{step.actionLabel}</Button></a>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
