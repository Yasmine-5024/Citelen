import { useEffect, useRef, useState, useCallback } from "react";

const C = {
  bg: "#0a0e1a",
  surface: "#0f1624",
  card: "#111827",
  cardBorder: "#1e293b",
  accent: "#6366f1",
  green: "#10b981",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#64748b",
};

interface ReviewRecord {
  pdf_hash: string;
  paper_title: string;
  paper_authors: string[];
  uploaded_at: string;
  last_accessed: string;
}

interface User {
  id: number;
  email: string;
  name: string;
  institution: string;
}

interface HistoryPageProps {
  user: User;
  onUpload: (file: File) => void;
  onOpenFromHistory: (hash: string, title: string) => void;
  onLogout: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function HistoryPage({ user, onUpload, onOpenFromHistory, onLogout }: HistoryPageProps) {
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingHash, setOpeningHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCardClick = useCallback((record: ReviewRecord) => {
    setOpeningHash(record.pdf_hash);
    onOpenFromHistory(record.pdf_hash, record.paper_title);
  }, [onOpenFromHistory]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpload(file);
    e.target.value = "";
  };

  useEffect(() => {
    const token = localStorage.getItem("reflens_token");
    fetch("http://localhost:5000/history", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (data.reviews) setHistory(data.reviews); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      color: C.text,
    }}>
      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${C.cardBorder}`,
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: C.surface,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>🔬</div>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Reflens</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
            {user.institution && (
              <div style={{ fontSize: 11, color: C.textDim }}>{user.institution}</div>
            )}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: "7px 16px",
              background: "transparent",
              border: `1px solid ${C.cardBorder}`,
              borderRadius: 8, color: C.textMuted,
              fontSize: 13, cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.textMuted;
              (e.currentTarget as HTMLButtonElement).style.color = C.text;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.cardBorder;
              (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>

        {/* Welcome + new review */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 36 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
              Welcome back, {user.name.split(" ")[0]}
            </h2>
            <p style={{ color: C.textMuted, fontSize: 14, marginTop: 6 }}>
              {history.length > 0
                ? `${history.length} paper${history.length !== 1 ? "s" : ""} reviewed`
                : "Start by uploading a paper to review"}
            </p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "13px 24px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none", borderRadius: 12,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(99,102,241,0.3)",
              display: "flex", alignItems: "center", gap: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>+</span> New Review
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        {/* History list */}
        {loading ? (
          <div style={{ textAlign: "center", color: C.textDim, padding: 60, fontSize: 14 }}>
            Loading your history…
          </div>
        ) : history.length === 0 ? (
          <div style={{
            border: `2px dashed ${C.cardBorder}`,
            borderRadius: 16, padding: "60px 40px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textMuted }}>No reviews yet</div>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 8 }}>
              Upload a PDF to start your first analysis
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {history.map(record => (
              <div
                key={record.pdf_hash}
                onClick={() => handleCardClick(record)}
                style={{
                  background: C.card,
                  border: `1px solid ${C.cardBorder}`,
                  borderRadius: 14,
                  padding: "20px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = C.accent;
                  (e.currentTarget as HTMLDivElement).style.background = "#151d2e";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = C.cardBorder;
                  (e.currentTarget as HTMLDivElement).style.background = C.card;
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginBottom: 4,
                  }}>
                    {record.paper_title || "Untitled Paper"}
                  </div>
                  {record.paper_authors?.length > 0 && (
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>
                      {record.paper_authors.slice(0, 3).join(", ")}
                      {record.paper_authors.length > 3 && ` +${record.paper_authors.length - 3} more`}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.textDim }}>
                    Last reviewed {formatDate(record.last_accessed)}
                    {" · "}First uploaded {formatDate(record.uploaded_at)}
                  </div>
                </div>

                <div style={{
                  padding: "8px 18px",
                  background: openingHash === record.pdf_hash ? "rgba(99,102,241,0.15)" : "transparent",
                  border: `1px solid ${C.accent}`,
                  borderRadius: 8, color: C.accent,
                  fontSize: 12, fontWeight: 600,
                  flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 6,
                  minWidth: 90, justifyContent: "center",
                }}>
                  {openingHash === record.pdf_hash ? "Opening…" : "Open →"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
