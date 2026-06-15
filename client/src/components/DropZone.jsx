/** Drag-and-drop / click-to-pick zone for choosing the file to send. */

import { useRef, useState } from "react";

export default function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files) {
    if (files && files[0]) onFile(files[0]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled)
          inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-16 text-center transition
        ${dragging ? "border-teal-400 bg-teal-400/5" : "border-slate-700 hover:border-slate-500"}
        ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-2xl text-teal-300 transition group-hover:bg-slate-700">
        ↑
      </div>
      <p className="text-base font-medium text-slate-100">
        Drop a file to beam it
      </p>
      <p className="mt-1 text-sm text-slate-400">
        or click to choose · up to 50 MB
      </p>
    </div>
  );
}
