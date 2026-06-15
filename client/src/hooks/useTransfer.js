/**
 * useTransfer — the orchestration hook.
 *
 * Detects whether this browser is the sender (home page) or the receiver
 * (opened a share link), wires the signaling + WebRTC + transfer engines
 * together, and exposes a single piece of UI state plus a couple of actions.
 *
 * Share-link format (everything in the hash, so no SPA server rewrites and the
 * key never leaves the browser):  origin/#/r/<roomId>/k/<base64urlKey>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createSignaling } from "../lib/signaling.js";
import { createPeer } from "../lib/webrtc.js";
import { createSender } from "../lib/sender.js";
import { createReceiver } from "../lib/receiver.js";
import { generateKey, exportKey, importKey } from "../lib/crypto.js";
import { MAX_FILE_SIZE } from "../lib/protocol.js";

const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";

// How long we wait for a dropped peer before declaring the link dead.
const RECONNECT_GRACE_MS = 30 * 1000;

function parseHash() {
  const m = window.location.hash.match(/^#\/r\/([^/]+)\/k\/(.+)$/);
  return m ? { roomId: m[1], keyB64: m[2] } : null;
}

export function useTransfer() {
  const linkInfo = useRef(parseHash());
  const isReceiver = !!linkInfo.current;

  const [status, setStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [fileMeta, setFileMeta] = useState(null);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(0); // bytes / second
  const [roomLink, setRoomLink] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  const sig = useRef(null);
  const peer = useRef(null);
  const engine = useRef(null);
  const key = useRef(null);
  const lastRestart = useRef(0);
  const watchdog = useRef(null);

  // --- live speed sampler ----------------------------------------------
  const sample = useRef({ bytes: 0, t: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      if (sample.current.t) {
        const dt = (now - sample.current.t) / 1000;
        const db = transferred - sample.current.bytes;
        if (dt > 0) setSpeed(Math.max(0, db / dt));
      }
      sample.current = { bytes: transferred, t: now };
    }, 600);
    return () => clearInterval(id);
  }, [transferred]);

  const clearWatchdog = () => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  };

  const startWatchdog = useCallback(() => {
    clearWatchdog();
    watchdog.current = setTimeout(() => {
      setStatus((s) =>
        s === "completed" ? s : "disconnected"
      );
      setStatusMessage("The other person left. Transfer paused.");
    }, RECONNECT_GRACE_MS);
  }, []);

  // --- shared connection-state handling --------------------------------
  const onConnectionState = useCallback(
    (state) => {
      if (state === "connected") {
        clearWatchdog();
        setStatus((s) => (s === "completed" ? s : "transferring"));
        setStatusMessage("");
      } else if (state === "failed") {
        // The initiator (sender) rebuilds; the receiver waits for a new offer.
        setStatus((s) => (s === "completed" ? s : "reconnecting"));
        setStatusMessage("Connection lost — trying to resume…");
        startWatchdog();
        if (!isReceiver && Date.now() - lastRestart.current > 1500) {
          lastRestart.current = Date.now();
          peer.current?.restart();
        }
      } else if (state === "disconnected") {
        setStatus((s) => (s === "completed" ? s : "reconnecting"));
        setStatusMessage("Connection unstable — trying to resume…");
      }
    },
    [isReceiver, startWatchdog]
  );

  // ---------------------------------------------------------------------
  // RECEIVER: auto-connect on mount
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!isReceiver) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("connecting");
        setStatusMessage("Connecting to sender…");
        key.current = await importKey(linkInfo.current.keyB64);

        engine.current = createReceiver({
          key: key.current,
          onMeta: (m) => {
            setFileMeta(m);
            setTotal(m.size);
          },
          onProgress: (bytes) => setTransferred(bytes),
          onComplete: () => {
            setVerified(true);
            setStatus("completed");
            setStatusMessage("Download complete and verified.");
          },
          onError: (msg) => {
            setError(msg);
            setStatus("error");
          },
        });

        sig.current = createSignaling(SIGNALING_URL);
        peer.current = createPeer({
          signaling: sig.current,
          initiator: false,
          onChannelOpen: (ch) => engine.current.attach(ch),
          onConnectionState,
        });

        sig.current.on("peerDisconnected", () => {
          setStatus("reconnecting");
          setStatusMessage("Sender dropped — waiting to resume…");
          startWatchdog();
        });

        await sig.current.joinRoom(linkInfo.current.roomId);
        if (cancelled) return;
        // The sender will send us an offer now that we've joined.
      } catch (err) {
        if (!cancelled) {
          setError(err.message || String(err));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      clearWatchdog();
      peer.current?.close();
      sig.current?.disconnect();
    };
  }, [isReceiver, onConnectionState, startWatchdog]);

  // ---------------------------------------------------------------------
  // SENDER: triggered when the user picks a file
  // ---------------------------------------------------------------------
  const selectFile = useCallback(
    async (file) => {
      setError("");
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        setError(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 50 MB.`
        );
        return;
      }

      try {
        setStatus("creating");
        setStatusMessage("Preparing your file…");

        key.current = await generateKey();
        engine.current = createSender({
          key: key.current,
          onProgress: (bytes) => setTransferred(bytes),
          onComplete: () => {
            setStatus("completed");
            setStatusMessage("File delivered and verified.");
          },
          onError: (msg) => {
            setError(msg);
            setStatus("error");
          },
        });

        const meta = await engine.current.prepare(file);
        setFileMeta(meta);
        setTotal(meta.size);

        sig.current = createSignaling(SIGNALING_URL);
        peer.current = createPeer({
          signaling: sig.current,
          initiator: true,
          onChannelOpen: (ch) => engine.current.attach(ch),
          onConnectionState,
        });

        // Peer lifecycle from the signaling server.
        sig.current.on("peerJoined", () => {
          setStatus("connecting");
          setStatusMessage("Receiver joined — connecting…");
          peer.current.start();
        });
        sig.current.on("peerRejoined", () => {
          if (Date.now() - lastRestart.current > 1500) {
            lastRestart.current = Date.now();
            setStatus("reconnecting");
            setStatusMessage("Receiver reconnected — resuming…");
            peer.current.restart();
          }
        });
        sig.current.on("peerDisconnected", () => {
          setStatus("reconnecting");
          setStatusMessage("Receiver dropped — waiting to resume…");
          startWatchdog();
        });

        const roomId = await sig.current.createRoom();
        const keyB64 = await exportKey(key.current);
        const link = `${window.location.origin}${window.location.pathname}#/r/${roomId}/k/${keyB64}`;
        setRoomLink(link);
        setStatus("waiting");
        setStatusMessage("Share the link. Waiting for the receiver…");
      } catch (err) {
        setError(err.message || String(err));
        setStatus("error");
      }
    },
    [onConnectionState, startWatchdog]
  );

  const reset = useCallback(() => {
    clearWatchdog();
    peer.current?.close();
    sig.current?.disconnect();
    window.location.hash = "";
    window.location.reload();
  }, []);

  const progress = total > 0 ? Math.min(1, transferred / total) : 0;

  return {
    mode: isReceiver ? "receiver" : "sender",
    status,
    statusMessage,
    fileMeta,
    transferred,
    total,
    progress,
    speed,
    roomLink,
    error,
    verified,
    selectFile,
    reset,
  };
}
