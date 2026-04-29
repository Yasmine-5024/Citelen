import { useRef, useState } from "react";

const COLORS = {
  bg: "#0a0e1a",
  accent: "#6366f1",
  accentGlow: "rgba(99, 102, 241, 0.15)",
  text: "#f1f5f9",
  textDim: "#64748b",
  border: "#1e293b",
  card: "#151d2e",
};

export default function UploadScreen({ onUpload }: { onUpload: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") onUpload(file);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: COLORS.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", maxWidth: 520, padding: 40 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 40 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 800, color: "white",
          }}>R</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>
            RefLens <span style={{ color: COLORS.textDim, fontWeight: 400, fontSize: 16 }}>Citation Audit</span>
          </div>
        </div>

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? COLORS.accent : COLORS.border}`,
            borderRadius: 20,
            padding: "60px 40px",
            cursor: "pointer",
            background: dragging ? COLORS.accentGlow : COLORS.card,
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: 52, marginBottom: 16 }}>📄</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>
            Drop your PDF here
          </div>
          <div style={{ fontSize: 14, color: COLORS.textDim }}>
            or click to browse
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </div>

        <p style={{ fontSize: 13, color: COLORS.textDim, marginTop: 24 }}>
          Upload any academic paper — RefLens will analyze all citations for AI generation,
          reliability, missing references, and more.
        </p>
      </div>
    </div>
  );
}
