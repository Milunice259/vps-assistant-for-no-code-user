import clsx from "clsx";

interface DiskUsageProps {
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

export function DiskUsage({ total, used, available }: DiskUsageProps) {
  const percentage = total > 0 ? (used / total) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">Disk</span>
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
      <div className="flex justify-between text-xs text-gray-500">
        <span>{clamped.toFixed(1)}% used</span>
        <span>{formatBytes(available)} available</span>
      </div>
    </div>
  );
}
