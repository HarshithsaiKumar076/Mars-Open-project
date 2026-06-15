/** Real-time transfer progress: percentage, speed, bytes moved, and ETA. */

import { formatBytes, formatSpeed, formatEta } from "../lib/format.js";

export default function ProgressBar({ progress, transferred, total, speed, status }) {
  const pct = Math.round(progress * 100);
  const stalled = status === "reconnecting";
  return (
    <div className="space-y-3">
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            stalled ? "bg-amber-400" : "bg-teal-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 font-mono text-sm">
        <span className="text-slate-100">{pct}%</span>
        <span className="text-slate-400">
          {formatBytes(transferred)} / {formatBytes(total)}
        </span>
        <span className="text-slate-400">
          {stalled ? "paused" : formatSpeed(speed)}
        </span>
        <span className="text-slate-400">
          ETA {stalled ? "—" : formatEta(total - transferred, speed)}
        </span>
      </div>
    </div>
  );
}
