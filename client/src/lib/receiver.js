/**
 * Receiver transfer engine.
 *
 * On every (re)connected data channel it sends a RESUME message telling the
 * sender which chunk to start from. Incoming frames are processed through a
 * serial queue (decryption is async, so this guarantees in-order handling),
 * each chunk is decrypted, its SHA-256 verified against the sender's manifest,
 * and stored. When DONE arrives the file is reassembled, the whole-file hash is
 * re-verified, and the download is triggered automatically.
 *
 * Verified chunks live in memory across reconnects, so a dropped transfer
 * resumes from where it left off instead of restarting at 0%.
 */

import { MSG, unpackFrame } from "./protocol.js";
import { sha256Hex } from "./hash.js";
import { decryptChunk } from "./crypto.js";

export function createReceiver({ key, onMeta, onProgress, onComplete, onError }) {
  let meta = null;
  let chunks = []; // chunks[index] = decrypted ArrayBuffer
  let nextIndex = 0; // first chunk we still need (chunks arrive in order)
  let receivedBytes = 0;
  let channel = null;
  let finished = false;

  // Serial processing queue so async decryption can't reorder chunks.
  const queue = [];
  let draining = false;

  function enqueue(data) {
    queue.push(data);
    drain();
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const data = queue.shift();
      try {
        await handle(data);
      } catch (err) {
        onError?.(err.message || String(err));
      }
    }
    draining = false;
  }

  async function handle(data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.type === MSG.META) {
        if (!meta) {
          meta = msg;
          chunks = new Array(meta.totalChunks);
        }
        onMeta?.(meta);
      } else if (msg.type === MSG.DONE) {
        await finalize();
      }
      return;
    }

    // Binary frame: one encrypted chunk.
    const { index, iv, ciphertext } = unpackFrame(data);
    if (!meta) return; // shouldn't happen; META always precedes frames
    if (chunks[index] !== undefined) return; // duplicate (possible after resume)

    const plaintext = await decryptChunk(key, iv, ciphertext);

    // Integrity check against the manifest ("after transfer" verification).
    const hex = await sha256Hex(plaintext);
    if (hex !== meta.chunkHashes[index]) {
      onError?.(`Chunk ${index} failed its integrity check`);
      channel?.send(JSON.stringify({ type: MSG.ERROR, reason: "chunk hash mismatch" }));
      return;
    }

    chunks[index] = plaintext;
    receivedBytes += plaintext.byteLength;
    while (chunks[nextIndex] !== undefined) nextIndex++;
    onProgress?.(receivedBytes);
  }

  async function finalize() {
    if (finished) return;
    // Make sure nothing is missing before assembling.
    for (let i = 0; i < meta.totalChunks; i++) {
      if (chunks[i] === undefined) return; // wait — a resume will refill gaps
    }

    const blob = new Blob(chunks, { type: meta.mime });
    const fullHex = await sha256Hex(await blob.arrayBuffer());
    if (fullHex !== meta.fullHash) {
      onError?.("Whole-file integrity check failed");
      return;
    }

    finished = true;
    triggerDownload(blob, meta.name);
    onComplete?.(meta);
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return {
    /** Attach a freshly opened data channel and request (re)transmission. */
    attach(ch) {
      channel = ch;
      ch.onmessage = (e) => enqueue(e.data);
      // Tell the sender where to (re)start. nextIndex is 0 on first connect.
      ch.send(JSON.stringify({ type: MSG.RESUME, nextIndex }));
    },
    get meta() {
      return meta;
    },
    get receivedBytes() {
      return receivedBytes;
    },
  };
}
