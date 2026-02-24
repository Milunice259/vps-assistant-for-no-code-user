"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Monitor,
  Box,
  Cog,
  Zap,
  Network,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { ServerOverview } from "@/components/servers/ServerOverview";
import { DockerContainerList } from "@/components/servers/DockerContainerList";
import { ServiceList } from "@/components/servers/ServiceList";
import { QuickActions } from "@/components/servers/QuickActions";
import dynamic from "next/dynamic";
const ServerNetworkMap = dynamic(
  () => import("@/components/servers/ServerNetworkMap").then((m) => m.ServerNetworkMap),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div> }
);
import { PackageManager } from "@/components/network/PackageManager";
import { ServerForm } from "@/components/servers/ServerForm";
import type { ServerInfo } from "@/types";

const SERVER_TABS = [
  { key: "overview", label: "Overview", icon: <Monitor className="h-4 w-4" /> },
  { key: "containers", label: "Applications", icon: <Box className="h-4 w-4" /> },
  { key: "networks", label: "Network Map", icon: <Network className="h-4 w-4" /> },
  { key: "services", label: "Services", icon: <Cog className="h-4 w-4" /> },
  { key: "packages", label: "Packages", icon: <Package className="h-4 w-4" /> },
  { key: "actions", label: "Quick Actions", icon: <Zap className="h-4 w-4" /> },
];

export default function ServerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.id as string;

  const [server, setServer] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const isLocal = serverId === "local";

  async function fetchServer() {
    try {
      const res = await fetch(`/api/servers/${serverId}`);
      const data = await res.json();
      if (data.success) setServer(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this server?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/servers/${serverId}`, { method: "DELETE" });
      router.push("/servers");
    } catch {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="text-center py-12 text-gray-400">Server not found.</div>
    );
  }

  if (editing) {
    return (
      <div className="max-w-2xl">
        <button
          onClick={() => setEditing(false)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <ServerForm
          server={server}
          onSuccess={() => {
            setEditing(false);
            fetchServer();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/servers")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-white">{server.name}</h2>
            <p className="text-sm text-gray-400">
              {isLocal ? "This machine" : `${server.username}@${server.host}:${server.port}`}
            </p>
          </div>
          {isLocal && (
            <Badge variant="info">Local</Badge>
          )}
          <Badge variant={server.isActive ? "success" : "default"}>
            {server.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        {!isLocal && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs tabs={SERVER_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Content */}
      {activeTab === "overview" && <ServerOverview serverId={serverId} />}
      {activeTab === "containers" && <DockerContainerList serverId={serverId} />}
      {activeTab === "networks" && <ServerNetworkMap serverId={serverId} />}
      {activeTab === "services" && <ServiceList serverId={serverId} />}
      {activeTab === "packages" && <PackageManager serverId={serverId} />}
      {activeTab === "actions" && <QuickActions serverId={serverId} />}
    </div>
  );
}
