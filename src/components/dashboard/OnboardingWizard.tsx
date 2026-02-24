"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Server, Bell, Shield, ArrowRight, X, Rocket } from "lucide-react";
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

const ONBOARDING_KEY = "vps-onboarding-dismissed";

export function OnboardingWizard() {
  const [dismissed, setDismissed] = useState(true); // hidden by default
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const steps: OnboardingStep[] = [
    {
      id: "server",
      title: "Add a Server",
      description: "Connect your first VPS server to start monitoring and managing it.",
      icon: <Server className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/servers");
          const json = await res.json();
          return json.success && (json.data?.length ?? 0) > 0;
        } catch { return false; }
      },
      actionLabel: "Add Server",
      actionHref: "/servers",
    },
    {
      id: "notifications",
      title: "Set Up Notifications",
      description: "Get alerted via Discord, Slack, or Telegram when something needs attention.",
      icon: <Bell className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/notifications");
          const json = await res.json();
          const d = json.data;
          return d && (d.discordWebhook || d.slackWebhook || d.telegramToken);
        } catch { return false; }
      },
      actionLabel: "Configure",
      actionHref: "/settings",
    },
    {
      id: "users",
      title: "Create Team Members",
      description: "Add users with different roles: Admin, Operator, or Viewer.",
      icon: <Shield className="h-5 w-5" />,
      checkFn: async () => {
        try {
          const res = await fetch("/api/users");
          const json = await res.json();
          return json.success && (json.data?.length ?? 0) > 1;
        } catch { return false; }
      },
      actionLabel: "Manage Users",
      actionHref: "/users",
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

    // Check all steps
    Promise.all(steps.map(async (s) => [s.id, await s.checkFn()] as const))
      .then((results) => {
        const map: Record<string, boolean> = {};
        for (const [id, done] of results) map[id] = done;
        setCompleted(map);
        // If all done, auto-dismiss
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
    <div className="bg-gradient-to-r from-brand-900/30 to-gray-900 border border-brand-800/40 rounded-xl p-5 mb-6 relative">
      {/* Dismiss */}
      <button
        onClick={() => {
          localStorage.setItem(ONBOARDING_KEY, "1");
          setDismissed(true);
        }}
        className="absolute top-3 right-3 p-1 text-gray-500 hover:text-white transition-colors"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Rocket className="h-5 w-5 text-brand-400" />
        <h2 className="text-base font-semibold text-white">Getting Started</h2>
        <span className="text-xs text-gray-500 ml-auto">{doneCount}/{steps.length} complete</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-gray-800 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {steps.map((step) => {
          const isDone = completed[step.id];
          return (
            <div
              key={step.id}
              className={`p-3 rounded-lg border transition-colors ${
                isDone
                  ? "bg-emerald-900/20 border-emerald-800/30"
                  : "bg-gray-800/50 border-gray-700/50 hover:border-brand-700/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <span className="text-brand-400">{step.icon}</span>
                )}
                <span className={`text-sm font-medium ${isDone ? "text-emerald-300" : "text-white"}`}>
                  {step.title}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-2 leading-relaxed">{step.description}</p>
              {!isDone && (
                <a href={step.actionHref}>
                  <Button variant="secondary" size="sm">
                    {step.actionLabel}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
