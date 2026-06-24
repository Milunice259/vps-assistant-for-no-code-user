"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  AlertTriangle,
  AppWindow,
  BookOpen,
  CheckCircle2,
  Database,
  Gauge,
  GitBranch,
  HelpCircle,
  Network,
  Server,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";

const quickStart = [
  ["1", "Open Dashboard", "Check Fleet Risk Score first. Green means normal, amber means watch, red means act."],
  ["2", "Read alerts", "Open Alert Center and use Explain before trying any fix."],
  ["3", "Back up", "Create a backup before deploys, settings changes, or repairs."],
  ["4", "Set the Watchdog", "Use Notification Watchdog rules to choose when the panel should warn you in-app or through chat."],
];

const sections = [
  {
    id: "dashboard",
    title: "Dashboard and Fleet Risk Score",
    icon: Gauge,
    summary: "Your daily health screen for one server or a whole fleet.",
    bullets: [
      "Fleet Risk Score combines CPU, memory, disk, and server reachability into one 0-100 score.",
      "Many servers are summarized; open server groups in Alert Center instead of scanning a very long table.",
      "Use trend and severity, not one-second spikes. A short CPU spike is normal; repeated critical alerts need action.",
      "Start here every day: score, offline servers, disk alerts, then app/service alerts.",
    ],
  },
  {
    id: "servers",
    title: "Servers",
    icon: Server,
    summary: "Add local or remote VPS machines and control them from one panel.",
    bullets: [
      "Use Servers to add SSH details, view stats, Docker containers, and system services.",
      "Remote server offline usually means power, firewall, network, SSH port, or credential problems.",
      "Prefer guided actions over terminal commands. Dangerous actions are hidden while Safe Mode is on.",
      "Each server should have its own logs and audit trail so you can review what changed later.",
    ],
  },
  {
    id: "apps",
    title: "Apps and Services",
    icon: AppWindow,
    summary: "See Docker containers and important systemd services in one place.",
    bullets: [
      "Docker apps show container state, ports, domains, logs, health checks, and environment tools.",
      "System services such as nginx, traefik, n8n, hermes, or hermes-gateway appear as service apps.",
      "Restart only the app/service you understand. If unsure, inspect logs first.",
      "Remote live discovery can be slower; the panel keeps default app loading fast by avoiding unnecessary SSH scans.",
    ],
  },
  {
    id: "alerts",
    title: "Alert Center and Guided Fix",
    icon: AlertTriangle,
    summary: "Plain-language triage for people who do not want to read Linux logs first.",
    bullets: [
      "Alerts are grouped by server so a large fleet stays readable.",
      "Hover icons for detail; click Explain for plain-language cause and impact.",
      "Fix safely appears only for low-risk fixes such as cache cleanup or old log trimming.",
      "For CPU/RAM issues, diagnose first. Do not kill processes unless you know the app impact.",
    ],
  },
  {
    id: "safe-repair",
    title: "Safe Repair",
    icon: Wrench,
    summary: "Maintenance actions that avoid databases, app data, and Docker volumes.",
    bullets: [
      "Explain current health is read-only and should be your first step.",
      "Clear package cache is low-risk and frees OS package cache only.",
      "Trim old system logs keeps recent journal logs while freeing old log space.",
      "Safe Repair is not a replacement for app-specific database backups.",
    ],
  },
  {
    id: "backup",
    title: "Backup and Restore",
    icon: Database,
    summary: "Protect panel data before changes and recover from wrong settings.",
    bullets: [
      "Backups include panel database data: servers, apps, users, settings, notifications, and audit logs.",
      "Create a backup before changing notifications, users, deploy config, or remote server settings.",
      "Restore creates a pre-restore snapshot first so you can undo a wrong restore.",
      "Panel backups do not include every external app database or Docker volume; back those up inside each app too.",
    ],
  },
  {
    id: "deploy",
    title: "Deploy",
    icon: GitBranch,
    summary: "Deploy Git repos, Docker images, or compose projects with safer defaults.",
    bullets: [
      "Use Git deploy for source repositories, Docker image deploy for published images, and Compose for multi-service apps.",
      "Check ports and domains before deploy. Port conflicts are a common failure.",
      "Set memory limits for unknown apps to prevent one bad app from exhausting the VPS.",
      "If deploy fails, read the deploy log and fix the first real error before retrying.",
    ],
  },
  {
    id: "network",
    title: "Network Map",
    icon: Network,
    summary: "Visualize how users, proxy, servers, apps, ports, and networks connect.",
    bullets: [
      "Use the map to understand traffic flow before changing ports or domains.",
      "Fit and Reset help when many apps make the canvas crowded.",
      "The map is a visibility tool; it does not replace real firewall enforcement unless a page clearly says so.",
      "For public apps, check domain, Traefik route, container port, and SSL status.",
    ],
  },
  {
    id: "settings",
    title: "Settings and Notification Watchdog",
    icon: Settings,
    summary: "Tune alert rules, cooldowns, and external delivery.",
    bullets: [
      "In-app checks work without a channel; channels only send alerts to Discord, Slack, or Telegram.",
      "Threshold decides when a rule fires; cooldown prevents repeated spam during one incident.",
      "Use Watching/Muted for rules and Enabled/Disabled for external delivery.",
      "Webhook URLs and credentials stay hidden; the UI must never expose secrets back to the browser.",
    ],
  },
  {
    id: "audit-users",
    title: "Users, Audit Log, and Safety",
    icon: ShieldCheck,
    summary: "Know who changed what and reduce accidental damage.",
    bullets: [
      "Audit Log records admin actions with time, actor, server/app target, status, and detail.",
      "Use Users to separate accounts instead of sharing one admin login.",
      "Keep Safe Mode on for daily use. Turn it off only when you understand the action.",
      "Terminal is advanced; use guided pages first for common tasks.",
    ],
  },
];

const walkthroughs = [
  {
    id: "setup-step-by-step",
    title: "First-time settings setup",
    steps: [
      "Open Backup & Restore and click Create backup.",
      "Open Settings, add one notification channel, then click Test delivery.",
      "Add recommended alert rules: CPU >85%, memory >85%, disk >80%, server unreachable.",
      "Keep Safe Mode on for daily use.",
      "Open Dashboard and confirm the Fleet Risk Score and Alert Center load correctly.",
    ],
  },
  {
    id: "deploy-step-by-step",
    title: "Deploy an app safely",
    steps: [
      "Open Deploy and choose Git, Docker Image, or Docker Compose.",
      "Pick the target server. Use local server if you are unsure.",
      "Enter repository/image/compose details and the public domain if needed.",
      "Check port conflicts before starting. Change the port if another app already uses it.",
      "Start deploy, watch the deployment log, and fix the first error if it fails.",
      "After success, open Apps and check health, logs, domain, and resource usage.",
    ],
  },
  {
    id: "watchdog-step-by-step",
    title: "Set up Notification Watchdog",
    steps: [
      "Open Settings > Notifications.",
      "Add a channel only if you want external delivery; in-app checks work without one.",
      "Add recommended rules, then tune thresholds and cooldowns.",
      "Set cooldown: 15 minutes for urgent checks, 60+ minutes for noisy resource alerts.",
      "Use Watching/Muted to pause a rule without deleting its settings.",
      "Open Dashboard and use Check now to confirm what the watchdog sees.",
    ],
  },
  {
    id: "alert-step-by-step",
    title: "Handle an alert",
    steps: [
      "Open Dashboard, then Alert Center.",
      "Find the server card with the highest severity icon.",
      "Hover the alert icon or click Explain to understand impact.",
      "If Fix safely appears, create/confirm backup and run it.",
      "If the alert is CPU/RAM or remote offline, diagnose first; do not restart random apps.",
      "Open Audit Log after the action to confirm what changed.",
    ],
  },
  {
    id: "backup-step-by-step",
    title: "Create and restore a backup",
    steps: [
      "Open Backup & Restore.",
      "Click Create backup before settings, deploys, repairs, or user changes.",
      "Name the backup by purpose, for example before-deploy-chatbot.",
      "To restore, choose the snapshot and read the warning carefully.",
      "Confirm restore. The app creates a pre-restore snapshot first.",
      "Reload Dashboard and Audit Log to verify the panel is healthy.",
    ],
  },
  {
    id: "server-step-by-step",
    title: "Add and check a remote server",
    steps: [
      "Open Servers and click Add server.",
      "Enter name, host/IP, SSH port, username, and authentication details.",
      "Save, then open the server detail page.",
      "Check stats, Docker containers, system services, SSL, and network information.",
      "If it shows offline, verify power, firewall, SSH port, credentials, and network access.",
    ],
  },
];

const glossary = [
  ["CPU", "How busy the processor is. High for a short time is normal; high for a long time means the server is overloaded."],
  ["Memory", "Working space for apps. Very high memory can make the VPS slow or trigger crashes."],
  ["Disk", "Storage space. Full disks can break databases, uploads, logs, and deploys."],
  ["Docker", "A common way to run apps in isolated containers."],
  ["System service", "A Linux background service managed by systemd, such as nginx or traefik."],
  ["Traefik", "The reverse proxy that routes domains to apps and handles HTTPS."],
  ["Fleet Risk Score", "A current 0-100 health summary across servers."],
  ["Notification Watchdog", "Controllable alert rules, cooldowns, mute state, and external delivery."],
  ["Threshold", "The value that triggers a rule, such as disk above 80%."],
  ["Cooldown", "How long the panel waits before sending the same alert again."],
];

export default function DocsPage() {
  useEffect(() => {
    function openHashTopic() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const topic = document.getElementById(id);
      if (topic instanceof HTMLDetailsElement) topic.open = true;
    }

    openHashTopic();
    window.addEventListener("hashchange", openHashTopic);
    return () => window.removeEventListener("hashchange", openHashTopic);
  }, []);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-brand-500/20 bg-gradient-to-br from-gray-900 via-gray-800 to-slate-950 p-6 shadow-2xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-brand-500/15 p-3 ring-1 ring-brand-400/30">
                <BookOpen className="h-7 w-7 text-brand-300" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-300">VPS Control Docs</p>
                <h1 className="text-3xl font-bold text-white">Run your VPS with confidence.</h1>
              </div>
            </div>
            <p className="text-base leading-7 text-gray-300">
              This is the user manual for non-technical operators: what each screen does, what values mean, what to click first, and when to stop before a risky change.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100 lg:w-80">
            <div className="mb-2 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" /> Best first setup</div>
            <ol className="list-decimal space-y-1 pl-5 text-emerald-100/85">
              <li>Create a backup.</li>
              <li>Add notification channel.</li>
              <li>Add recommended alert rules.</li>
              <li>Review Dashboard daily.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {quickStart.map(([step, title, text]) => (
          <div key={step} className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-sm font-bold text-brand-300">{step}</div>
            <h2 className="font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">{text}</p>
          </div>
        ))}
      </section>

      <nav className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><HelpCircle className="h-4 w-4 text-brand-300" /> Find a topic</div>
        <div className="flex flex-wrap gap-2">
          {walkthroughs.map((guide) => (
            <a key={guide.id} href={`#${guide.id}`} className="rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-sm text-brand-100 hover:bg-brand-500/20">
              {guide.title}
            </a>
          ))}
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-300 hover:border-brand-500 hover:text-white">
              {section.title}
            </a>
          ))}
        </div>
      </nav>

      <section className="rounded-2xl border border-brand-500/20 bg-gray-800 p-5">
        <h2 className="text-xl font-semibold text-white">Step-by-step guides</h2>
        <p className="mt-1 text-sm text-gray-400">Open only the guide you need.</p>
        <div className="mt-5 space-y-3">
          {walkthroughs.map((guide, guideIndex) => (
            <details id={guide.id} key={guide.id} open={guideIndex === 0} className="group scroll-mt-24 rounded-2xl border border-gray-700 bg-gray-900 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-white">
                <span>{guide.title}</span>
                <span className="text-xs text-brand-300 group-open:hidden">Open</span>
                <span className="hidden text-xs text-gray-400 group-open:inline">Close</span>
              </summary>
              <ol className="mt-4 space-y-3 border-t border-gray-700 pt-4">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm leading-6 text-gray-300">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-300">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <h2 className="text-xl font-semibold text-white">Feature reference</h2>
        <p className="mt-1 text-sm text-gray-400">Short summaries stay visible; details expand on demand.</p>
        <div className="mt-5 space-y-3">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <details id={section.id} key={section.id} className="group scroll-mt-24 rounded-2xl border border-gray-700 bg-gray-900 p-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                  <span className="flex gap-3">
                    <span className="rounded-xl bg-gray-800 p-2 ring-1 ring-gray-700"><Icon className="h-5 w-5 text-brand-300" /></span>
                    <span>
                      <span className="block font-semibold text-white">{section.title}</span>
                      <span className="mt-1 block text-sm text-gray-400">{section.summary}</span>
                    </span>
                  </span>
                  <span className="mt-1 shrink-0 text-xs text-brand-300 group-open:hidden">Open</span>
                  <span className="mt-1 hidden shrink-0 text-xs text-gray-400 group-open:inline">Close</span>
                </summary>
                <ul className="mt-4 space-y-2 border-t border-gray-700 pt-4 text-sm leading-6 text-gray-300">
                  {section.bullets.map((item) => (
                    <li key={item} className="flex gap-2 rounded-lg border border-gray-700/70 bg-gray-800/70 px-3 py-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Plain-English glossary</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {glossary.map(([term, text]) => (
            <details key={term} className="rounded-xl border border-gray-700 bg-gray-900 p-4">
              <summary className="cursor-pointer list-none font-semibold text-white">{term}</summary>
              <p className="mt-2 text-sm leading-6 text-gray-400">{text}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-500/20 bg-brand-500/10 p-5">
        <h2 className="text-lg font-semibold text-brand-100">Need to do something now?</h2>
        <p className="mt-2 text-sm text-brand-100/80">Use the safest page for the task. Avoid Terminal unless a guide specifically asks for it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/dashboard" className="rounded-lg border border-brand-500/30 px-3 py-2 text-sm text-brand-100 hover:bg-brand-500/10">Open Dashboard</Link>
          <Link href="/backup" className="rounded-lg border border-brand-500/30 px-3 py-2 text-sm text-brand-100 hover:bg-brand-500/10">Create Backup</Link>
          <Link href="/settings" className="rounded-lg border border-brand-500/30 px-3 py-2 text-sm text-brand-100 hover:bg-brand-500/10">Set Notifications</Link>
          <Link href="/audit" className="rounded-lg border border-brand-500/30 px-3 py-2 text-sm text-brand-100 hover:bg-brand-500/10">Review Audit Log</Link>
        </div>
      </section>
    </div>
  );
}
