"use client";

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { Terminal, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiResponse } from "@/types";

interface WebTerminalProps {
  appId: string;
  appName: string;
  containerId: string;
  onClose: () => void;
}

interface TermLine {
  type: "input" | "output" | "error" | "info";
  text: string;
}

export function WebTerminal({ appId, appName, onClose }: WebTerminalProps) {
  const [lines, setLines] = useState<TermLine[]>([
    { type: "info", text: `Connected to container: ${appName}` },
    { type: "info", text: "Commands run inside this container via docker exec." },
    { type: "info", text: "Some commands may not be available depending on the container's base image." },
    { type: "info", text: "" },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    setLines((prev) => [...prev, { type: "input", text: `$ ${cmd}` }]);
    setHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setInput("");
    setRunning(true);

    try {
      const res = await fetch(`/api/apps/${appId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const json: ApiResponse<{ output: string }> = await res.json();

      if (json.success && json.data) {
        const output = json.data.output;
        if (output) {
          const outputLines = output.split("\n").map((l) => ({
            type: "output" as const,
            text: l,
          }));
          setLines((prev) => [...prev, ...outputLines]);
        }
      } else {
        setLines((prev) => [
          ...prev,
          { type: "error", text: json.error || "Command failed" },
        ]);
      }
    } catch {
      setLines((prev) => [
        ...prev,
        { type: "error", text: "Network error — could not reach server" },
      ]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [appId]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !running) {
      execCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(idx);
        setInput(history[history.length - 1 - idx] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setInput(history[history.length - 1 - idx] || "");
      } else {
        setHistoryIdx(-1);
        setInput("");
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }

  function clearTerminal() {
    setLines([]);
  }

  const lineColor: Record<string, string> = {
    input: "text-emerald-400",
    output: "text-gray-300",
    error: "text-red-400",
    info: "text-gray-500",
  };

  return (
    <div className="bg-gray-950 border border-gray-700 rounded-xl flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">Terminal: {appName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearTerminal}
            className="text-gray-500 hover:text-gray-300 p-1.5"
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white p-1.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Output */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className={lineColor[line.type] || "text-gray-300"}>
            {line.text || "\u00A0"}
          </div>
        ))}
        {running && (
          <div className="text-gray-500 animate-pulse">Running...</div>
        )}
      </div>

      {/* Command suggestions */}
      {lines.length <= 4 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-gray-800/50">
          <span className="text-[10px] text-gray-600 mr-1 self-center">Quick:</span>
          {["ls", "env", "whoami", "cat /etc/os-release", "ps aux", "df -h", "free -h"].map((cmd) => (
            <button
              key={cmd}
              onClick={() => execCommand(cmd)}
              disabled={running}
              className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
            >
              {cmd}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center border-t border-gray-800 px-4 py-2 gap-2">
        <span className="text-emerald-400 font-mono text-sm">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="Type a command..."
          className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-gray-600 disabled:opacity-50"
          autoComplete="off"
          spellCheck="false"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={running || !input.trim()}
          onClick={() => execCommand(input)}
        >
          Run
        </Button>
      </div>
    </div>
  );
}
