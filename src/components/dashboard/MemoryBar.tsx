import clsx from "clsx";

interface MemoryBarProps {
  total: number;
  used: number;
  available: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)} ${units[i]}`;
}

export function MemoryBar({ total, used }: MemoryBarProps) {
  const percentage = total > 0 ? (used / total) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">Memory</span>
        <span className="text-gray-400">
          {formatBytes(used)} / {formatBytes(total)}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-500",
            clamped < 50
              ? "bg-emerald-500"
              : clamped <= 80
                ? "bg-yellow-500"
                : "bg-red-500"
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="text-right text-xs text-gray-500">
        {clamped.toFixed(1)}% used
      </p>
    </div>
  );
}
