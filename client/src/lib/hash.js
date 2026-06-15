/**
 * SHA-256 helpers using the Web Crypto API (SubtleCrypto).
 * Used to verify chunk and whole-file integrity before and after transfer.
 */

/** Compute the SHA-256 of an ArrayBuffer / TypedArray and return lowercase hex. */
export async function sha256Hex(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer ?? data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
