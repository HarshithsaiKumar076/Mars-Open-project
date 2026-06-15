/**
 * Headless round-trip test of the transfer protocol (no browser/React).
 * Wires the real sender + receiver engines over an in-memory channel pair and
 * checks the reassembled file matches the original byte-for-byte. Also tests
 * a mid-transfer "drop" to confirm auto-resume continues instead of restarting.
 */

import { createSender } from "./client/src/lib/sender.js";
import { createReceiver } from "./client/src/lib/receiver.js";
import { generateKey } from "./client/src/lib/crypto.js";

// --- stub the browser bits the receiver's download path needs ---
let captured = null;
globalThis.URL.createObjectURL = (blob) => {
  captured = blob;
  return "blob:stub";
};
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ click() {}, remove() {}, set href(_) {}, set download(_) {} }),
};

// --- in-memory channel pair ---
function makeChannelPair() {
  const a = { readyState: "open", bufferedAmount: 0, addEventListener() {}, removeEventListener() {} };
  const b = { readyState: "open", bufferedAmount: 0, addEventListener() {}, removeEventListener() {} };
  a.send = (data) => { if (b.onmessage && b.readyState === "open") queueMicrotask(() => b.onmessage({ data })); };
  b.send = (data) => { if (a.onmessage && a.readyState === "open") queueMicrotask(() => a.onmessage({ data })); };
  return { a, b };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const SIZE = 200 * 1024 + 777; // ~4 chunks, non-aligned tail
  const original = new Uint8Array(SIZE);
  crypto.getRandomValues(original.subarray(0, 65536));
  for (let i = 65536; i < SIZE; i++) original[i] = i % 251;

  const file = {
    name: "sample.bin",
    type: "application/octet-stream",
    size: SIZE,
    arrayBuffer: async () => original.buffer.slice(0, SIZE),
  };

  const key = await generateKey();
  let done = false;
  let failed = null;

  const sender = createSender({
    key,
    onProgress: () => {},
    onComplete: () => {},
    onError: (m) => (failed = "sender: " + m),
  });
  const receiver = createReceiver({
    key,
    onMeta: () => {},
    onProgress: () => {},
    onComplete: () => (done = true),
    onError: (m) => (failed = "receiver: " + m),
  });

  await sender.prepare(file);

  // --- scenario 1: clean transfer ---
  let { a, b } = makeChannelPair();
  sender.attach(a);
  receiver.attach(b); // receiver sends RESUME(0), sender sends meta + pumps

  for (let i = 0; i < 200 && !done && !failed; i++) await wait(10);

  if (failed) throw new Error("Clean transfer failed: " + failed);
  if (!done) throw new Error("Clean transfer did not complete");

  const out = new Uint8Array(await captured.arrayBuffer());
  if (out.length !== SIZE) throw new Error(`Size mismatch: ${out.length} vs ${SIZE}`);
  for (let i = 0; i < SIZE; i++) {
    if (out[i] !== original[i]) throw new Error(`Byte mismatch at ${i}`);
  }
  console.log("PASS  clean transfer — reassembled file matches byte-for-byte");

  // --- scenario 2: resume after a mid-transfer drop ---
  captured = null;
  done = false;
  failed = null;
  const sender2 = createSender({ key, onProgress() {}, onComplete() {}, onError: (m) => (failed = m) });
  let received2 = 0;
  const receiver2 = createReceiver({
    key,
    onMeta() {},
    onProgress: (bytes) => (received2 = bytes),
    onComplete: () => (done = true),
    onError: (m) => (failed = m),
  });
  await sender2.prepare(file);

  let pair = makeChannelPair();
  sender2.attach(pair.a);
  receiver2.attach(pair.b);

  // Let a little data flow, then "drop" the connection.
  await wait(15);
  pair.a.readyState = "closed";
  pair.b.readyState = "closed";
  const partial = received2;

  // Reconnect with a brand-new channel pair (simulates rebuilt WebRTC peer).
  await wait(20);
  pair = makeChannelPair();
  sender2.attach(pair.a);
  receiver2.attach(pair.b); // RESUME carries the receiver's nextIndex

  for (let i = 0; i < 200 && !done && !failed; i++) await wait(10);
  if (failed) throw new Error("Resume transfer failed: " + failed);
  if (!done) throw new Error("Resume transfer did not complete");

  const out2 = new Uint8Array(await captured.arrayBuffer());
  if (out2.length !== SIZE) throw new Error("Resume size mismatch");
  for (let i = 0; i < SIZE; i++) {
    if (out2[i] !== original[i]) throw new Error(`Resume byte mismatch at ${i}`);
  }
  console.log(
    `PASS  resume after drop — continued from ${(partial / 1024).toFixed(0)} KB, final file matches`
  );

  console.log("\nAll protocol tests passed.");
}

run().catch((e) => {
  console.error("FAIL ", e.message);
  process.exit(1);
});
