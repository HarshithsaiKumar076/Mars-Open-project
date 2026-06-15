/**
 * Wire protocol shared by sender and receiver.
 *
 * Two kinds of messages travel over the WebRTC data channel:
 *
 *   1. Control messages — JSON strings: { type, ...fields }
 *   2. Data frames       — binary ArrayBuffers carrying one encrypted chunk
 *
 * The receiver tells them apart by checking `typeof event.data`.
 *
 * Binary frame layout (all big-endian):
 *   [ 4 bytes  ] chunk index (uint32)
 *   [ 12 bytes ] AES-GCM initialisation vector (unique per chunk)
 *   [ N bytes  ] ciphertext (includes the 16-byte GCM auth tag)
 */

export const CHUNK_SIZE = 64 * 1024; // 64 KB plaintext per chunk
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB MVP limit
export const HIGH_WATER = 8 * 1024 * 1024; // pause sending above this buffered amount
export const LOW_WATER = 1 * 1024 * 1024; // resume sending below this

export const IV_BYTES = 12;
export const INDEX_BYTES = 4;

// Control message types.
export const MSG = {
  META: "meta", // sender -> receiver: file metadata + integrity manifest
  RESUME: "resume", // receiver -> sender: "send me chunks starting at nextIndex"
  DONE: "done", // sender -> receiver: all chunks sent
  ERROR: "error", // either direction: fatal problem
};

/** Pack one encrypted chunk into a single binary frame. */
export function packFrame(index, iv, ciphertext) {
  const ct = new Uint8Array(ciphertext);
  const frame = new Uint8Array(INDEX_BYTES + IV_BYTES + ct.byteLength);
  new DataView(frame.buffer).setUint32(0, index, false); // big-endian index
  frame.set(iv, INDEX_BYTES);
  frame.set(ct, INDEX_BYTES + IV_BYTES);
  return frame.buffer;
}

/** Parse a binary frame back into { index, iv, ciphertext }. */
export function unpackFrame(buffer) {
  const bytes = new Uint8Array(buffer);
  const index = new DataView(buffer).getUint32(0, false);
  const iv = bytes.slice(INDEX_BYTES, INDEX_BYTES + IV_BYTES);
  const ciphertext = bytes.slice(INDEX_BYTES + IV_BYTES);
  return { index, iv, ciphertext };
}
