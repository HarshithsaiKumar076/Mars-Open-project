/** A small pill that reflects the live connection / transfer status. */

const MAP = {
  idle: { label: "Ready", tone: "muted" },
  creating: { label: "Preparing", tone: "busy" },
  waiting: { label: "Waiting for peer", tone: "busy" },
  connecting: { label: "Connecting", tone: "busy" },
  transferring: { label: "Transferring", tone: "live" },
  reconnecting: { label: "Reconnecting", tone: "warn" },
  completed: { label: "Complete", tone: "ok" },
  disconnected: { label: "Disconnected", tone: "warn" },
  error: { label: "Error", tone: "bad" },
};

const TONE = {
  muted: "bg-slate-700/40 text-slate-300",
  busy: "bg-sky-500/15 text-sky-300",
  live: "bg-teal-500/15 text-teal-300",
  warn: "bg-amber-500/15 text-amber-300",
  ok: "bg-emerald-500/15 text-emerald-300",
  bad: "bg-rose-500/15 text-rose-300",
};

export default function ConnectionStatus({ status }) {
  const s = MAP[status] || MAP.idle;
  const pulsing = s.tone === "live" || s.tone === "busy" || s.tone === "warn";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium tracking-wide ${TONE[s.tone]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${pulsing ? "animate-pulse" : ""}`}
      />
      {s.label}
    </span>
  );
}
