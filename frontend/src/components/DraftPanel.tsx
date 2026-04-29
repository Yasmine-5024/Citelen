import { useEffect, useRef, useState } from "react";

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

interface DraftPanelProps {
  pdfHash: string | null;
  paperTitle: string | null;
  user: { id: number; email: string; name: string } | null;
}

export default function DraftPanel({ pdfHash, paperTitle, user }: DraftPanelProps) {
  const [content, setContent] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load draft on mount
  useEffect(() => {
    if (!pdfHash || !user) return;
    const token = localStorage.getItem("reflens_token");
    fetch(`http://localhost:5000/draft/${pdfHash}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.content != null) {
          setContent(data.content);
          setSavedAt(data.updated_at ?? null);
        }
      })
      .catch(() => {});
  }, [pdfHash, user]);

  const saveDraft = async (text: string) => {
    if (!pdfHash || !user) return;
    setSaving(true);
    try {
      const token = localStorage.getItem("reflens_token");
      const res = await fetch(`http://localhost:5000/draft/${pdfHash}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setSavedAt(new Date().toISOString());
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    if (!user || !pdfHash) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveDraft(val), 1500);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const formatSavedAt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  if (!pdfHash) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: C.textDim, fontSize: 14, textAlign: "center", padding: 32,
      }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>✏️</div>
        <div style={{ fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>Review Draft</div>
        <div>Upload a paper to start writing your review draft</div>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: C.bg, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: `1px solid ${C.cardBorder}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Review Draft</div>
          {paperTitle && (
            <div style={{
              fontSize: 11, color: C.textDim, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 260,
            }}>
              {paperTitle}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Word count */}
          <span style={{ fontSize: 11, color: C.textDim }}>
            {wordCount} word{wordCount !== 1 ? "s" : ""}
          </span>

          {/* Save status */}
          {user && (
            <span style={{ fontSize: 11, color: saving ? C.textDim : C.green }}>
              {saving ? "Saving…" : savedAt ? `Saved ${formatSavedAt(savedAt)}` : "Unsaved"}
            </span>
          )}

          {/* Manual save */}
          {user && (
            <button
              onClick={() => saveDraft(content)}
              disabled={saving}
              style={{
                padding: "5px 12px",
                background: "transparent",
                border: `1px solid ${C.cardBorder}`,
                borderRadius: 7, color: C.textMuted,
                fontSize: 11, cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent;
                (e.currentTarget as HTMLButtonElement).style.color = C.text;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.cardBorder;
                (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
              }}
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Textarea */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <textarea
          value={content}
          onChange={handleChange}
          placeholder={`Write your review for "${paperTitle ?? "this paper"}" here…\n\nYou can structure it as:\n\nSummary:\n\nStrengths:\n\nWeaknesses:\n\nQuestions for authors:\n\nRecommendation:`}
          style={{
            flex: 1, background: "transparent", border: "none",
            color: C.text, fontSize: 13.5, lineHeight: 1.8,
            padding: "20px 18px", outline: "none", resize: "none",
            fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
            caretColor: C.accent,
          }}
        />
      </div>

      {/* Footer */}
      {!user && (
        <div style={{
          padding: "10px 16px",
          borderTop: `1px solid ${C.cardBorder}`,
          background: C.surface,
          fontSize: 11, color: C.textDim, textAlign: "center",
          flexShrink: 0,
        }}>
          Sign in to save your drafts across sessions
        </div>
      )}
    </div>
  );
}
