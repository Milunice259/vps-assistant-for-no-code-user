"use client";

import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react";
import { Terminal as TerminalIcon, ChevronDown } from "lucide-react";

interface ServerOption {
  id: string;
  name: string;
  host: string;
}

interface HistoryEntry {
  command: string;
  output: string;
  exitCode: number;
  timestamp: Date;
}

export default function TerminalPage() {
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState("local");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdIndex, setCmdIndex] = useState(-1);

  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch servers
  useEffect(() => {
    fetch("/api/servers")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setServers(json.data);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll on new output
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [history]);

  const execute = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || running) return;

    setInput("");
    setRunning(true);
    setCmdHistory((prev) => [cmd, ...prev.slice(0, 50)]);
    setCmdIndex(-1);

    // Handle local commands
    if (cmd === "clear") {
      setHistory([]);
      setRunning(false);
      return;
    }

    try {
      const res = await fetch(`/api/servers/${serverId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const json = await res.json();

      if (json.success) {
        setHistory((prev) => [
          ...prev,
          {
            command: cmd,
            output: json.data.output || "",
            exitCode: json.data.exitCode,
            timestamp: new Date(),
          },
        ]);
      } else {
        setHistory((prev) => [
          ...prev,
          {
            command: cmd,
            output: `\x1b[31mError: ${json.error}\x1b[0m`,
            exitCode: 1,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: `\x1b[31mNetwork error: ${err instanceof Error ? err.message : "Unknown"}\x1b[0m`,
          exitCode: 1,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [input, running, serverId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      execute();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const newIdx = Math.min(cmdIndex + 1, cmdHistory.length - 1);
        setCmdIndex(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdIndex > 0) {
        const newIdx = cmdIndex - 1;
        setCmdIndex(newIdx);
        setInput(cmdHistory[newIdx]);
      } else {
        setCmdIndex(-1);
        setInput("");
      }
    }
  };

  // Strip ANSI and render — simplified approach
  function renderOutput(text: string) {
    // Remove ANSI escape codes for display, keep text
    const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
    return clean;
  }

  const serverName = servers.find((s) => s.id === serverId)?.name || "Server";

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-5xl">
      {/* Server Selector */}
      <div className="flex items-center gap-3 mb-3">
        <TerminalIcon className="h-5 w-5 text-emerald-400" />
        <div className="relative">
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="appearance-none bg-gray-900 border border-gray-700 rounded-lg pl-3 pr-8 py-1.5 text-sm text-white cursor-pointer hover:border-gray-600"
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
        </div>
        <span className="text-xs text-gray-600">
          Type commands below • Use ↑↓ for history • &quot;clear&quot; to reset
        </span>
      </div>

      {/* Terminal Window */}
      <div
        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg overflow-hidden flex flex-col font-mono text-sm"
        onClick={() => inputRef.current?.focus()}
      >
        {/* Title Bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-xs text-gray-500 ml-2">{serverName} — Terminal</span>
        </div>

        {/* Output Area */}
        <div ref={termRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Welcome message */}
          {history.length === 0 && (
            <div className="text-gray-600 text-xs space-y-1">
              <p className="text-emerald-400">Welcome to VPS Control Terminal</p>
              <p>Connected to: {serverName}</p>
              <p>Type a command and press Enter to execute.</p>
              <p className="text-yellow-500/50">⚠ Commands are executed on the actual server. Use with caution.</p>
            </div>
          )}

          {/* Command history */}
          {history.map((entry, i) => (
            <div key={i}>
              {/* Command line */}
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 shrink-0">$</span>
                <span className="text-white">{entry.command}</span>
              </div>
              {/* Output */}
              {entry.output && (
                <pre className={`whitespace-pre-wrap text-xs mt-0.5 ml-4 ${entry.exitCode === 0 ? "text-gray-300" : "text-red-400"}`}>
                  {renderOutput(entry.output)}
                </pre>
              )}
            </div>
          ))}

          {/* Running indicator */}
          {running && (
            <div className="flex items-center gap-2 text-yellow-400 text-xs">
              <div className="animate-pulse">●</div>
              <span>Executing...</span>
            </div>
          )}
        </div>

        {/* Input Line */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-800 bg-gray-900/50">
          <span className="text-emerald-400 shrink-0">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            placeholder="Enter command..."
            className="flex-1 bg-transparent text-white placeholder-gray-600 outline-none text-sm font-mono"
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
