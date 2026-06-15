/** Human-readable byte and rate formatting used across the UI. */

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec) {
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`;
}

export function formatEta(remainingBytes, bytesPerSec) {
  if (!bytesPerSec) return "—";
  const secs = Math.ceil(remainingBytes / bytesPerSec);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
