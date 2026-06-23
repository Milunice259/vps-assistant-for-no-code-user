import Link from "next/link";
import { AlertTriangle, Bell, BookOpen, Database, Gauge, GitBranch, ShieldCheck, Wrench } from "lucide-react";

const sections = [
  {
    id: "daily-check",
    title: "Daily check",
    icon: <Gauge className="h-5 w-5 text-emerald-400" />,
    items: [
      "Start at Dashboard. A score above 85 is healthy; 65-84 needs attention; below 65 is critical.",
      "CPU spikes are normal. Worry when CPU stays above 80-90% for many minutes.",
      "Memory above 85% can make apps slow. Diagnose first; do not randomly kill processes.",
      "Disk above 80% needs cleanup planning. Disk above 88-90% can break uploads, databases, and deploys.",
    ],
  },
  {
    id: "alerts",
    title: "Alerts and guided fixes",
    icon: <AlertTriangle className="h-5 w-5 text-amber-400" />,
    items: [
      "Alert Center groups problems by server so many servers do not make one endless list.",
      "Use Explain to understand the issue in plain language.",
      "Use Fix safely only when shown. Safe fixes create backups where needed and avoid app data, databases, and Docker volumes.",
      "For remote server unreachable alerts, open the server detail page and check power, network, SSH credentials, and firewall rules.",
    ],
  },
  {
    id: "safe-repair",
    title: "Safe repair",
    icon: <Wrench className="h-5 w-5 text-sky-400" />,
    items: [
      "Run read-only health checks before changing anything.",
      "Clearing package cache is low risk and does not remove apps or databases.",
      "Trimming old system logs keeps recent logs but frees old journal space.",
      "Avoid restart/delete actions unless you know what service or app will be affected.",
    ],
  },
  {
    id: "backup",
    title: "Backup and restore",
    icon: <Database className="h-5 w-5 text-cyan-400" />,
    items: [
      "Create a backup before guided fixes, deploys, settings changes, or risky actions.",
      "Current backups protect panel data: servers, apps, users, audit logs, and settings.",
      "Backups do not replace app-level database or Docker volume backups.",
      "Restore creates a pre-restore backup first so you can recover if the chosen snapshot is wrong.",
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: <Bell className="h-5 w-5 text-indigo-400" />,
    items: [
      "Add Discord, Slack, or Telegram so you know about issues without opening the panel.",
      "Always test delivery after adding a channel.",
      "Recommended starter rules: CPU above 85%, memory above 85%, disk above 80%.",
      "Use cooldowns to prevent repeated alert spam during a long incident.",
    ],
  },
  {
    id: "deploy",
    title: "Deploy safely",
    icon: <GitBranch className="h-5 w-5 text-purple-400" />,
    items: [
      "Use Git deploy when you have a GitHub repository. Use Docker image deploy when you already have an image.",
      "Check ports before deploy. Two apps cannot use the same public host port.",
      "Set memory limits for unknown apps so one app cannot consume the whole VPS.",
      "If deploy fails, read the deployment log before retrying with changes.",
    ],
  },
  {
    id: "audit",
    title: "Audit and safety",
    icon: <ShieldCheck className="h-5 w-5 text-rose-400" />,
    items: [
      "Audit Log shows who did what, when, and whether it succeeded.",
      "Safe Mode hides high-risk actions. Turn it off only when you know exactly what will change.",
      "Terminal is advanced. Prefer guided pages for apps, deploys, backups, services, and cleanup.",
      "Never paste secrets into chat or screenshots. Webhooks and credentials should stay hidden.",
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-700 bg-gray-800 p-6">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-1 h-6 w-6 text-brand-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">VPS Control Docs</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-400">
              A compact guide for operating servers without needing to understand every Linux, Docker, or network detail.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-gray-300 hover:text-white">
              {section.title}
            </a>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <section id={section.id} key={section.id} className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
            <div className="mb-3 flex items-center gap-2">
              {section.icon}
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
            </div>
            <ul className="space-y-2 text-sm leading-6 text-gray-300">
              {section.items.map((item) => (
                <li key={item} className="rounded-lg border border-gray-700/70 bg-gray-900/50 px-3 py-2">{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
        <h2 className="text-lg font-semibold text-emerald-200">Best next steps</h2>
        <p className="mt-2 text-sm text-emerald-100/80">
          Configure notifications first, keep backups ready, then use Dashboard alerts as your main control flow.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/settings" className="rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10">Set up notifications</Link>
          <Link href="/backup" className="rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10">Create backup</Link>
          <Link href="/dashboard" className="rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10">Open dashboard</Link>
        </div>
      </div>
    </div>
  );
}
