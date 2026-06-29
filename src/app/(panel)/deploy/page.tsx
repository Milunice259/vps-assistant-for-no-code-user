"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch, Box, Layers, AlertTriangle, CheckCircle2 } from "lucide-react";
import { DeployForm } from "@/components/deploy/DeployForm";
import { DeployLog } from "@/components/deploy/DeployLog";
import { DockerImageDeploy } from "@/components/deploy/DockerImageDeploy";
import { DockerComposeDeploy } from "@/components/deploy/DockerComposeDeploy";
import { Tabs } from "@/components/ui/Tabs";
import { PermissionGate } from "@/components/ui/PermissionGate";

const DEPLOY_TABS = [
  { key: "git", label: "Git Repo", icon: <GitBranch className="h-4 w-4" /> },
  { key: "image", label: "Docker Image", icon: <Box className="h-4 w-4" /> },
  { key: "compose", label: "Docker Compose", icon: <Layers className="h-4 w-4" /> },
];

const TAB_DESCRIPTIONS: Record<string, string> = {
  git: "Best when your app is already in GitHub.",
  image: "Best when you already have a Docker image.",
  compose: "Best for multi-container apps with docker-compose.yml.",
};

export default function DeployPage() {
  const [activeTab, setActiveTab] = useState("git");

  return (
    <PermissionGate minimum="OPERATOR">
    <div className="space-y-8">
      {/* Deploy Type Selector */}
      <section className="rounded-xl border border-gray-700 bg-gray-800/40 p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Deploy Application</h2>
            <p className="mt-1 text-sm text-gray-400">Choose the source type. More detail is in <Link href="/docs#deploy" className="text-brand-400 hover:text-brand-300">Deploy docs</Link>.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Review secrets and ports before pressing Deploy.
          </div>
        </div>
        <Tabs tabs={DEPLOY_TABS} activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-3 flex items-start gap-2 text-sm text-gray-400 leading-relaxed">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>{TAB_DESCRIPTIONS[activeTab]}</p>
        </div>
      </section>

      {/* Deploy Form */}
      <section>
        {activeTab === "git" && <DeployForm />}
        {activeTab === "image" && <DockerImageDeploy />}
        {activeTab === "compose" && <DockerComposeDeploy />}
      </section>

      {/* Deployment History — title is inside DeployLog */}
      <section>
        <DeployLog />
      </section>
    </div>
    </PermissionGate>
  );
}
