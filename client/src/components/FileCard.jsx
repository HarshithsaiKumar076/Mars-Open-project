/** Shows the file being transferred: name, size, type, and integrity state. */

import { formatBytes } from "../lib/format.js";

export default function FileCard({ meta, verified }) {
  if (!meta) return null;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xl text-slate-300">
        ⛁
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-100">{meta.name}</p>
        <p className="text-sm text-slate-400">
          {formatBytes(meta.size)} · {meta.totalChunks} chunks ·{" "}
          {meta.mime || "unknown type"}
        </p>
      </div>
      {meta.encrypted && (
        <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-teal-300">
          encrypted
        </span>
      )}
      {verified && (
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
          verified ✓
        </span>
      )}
    </div>
  );
}
