/**
 * Sender transfer engine.
 *
 * Lifecycle:
 *   1. prepare(file) — read the file once, compute the full-file SHA-256 and a
 *      per-chunk hash manifest (the "before transfer" integrity record).
 *   2. attach(channel) — called whenever a (re)connected data channel opens.
 *   3. On a RESUME message from the receiver, (re-)send the metadata then pump
 *      encrypted chunks from the requested index, honouring backpressure.
 *
 * Because prepare() keeps the file buffer and manifest in memory, resuming
 * after a dropped connection just means pointing the cursor at the receiver's
 * next-needed index and continuing — nothing already verified is re-sent.
 */

import {
  CHUNK_SIZE,
  HIGH_WATER,
  LOW_WATER,
  MSG,
  packFrame,
} from "./protocol.js";
import { sha256Hex } from "./hash.js";
import { encryptChunk } from "./crypto.js";

export function createSender({ key, onProgress, onComplete, onError }) {
  let buffer = null; // whole file as ArrayBuffer (<=50 MB)
  let meta = null; // metadata + manifest sent to the receiver
  let totalChunks = 0;
  let cursor = 0; // next chunk index to send
  let sentBytes = 0;
  let channel = null;
  let pumping = false;

  async function prepare(file) {
    buffer = await file.arrayBuffer();
    totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 0;

    // Hash the whole file and each chunk up front — verified after transfer.
    const fullHash = await sha256Hex(buffer);
    const chunkHashes = new Array(totalChunks);
    for (let i = 0; i < totalChunks; i++) {
      const slice = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      chunkHashes[i] = await sha256Hex(slice);
    }

    meta = {
      type: MSG.META,
      name: file.name,
      size: buffer.byteLength,
      mime: file.type || "application/octet-stream",
      chunkSize: CHUNK_SIZE,
      totalChunks,
      fullHash,
      chunkHashes,
      encrypted: true,
    };
    return meta;
  }

  // Resolve once the channel's send buffer has drained below the low watermark.
  function waitForDrain(ch) {
    return new Promise((resolve) => {
      ch.bufferedAmountLowThreshold = LOW_WATER;
      const onLow = () => {
        ch.removeEventListener("bufferedamountlow", onLow);
        resolve();
      };
      ch.addEventListener("bufferedamountlow", onLow);
    });
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (cursor < totalChunks) {
        const ch = channel;
        if (!ch || ch.readyState !== "open") {
          // Connection went away mid-transfer; stop. We'll resume on the next
          // RESUME message once the peer reconnects.
          pumping = false;
          return;
        }
        if (ch.bufferedAmount > HIGH_WATER) {
          await waitForDrain(ch);
          continue;
        }

        const start = cursor * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
        const slice = buffer.slice(start, end);
        const { iv, ciphertext } = await encryptChunk(key, slice);

        try {
          ch.send(packFrame(cursor, iv, ciphertext));
        } catch {
          pumping = false; // channel closed underneath us
          return;
        }

        sentBytes = end;
        onProgress?.(sentBytes);
        cursor++;
      }

      // All chunks delivered to the channel.
      channel?.send(JSON.stringify({ type: MSG.DONE }));
      onComplete?.();
    } catch (err) {
      onError?.(err.message || String(err));
    } finally {
      pumping = false;
    }
  }

  function handleMessage(data) {
    if (typeof data !== "string") return; // sender only expects control messages
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === MSG.RESUME) {
      cursor = Math.max(0, Math.min(msg.nextIndex || 0, totalChunks));
      channel?.send(JSON.stringify(meta)); // (re)send manifest, idempotent
      pump();
    } else if (msg.type === MSG.ERROR) {
      onError?.(msg.reason || "Receiver reported an error");
    }
  }

  return {
    prepare,
    /** Attach a freshly opened data channel (initial or after a resume). */
    attach(ch) {
      channel = ch;
      ch.onmessage = (e) => handleMessage(e.data);
      // The receiver drives resumption by sending RESUME on open, so we wait.
    },
    get totalBytes() {
      return buffer ? buffer.byteLength : 0;
    },
  };
}
