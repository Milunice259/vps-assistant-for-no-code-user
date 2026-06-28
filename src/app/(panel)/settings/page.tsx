"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
  Bell, Plus, Trash2, Send, AlertTriangle,
  MessageSquare, Hash, Bot, Shield,
  Settings, Database
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSafeMode } from "@/contexts/SafeModeContext";

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

interface SecuritySettings {
  sessionMaxAgeHours: number;
  idleTimeoutMinutes: number;
  rememberMeEnabled: boolean;
  rememberMeDays: number;
  passwordMinLength: number;
  passwordRequireComplexity: boolean;
  defaultSafeMode: boolean;
  loginMaxAttempts: number;
  loginWindowSeconds: number;
  loginLockoutMinutes: number;
  auditRetentionDays: number;
  forceLogoutVersion: number;
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

const ALERT_PRESETS = [
  { metric: "offline", threshold: 0, label: "Server offline" },
  { metric: "cpu", threshold: 85, label: "CPU high" },
  { metric: "memory", threshold: 85, label: "Memory high" },
  { metric: "disk", threshold: 80, label: "Disk filling up" },
  { metric: "app_down", threshold: 0, label: "App/container down" },
  { metric: "service_down", threshold: 0, label: "Important service down" },
  { metric: "ssl_expiring", threshold: 0, label: "SSL expiring soon" },
  { metric: "backup_stale", threshold: 0, label: "Backup stale" },
];

function redactWebhook(url: string) {
  if (!url) return "No webhook URL";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.slice(0, 18)}... [hidden]`;
  } catch {
    return "Webhook saved [hidden]";
  }
}

function ruleLabel(rule: AlertRule) {
  const name = rule.metric.replace(/_/g, " ").toUpperCase();
  if (rule.metric === "offline") return "SERVER OFFLINE";
  if (["cpu", "memory", "disk"].includes(rule.metric)) return `${name} ${rule.operator === "gt" ? ">" : "<"} ${rule.threshold}%`;
  return `${name} ${rule.operator === "gt" ? ">" : "<"} ${rule.threshold}`;
}

export default function SettingsPage() {
  const { safeMode } = useSafeMode();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddRule, setShowAddRule] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings | null>(null);
  const [savingSecurity, setSavingSecurity] = useState(false);

  // Add channel form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("discord");
  const [newUrl, setNewUrl] = useState("");

  // Add rule form
  const [ruleMetric, setRuleMetric] = useState("cpu");
  const [ruleThreshold, setRuleThreshold] = useState(90);
  const [ruleCooldown] = useState(15);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      const json = await res.json();
      if (json.success) setChannels(json.data);
    } catch { /* ok */ }
    finally { setLoading(false); }
  }, []);

  const fetchSecuritySettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/security");
      const json = await res.json();
      if (json.success) setSecuritySettings(json.data);
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchSecuritySettings();
  }, [fetchChannels, fetchSecuritySettings]);

  async function saveSecuritySettings(next = securitySettings) {
    if (!next) return;
    const payload = safeMode ? {
      ...next,
      sessionMaxAgeHours: Math.min(next.sessionMaxAgeHours, 24),
      idleTimeoutMinutes: next.idleTimeoutMinutes || 60,
      rememberMeEnabled: false,
      passwordMinLength: Math.max(next.passwordMinLength, 12),
      passwordRequireComplexity: true,
    } : next;
    setSavingSecurity(true);
    try {
      const res = await fetch("/api/settings/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) setSecuritySettings(json.data);
    } finally {
      setSavingSecurity(false);
    }
  }

  async function runSecurityAction(action: "force_logout_all" | "cleanup_audit") {
    if (!securitySettings) return;
    if (!confirm(action === "force_logout_all" ? "Force logout all users?" : "Delete old audit logs past the retention window?")) return;
    await saveSecuritySettings({ ...securitySettings, action } as SecuritySettings & { action: string });
  }

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

  async function createRule(channelId: string, metric: string, threshold: number) {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "alert",
        metric,
        threshold,
        channelId,
        cooldownMin: ruleCooldown,
      }),
    });
    const json = await res.json();
    if (json.success) fetchChannels();
  }

  async function addRule(channelId: string) {
    await createRule(channelId, ruleMetric, ruleThreshold);
    setShowAddRule(null);
  }

  async function addPresetRules(channelId: string) {
    for (const preset of ALERT_PRESETS) {
      await createRule(channelId, preset.metric, preset.threshold);
    }
  }

  async function updateChannel(id: string, enabled: boolean) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type: "channel", enabled }),
    });
    fetchChannels();
  }

  async function updateRule(id: string, data: Partial<Pick<AlertRule, "enabled" | "threshold" | "cooldownMin">>) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type: "alert", ...data }),
    });
    fetchChannels();
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

  async function runSmartCheck() {
    setCheckingAlerts(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/notifications/check", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Check failed");
      setCheckResult(`Checked ${json.data.checked} servers · ${json.data.offline} offline · ${json.data.appDown} app down · ${json.data.serviceDown} service down · ${json.data.sslExpiring} SSL expiring · ${json.data.backupStale} backup stale`);
    } catch (error) {
      setCheckResult(error instanceof Error ? error.message : "Check failed");
    } finally {
      setCheckingAlerts(false);
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

        <div className="mb-4 rounded-xl border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-400">
          Keep this page for setup only. Delivery concepts and recommended alert rules are in <Link href="/docs#notifications" className="text-brand-400 hover:text-brand-300">Notification docs</Link>.
        </div>

        <div className="mb-4 rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Smart notification check</h3>
              <p className="text-xs text-gray-400">Runs real health checks now. Docker checks run every 15 minutes automatically when rules and channels exist.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={runSmartCheck} loading={checkingAlerts}>Run Check Now</Button>
          </div>
          {checkResult && <p className="mt-2 text-xs text-gray-400">{checkResult}</p>}
        </div>

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
                    <button
                      onClick={() => updateChannel(ch.id, !ch.enabled)}
                      className={`text-xs rounded-full border px-2 py-0.5 ${ch.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-gray-700 bg-gray-800 text-gray-500"}`}
                    >
                      {ch.enabled ? "Enabled" : "Disabled"}
                    </button>
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

                <p className="text-xs text-gray-500 font-mono mb-3 truncate" title="Webhook URL is hidden after saving to protect the secret token.">{redactWebhook(ch.webhookUrl)}</p>

                {/* Alert Rules */}
                <div className="space-y-1">
                  {ch.alertRules.map((rule) => (
                    <div key={rule.id} className="grid gap-2 rounded bg-gray-800/50 px-3 py-2 md:grid-cols-[1fr_auto] md:items-center">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <AlertTriangle className={`h-3.5 w-3.5 ${rule.enabled ? "text-yellow-400" : "text-gray-600"}`} />
                        <span className={rule.enabled ? "text-gray-300" : "text-gray-600"}>{ruleLabel(rule)}</span>
                        <button
                          onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                          className={`rounded-full border px-2 py-0.5 ${rule.enabled ? "border-emerald-500/30 text-emerald-300" : "border-gray-700 text-gray-500"}`}
                        >
                          {rule.enabled ? "Watching" : "Muted"}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {rule.metric !== "offline" && (
                          <label className="flex items-center gap-1 text-gray-500">
                            threshold
                            <input
                              type="number"
                              value={rule.threshold}
                              min={0}
                              max={rule.metric === "cpu" || rule.metric === "memory" || rule.metric === "disk" ? 100 : 999}
                              onChange={(e) => updateRule(rule.id, { threshold: Number(e.target.value) })}
                              className="w-16 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
                            />
                          </label>
                        )}
                        <label className="flex items-center gap-1 text-gray-500">
                          cooldown
                          <input
                            type="number"
                            value={rule.cooldownMin}
                            min={1}
                            max={1440}
                            onChange={(e) => updateRule(rule.id, { cooldownMin: Number(e.target.value) })}
                            className="w-16 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
                          />
                          min
                        </label>
                        <button onClick={() => deleteItem(rule.id, "alert")} className="text-gray-600 hover:text-red-400 transition-colors" title="Delete rule">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {ch.alertRules.length === 0 && (
                    <div className="mb-2 rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-3">
                      <p className="text-xs text-gray-400">No alert rules yet. Add the recommended starter rules for CPU, memory, and disk.</p>
                      <button onClick={() => addPresetRules(ch.id)} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300">
                        Add recommended rules
                      </button>
                    </div>
                  )}

                  {showAddRule === ch.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <select
                        value={ruleMetric} onChange={(e) => setRuleMetric(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="offline">Offline</option>
                        <option value="cpu">CPU</option>
                        <option value="memory">Memory</option>
                        <option value="disk">Disk</option>
                        <option value="app_down">App/container down</option>
                        <option value="service_down">Important service down</option>
                        <option value="ssl_expiring">SSL expiring soon</option>
                        <option value="backup_stale">Backup stale</option>
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

      {/* ── Docker Defaults ── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <svg className="h-5 w-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="4" height="6" rx="1"/><rect x="8" y="4" width="4" height="8" rx="1"/><rect x="14" y="2" width="4" height="10" rx="1"/><rect x="20" y="8" width="4" height="4" rx="1"/></svg>
          <h2 className="text-lg font-semibold text-white">Docker Defaults</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Default settings applied to newly deployed containers. These can be overridden per-app in App Settings.
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
          <SettingsField
            label="Default Restart Policy"
            hint="What should happen when a container crashes or the server reboots? 'unless-stopped' is recommended for most cases."
          >
            <select className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="unless-stopped">Unless stopped (recommended)</option>
              <option value="always">Always</option>
              <option value="on-failure">On failure</option>
              <option value="">None</option>
            </select>
          </SettingsField>
          <SettingsField
            label="Auto-Cleanup Schedule"
            hint="Docker accumulates unused images and containers over time. This setting automatically cleans them up to free disk space."
          >
            <select className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="weekly">Weekly (recommended)</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="never">Never</option>
            </select>
          </SettingsField>
          <SettingsField
            label="Default Memory Limit"
            hint="Maximum RAM for new containers. Leave at 0 for unlimited. 512 MB is a safe default for most apps."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                defaultValue={0}
                min={0}
                placeholder="0"
                className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
              />
              <span className="text-xs text-gray-500">MB (0 = unlimited)</span>
            </div>
          </SettingsField>
        </div>
      </section>

      {/* ── Security ── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Security</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Settings users can actually control. Built-in protections like CSRF, headers, auth guards, and secret redaction stay mandatory.
        </p>
        {securitySettings && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
            <SettingsField label="Default Safe Mode" hint="New browsers use this default until a user explicitly toggles Safe Mode in the sidebar.">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={securitySettings.defaultSafeMode}
                  onChange={(e) => setSecuritySettings({ ...securitySettings, defaultSafeMode: e.target.checked })}
                />
                Start in Safe Mode
              </label>
            </SettingsField>
            <SettingsField label="Session Timeout" hint="How long login sessions remain valid. Shorter is safer for shared/admin machines.">
              <select
                value={securitySettings.sessionMaxAgeHours}
                onChange={(e) => setSecuritySettings({ ...securitySettings, sessionMaxAgeHours: Number(e.target.value) })}
                className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value={1}>1 hour</option>
                <option value={8}>8 hours</option>
                <option value={24}>24 hours</option>
                {!safeMode && <option value={168}>7 days</option>}
              </select>
            </SettingsField>
            <SettingsField label="Idle Timeout" hint="Auto logout after no browser activity. Disabled means token lifetime is the only timeout.">
              <select
                value={securitySettings.idleTimeoutMinutes}
                onChange={(e) => setSecuritySettings({ ...securitySettings, idleTimeoutMinutes: Number(e.target.value) })}
                className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                {!safeMode && <option value={0}>Disabled</option>}
              </select>
            </SettingsField>
            {!safeMode && (
              <SettingsField label="Remember Me" hint="Allows longer login sessions from the login screen.">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={securitySettings.rememberMeEnabled}
                      onChange={(e) => setSecuritySettings({ ...securitySettings, rememberMeEnabled: e.target.checked })}
                    />
                    Allow remember me
                  </label>
                  <select
                    value={securitySettings.rememberMeDays}
                    disabled={!securitySettings.rememberMeEnabled}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, rememberMeDays: Number(e.target.value) })}
                    className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
              </SettingsField>
            )}
            <SettingsField label="Login Protection" hint="Controls failed-login rate limit and temporary lockout per IP.">
              <div className="grid gap-2 sm:grid-cols-3">
                <input type="number" min={3} max={20} value={securitySettings.loginMaxAttempts} onChange={(e) => setSecuritySettings({ ...securitySettings, loginMaxAttempts: Number(e.target.value) })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                <input type="number" min={30} max={300} value={securitySettings.loginWindowSeconds} onChange={(e) => setSecuritySettings({ ...securitySettings, loginWindowSeconds: Number(e.target.value) })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                <input type="number" min={1} max={1440} value={securitySettings.loginLockoutMinutes} onChange={(e) => setSecuritySettings({ ...securitySettings, loginLockoutMinutes: Number(e.target.value) })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <p className="mt-1 text-xs text-gray-500">attempts / window seconds / lockout minutes</p>
            </SettingsField>
            <SettingsField label="Audit Retention" hint="How many days to keep audit logs before manual cleanup.">
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={7} max={3650} value={securitySettings.auditRetentionDays} onChange={(e) => setSecuritySettings({ ...securitySettings, auditRetentionDays: Number(e.target.value) })} className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                <Button variant="secondary" size="sm" loading={savingSecurity} onClick={() => runSecurityAction("cleanup_audit")}>Clean old audit logs</Button>
              </div>
            </SettingsField>
            {!safeMode && (
              <SettingsField label="Force Logout All Sessions" hint="Invalidates existing API sessions; users must log in again.">
                <Button variant="danger" size="sm" loading={savingSecurity} onClick={() => runSecurityAction("force_logout_all")}>Force logout all</Button>
              </SettingsField>
            )}
            <SettingsField label="Minimum Password Length" hint="Applies when creating users or changing passwords.">
              <input
                type="number"
                min={safeMode ? 12 : 8}
                max={64}
                value={securitySettings.passwordMinLength}
                onChange={(e) => setSecuritySettings({ ...securitySettings, passwordMinLength: Number(e.target.value) })}
                className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </SettingsField>
            {!safeMode && (
              <SettingsField label="Password Complexity" hint="Requires uppercase, lowercase, number, and symbol.">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={securitySettings.passwordRequireComplexity}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, passwordRequireComplexity: e.target.checked })}
                  />
                  Require complex passwords
                </label>
              </SettingsField>
            )}
            <Button loading={savingSecurity} onClick={() => saveSecuritySettings()}>
              Save security settings
            </Button>
          </div>
        )}
      </section>

      {/* ── General ── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Settings className="h-5 w-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">General</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Basic application preferences and display settings.
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
          <SettingsField
            label="Application Name"
            hint="The name displayed in the browser tab and login page. Useful if you manage multiple servers."
          >
            <input
              type="text"
              defaultValue="VPS Control"
              className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </SettingsField>
          <SettingsField
            label="Language"
            hint="The language used for the admin interface. Currently only English is supported."
          >
            <select className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="en">English</option>
            </select>
          </SettingsField>
          <SettingsField
            label="Theme"
            hint="Choose between dark and light mode for the admin panel."
          >
            <select className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="dark">Dark (default)</option>
              <option value="light">Light</option>
              <option value="system">Use system preference</option>
            </select>
          </SettingsField>
        </div>
      </section>

      {/* ── Backup ── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Database className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Backup</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Configure automatic backups of your app settings, database, and configuration files.
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
          <SettingsField
            label="Auto-Backup Schedule"
            hint="How often the system automatically saves a backup of your settings and database."
          >
            <select className="w-full sm:w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="daily">Daily (recommended)</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="never">Disabled</option>
            </select>
          </SettingsField>
          <SettingsField
            label="Retention Period"
            hint="How long to keep old backups before they are automatically deleted to save disk space."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                defaultValue={30}
                min={1}
                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              />
              <span className="text-xs text-gray-500">days</span>
            </div>
          </SettingsField>
        </div>
      </section>

      {/* ── About ── */}
      <section className="text-center py-4">
        <p className="text-xs text-gray-600">
          VPS Control App · Built for non-technical server management
        </p>
      </section>
    </div>
  );
}

/** Settings field with label and description */
function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-0.5">{label}</label>
      <p className="text-xs text-gray-500 mb-2">{hint}</p>
      {children}
    </div>
  );
}
