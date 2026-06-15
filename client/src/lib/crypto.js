/**
 * Zero-knowledge encryption (advanced feature).
 *
 * The sender generates a random AES-GCM 256-bit key in the browser, encrypts
 * every chunk before it leaves, and ships the key inside the URL hash fragment
 * (e.g. .../#/r/<roomId>/k/<key>). Browsers never transmit the hash fragment
 * over the network, and we never send it through the socket, so the signaling
 * server never sees the key — only the two peers can decrypt the file.
 *
 * Each chunk uses a fresh random 12-byte IV, prepended to its frame.
 */

import { IV_BYTES } from "./protocol.js";

/** Generate a fresh AES-GCM 256-bit key. */
export function generateKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** base64url encode an ArrayBuffer (URL-safe, no padding). */
function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url decode back to a Uint8Array. */
function fromBase64Url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Export a key to a short base64url string suitable for the URL hash. */
export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(raw);
}

/** Import a key from the base64url string found in the URL hash. */
export function importKey(b64) {
  const raw = fromBase64Url(b64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt one plaintext chunk. Returns { iv, ciphertext }. */
export async function encryptChunk(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return { iv, ciphertext };
}

/** Decrypt one chunk. Throws if the auth tag fails (tampered/corrupt data). */
export async function decryptChunk(key, iv, ciphertext) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}
