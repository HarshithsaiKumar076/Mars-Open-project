/** Share-link panel shown to the sender while waiting for a receiver. */

import { useState } from "react";

export default function RoomPanel({ link }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable on insecure origins */
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-sm text-slate-400">
        Send this link to the person receiving the file. The decryption key lives
        in the link itself and never reaches the server.
      </p>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
        />
        <button
          onClick={copy}
          className="shrink-0 rounded-lg bg-teal-400 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-teal-300"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
