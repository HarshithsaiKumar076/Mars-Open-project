/**
 * App — top-level UI.
 *
 * One component handles both roles. The hook tells us whether we're the sender
 * (home page) or the receiver (opened a share link), and the current status
 * decides what to render.
 */

import { useTransfer } from "./hooks/useTransfer.js";
import DropZone from "./components/DropZone.jsx";
import RoomPanel from "./components/RoomPanel.jsx";
import FileCard from "./components/FileCard.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ConnectionStatus from "./components/ConnectionStatus.jsx";

/** The signature element: two endpoints with a link that lights up live. */
function Beam({ active }) {
  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <Node label="you" />
      <div className="relative h-px w-24 bg-slate-700">
        <div
          className={`absolute inset-0 origin-left bg-teal-400 transition-transform duration-500 ${
            active ? "animate-pulse scale-x-100" : "scale-x-0"
          }`}
        />
      </div>
      <Node label="peer" />
    </div>
  );
}

function Node({ label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="h-3 w-3 rounded-full border border-teal-400 bg-slate-900" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
        {label}
      </span>
    </div>
  );
}

export default function App() {
  const t = useTransfer();
  const active = t.status === "transferring";

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">
            Beam
          </h1>
          <p className="font-mono text-xs text-slate-500">
            direct browser-to-browser transfer
          </p>
        </div>
        <ConnectionStatus status={t.status} />
      </header>

      <main className="flex-1 space-y-6">
        <Beam active={active} />

        {t.error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {t.error}
          </div>
        )}

        {/* SENDER — pick a file */}
        {t.mode === "sender" && t.status === "idle" && (
          <DropZone onFile={t.selectFile} />
        )}

        {/* Shared — file details once known */}
        {t.fileMeta && <FileCard meta={t.fileMeta} verified={t.verified} />}

        {/* SENDER — share link while waiting */}
        {t.mode === "sender" && t.status === "waiting" && (
          <RoomPanel link={t.roomLink} />
        )}

        {/* Live progress for any in-flight or finished transfer */}
        {["transferring", "reconnecting", "completed"].includes(t.status) && (
          <ProgressBar
            progress={t.progress}
            transferred={t.transferred}
            total={t.total}
            speed={t.speed}
            status={t.status}
          />
        )}

        {/* Status line */}
        {t.statusMessage && (
          <p className="text-center text-sm text-slate-400">{t.statusMessage}</p>
        )}

        {/* RECEIVER — early connecting state with no file yet */}
        {t.mode === "receiver" &&
          !t.fileMeta &&
          t.status !== "error" && (
            <p className="text-center text-sm text-slate-500">
              Waiting for the sender to start the transfer…
            </p>
          )}

        {(t.status === "completed" || t.status === "disconnected") && (
          <div className="flex justify-center pt-2">
            <button
              onClick={t.reset}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500"
            >
              {t.mode === "sender" ? "Send another file" : "Done"}
            </button>
          </div>
        )}
      </main>

      <footer className="mt-10 text-center font-mono text-xs text-slate-600">
        end-to-end encrypted · server never sees your file
      </footer>
    </div>
  );
}
