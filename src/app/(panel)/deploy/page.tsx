"use client";

import { useState } from "react";
import { GitBranch, Box, Layers } from "lucide-react";
import { DeployForm } from "@/components/deploy/DeployForm";
import { DeployLog } from "@/components/deploy/DeployLog";
import { DockerImageDeploy } from "@/components/deploy/DockerImageDeploy";
import { DockerComposeDeploy } from "@/components/deploy/DockerComposeDeploy";
import { Tabs } from "@/components/ui/Tabs";

const DEPLOY_TABS = [
  { key: "git", label: "Git Repo", icon: <GitBranch className="h-4 w-4" /> },
  { key: "image", label: "Docker Image", icon: <Box className="h-4 w-4" /> },
  { key: "compose", label: "Docker Compose", icon: <Layers className="h-4 w-4" /> },
];

export default function DeployPage() {
  const [activeTab, setActiveTab] = useState("git");

  return (
    <div className="space-y-8">
      {/* Deploy Type Selector */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Deploy Application</h2>
        <Tabs tabs={DEPLOY_TABS} activeTab={activeTab} onChange={setActiveTab} />
      </section>

      {/* Deploy Form */}
      <section>
        {activeTab === "git" && <DeployForm />}
        {activeTab === "image" && <DockerImageDeploy />}
        {activeTab === "compose" && <DockerComposeDeploy />}
      </section>

      {/* Deployment History */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Deployment History</h2>
        <DeployLog />
      </section>
    </div>
  );
}
