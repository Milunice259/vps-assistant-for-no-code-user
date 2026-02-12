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

const TAB_DESCRIPTIONS: Record<string, string> = {
  git: "Clone a Git repository and auto-deploy. The app will detect the stack (Node.js, Python, etc.) and configure Docker automatically.",
  image: "Pull a Docker image from any registry and run it as a container with custom port mappings and resource limits.",
  compose: "Deploy a multi-container stack using a docker-compose.yml file. Browse the server's file system to select the project directory.",
};

export default function DeployPage() {
  const [activeTab, setActiveTab] = useState("git");

  return (
    <div className="space-y-8">
      {/* Deploy Type Selector */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Deploy Application</h2>
        <Tabs tabs={DEPLOY_TABS} activeTab={activeTab} onChange={setActiveTab} />
        <p className="mt-3 text-sm text-gray-400 leading-relaxed">
          {TAB_DESCRIPTIONS[activeTab]}
        </p>
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
  );
}
