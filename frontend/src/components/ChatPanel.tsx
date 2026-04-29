import { useEffect, useRef, useState } from "react";

const C = {
  bg: "#0a0e1a",
  surface: "#0f1624",
  card: "#111827",
  cardBorder: "#1e293b",
  accent: "#6366f1",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#64748b",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  pdfHash: string | null;
  paperTitle: string | null;
  user: { id: number; email: string; name: string } | null;
}

const SUGGESTIONS = [
  "Why were some citations flagged?",
  "Summarize the main issues found",
  "Which citations are most suspicious?",
  "Are there any missing key references?",
  "Help me write a weakness for my review",
];

export default function ChatPanel({ pdfHash, paperTitle, user }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load saved chat history
  useEffect(() => {
    if (!pdfHash || !user) { setHistoryLoaded(true); return; }
    const token = localStorage.getItem("reflens_token");
    fetch(`http://localhost:5000/chat/${pdfHash}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (data.messages?.length) setMessages(data.messages); })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [pdfHash, user]);

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    if (!pdfHash) return;

    const userMsg: Message = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const token = localStorage.getItem("reflens_token");
      const res = await fetch("http://localhost:5000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pdf_hash: pdfHash, messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!pdfHash) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: C.textDim, fontSize: 14, textAlign: "center", padding: 32,
      }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>💬</div>
        <div style={{ fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>AI Research Assistant</div>
        <div>Upload a paper to start chatting about it</div>
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
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>AI Research Assistant</div>
        {paperTitle && (
          <div style={{
            fontSize: 11, color: C.textDim, marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            Analyzing: {paperTitle}
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 14px",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {/* Welcome message */}
        {historyLoaded && messages.length === 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 12, padding: "14px 16px",
          }}>
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              I've analyzed this paper and can help you understand the findings,
              explain flagged citations, identify weaknesses, and help you write your review.
            </div>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    padding: "5px 10px",
                    background: "transparent",
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: 20, color: C.textMuted,
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
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: msg.role === "user" ? "row-reverse" : "row",
              gap: 8, alignItems: "flex-end",
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: msg.role === "user"
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : C.card,
              border: msg.role === "assistant" ? `1px solid ${C.cardBorder}` : "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12,
            }}>
              {msg.role === "user" ? "👤" : "🤖"}
            </div>

            {/* Bubble */}
            <div style={{
              maxWidth: "80%",
              padding: "10px 14px",
              borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: msg.role === "user"
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : C.card,
              border: msg.role === "assistant" ? `1px solid ${C.cardBorder}` : "none",
              color: C.text,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: C.card, border: `1px solid ${C.cardBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
            }}>🤖</div>
            <div style={{
              padding: "12px 16px", background: C.card,
              border: `1px solid ${C.cardBorder}`,
              borderRadius: "16px 16px 16px 4px",
              display: "flex", gap: 5, alignItems: "center",
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: C.accent,
                  animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "12px 14px",
        borderTop: `1px solid ${C.cardBorder}`,
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          background: C.card, border: `1px solid ${C.cardBorder}`,
          borderRadius: 12, padding: "8px 10px 8px 14px",
          transition: "border-color 0.15s",
        }}
          onFocus={() => {}}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this paper…"
            rows={1}
            style={{
              flex: 1, background: "transparent", border: "none",
              color: C.text, fontSize: 13, outline: "none",
              resize: "none", lineHeight: 1.5, maxHeight: 120,
              fontFamily: "inherit", padding: 0,
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: input.trim() && !loading ? C.accent : "#1e293b",
              color: "#fff", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, flexShrink: 0, transition: "background 0.15s",
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 6, textAlign: "center" }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>

      <style>{`
        @keyframes chatBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
