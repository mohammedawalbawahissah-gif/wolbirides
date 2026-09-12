import { useRef, useState, type DragEvent } from "react";
import { api } from "../api/client";
import "./FileDrop.css";

type UploadState = "idle" | "uploading" | "done" | "error";

export default function FileDrop({
  kind,
  label,
  hint,
  value,
  onChange,
}: {
  kind: string;
  label: string;
  hint?: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [state, setState] = useState<UploadState>(value ? "done" : "idle");
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setState("uploading");
    setErrorMsg("");
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    try {
      const { data } = await api.post<{ url: string }>("/uploads/document", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange(data.url);
      setState("done");
    } catch (err: any) {
      setState("error");
      setErrorMsg(err?.response?.data?.detail || "Upload failed — check the file and try again.");
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) upload(file);
  }

  return (
    <div className="file-drop-field">
      <label className="field-label">{label}</label>

      <div
        className={`file-drop${dragOver ? " file-drop-over" : ""}${state === "done" ? " file-drop-done" : ""}`}
        onClick={() => state !== "uploading" && inputRef.current?.click()}
        onDragOver={(e: DragEvent) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />

        {state === "idle" && (
          <>
            <div className="file-drop-icon">⬆</div>
            <div className="file-drop-text">Drag a photo here, or click to choose a file</div>
          </>
        )}

        {state === "uploading" && (
          <>
            <div className="file-drop-spinner" />
            <div className="file-drop-text">Uploading…</div>
          </>
        )}

        {state === "done" && value && (
          <div className="file-drop-preview">
            {/\.(png|jpe?g|webp|gif)$/i.test(value) ? (
              <img src={value} alt="" />
            ) : (
              <div className="file-drop-doc-chip">📄 Document uploaded</div>
            )}
            <span className="file-drop-check">✓</span>
            <button
              type="button"
              className="file-drop-replace"
              onClick={(e) => { e.stopPropagation(); setState("idle"); onChange(null); }}
            >
              Replace
            </button>
          </div>
        )}

        {state === "error" && (
          <>
            <div className="file-drop-icon file-drop-icon-error">!</div>
            <div className="file-drop-text">{errorMsg}</div>
          </>
        )}
      </div>

      {hint && state === "idle" && <div className="file-drop-hint">{hint}</div>}
    </div>
  );
}
