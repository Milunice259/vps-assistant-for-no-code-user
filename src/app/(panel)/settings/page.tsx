"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bell, Plus, Trash2, Send, AlertTriangle,
  MessageSquare, Hash, Bot
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Channel {
  id: string;
  name: string;
  type: string;
  webhookUrl: string;
  enabled: boolean;
  alertRules: AlertRule[];
}

interface AlertRule {
  id: string;
  metric: string;
  operator: string;
  threshold: number;
  cooldownMin: number;
  serverId: string | null;
  enabled: boolean;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  discord: <MessageSquare className="h-4 w-4" />,
  slack: <Hash className="h-4 w-4" />,
  telegram: <Bot className="h-4 w-4" />,
};

const CHANNEL_COLORS: Record<string, string> = {
  discord: "text-indigo-400",
  slack: "text-emerald-400",
  telegram: "text-sky-400",
};

export default function SettingsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddRule, setShowAddRule] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Add channel form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("discord");
  const [newUrl, setNewUrl] = useState("");

  // Add rule form
  const [ruleMetric, setRuleMetric] = useState("cpu");
  const [ruleThreshold, setRuleThreshold] = useState(90);
  const [ruleCooldown, setRuleCooldown] = useState(15);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      const json = await res.json();
      if (json.success) setChannels(json.data);
    } catch { /* ok */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  async function addChannel() {
    if (!newName || !newUrl) return;
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "channel", name: newName, channelType: newType, webhookUrl: newUrl }),
    });
    const json = await res.json();
    if (json.success) {
      setShowAddChannel(false);
      setNewName(""); setNewUrl("");
      fetchChannels();
    }
  }

  async function addRule(channelId: string) {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "alert",
        metric: ruleMetric,
        threshold: ruleThreshold,
        channelId,
        cooldownMin: ruleCooldown,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setShowAddRule(null);
      fetchChannels();
    }
  }

  async function deleteItem(id: string, type: "channel" | "alert") {
    await fetch(`/api/notifications?id=${id}&type=${type}`, { method: "DELETE" });
    fetchChannels();
  }

  async function testWebhook(channelId: string) {
    setTestingId(channelId);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", channelId }),
      });
    } finally {
      setTimeout(() => setTestingId(null), 2000);
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-sm py-4">Loading settings...</div>;
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ── Notifications Section ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowAddChannel(!showAddChannel)}>
            <Plus className="h-4 w-4 mr-1" /> Add Channel
          </Button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Configure webhook channels and alert rules to get notified when your servers need attention.
        </p>

        {/* Add Channel Form */}
        {showAddChannel && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="Channel name"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <select
                value={newType} onChange={(e) => setNewType(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
              </select>
              <input
                type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Webhook URL"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowAddChannel(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={addChannel}>Save Channel</Button>
            </div>
          </div>
        )}

        {/* Channel Cards */}
        {channels.length === 0 ? (
          <div className="text-center py-8 text-gray-500 border border-dashed border-gray-700 rounded-lg">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No notification channels configured</p>
            <p className="text-xs text-gray-600 mt-1">Add a Discord, Slack, or Telegram webhook to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => (
              <div key={ch.id} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={CHANNEL_COLORS[ch.type] || "text-gray-400"}>
                      {CHANNEL_ICONS[ch.type] || <Bell className="h-4 w-4" />}
                    </span>
                    <h3 className="text-sm font-medium text-white">{ch.name}</h3>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                      {ch.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => testWebhook(ch.id)}
                      loading={testingId === ch.id}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" /> Test
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteItem(ch.id, "channel")}>
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-gray-500 font-mono mb-3 truncate">{ch.webhookUrl}</p>

                {/* Alert Rules */}
                <div className="space-y-1">
                  {ch.alertRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                        <span className="text-gray-300">
                          {rule.metric.toUpperCase()} {rule.operator === "gt" ? ">" : "<"} {rule.threshold}%
                        </span>
                        <span className="text-gray-600">cooldown {rule.cooldownMin}min</span>
                      </div>
                      <button
                        onClick={() => deleteItem(rule.id, "alert")}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}

                  {showAddRule === ch.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <select
                        value={ruleMetric} onChange={(e) => setRuleMetric(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="cpu">CPU</option>
                        <option value="memory">Memory</option>
                        <option value="disk">Disk</option>
                      </select>
                      <span className="text-xs text-gray-500">&gt;</span>
                      <input
                        type="number" value={ruleThreshold} onChange={(e) => setRuleThreshold(Number(e.target.value))}
                        className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      />
                      <span className="text-xs text-gray-500">%</span>
                      <Button variant="primary" size="sm" onClick={() => addRule(ch.id)}>Add</Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowAddRule(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddRule(ch.id)}
                      className="text-xs text-brand-400 hover:text-brand-300 mt-1 flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Add Alert Rule
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
