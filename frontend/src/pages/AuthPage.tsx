import { useState } from "react";

const C = {
  bg: "#0a0e1a",
  surface: "#0f1624",
  card: "#111827",
  border: "#1e293b",
  accent: "#6366f1",
  accentHover: "#4f46e5",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  red: "#ef4444",
};

interface AuthPageProps {
  onAuth: (user: { id: number; email: string; name: string; institution: string }, token: string) => void;
}

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body: Record<string, string> = { email, password };
      if (mode === "signup") { body.name = name; body.institution = institution; }

      const res = await fetch(`http://localhost:5000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      onAuth(data.user, data.token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    color: C.text,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: C.textMuted,
    marginBottom: 6,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Logo / brand */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16,
            background: `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
            fontSize: 24, marginBottom: 16,
            boxShadow: `0 0 32px rgba(99,102,241,0.4)`,
          }}>
            🔬
          </div>
          <h1 style={{ color: C.text, fontSize: 26, fontWeight: 700, margin: 0 }}>Reflens</h1>
          <p style={{ color: C.textMuted, fontSize: 14, marginTop: 6 }}>AI-powered peer review assistant</p>
        </div>

        {/* Card */}
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "32px 28px",
        }}>
          {/* Tab toggle */}
          <div style={{
            display: "flex",
            background: C.surface,
            borderRadius: 10,
            padding: 4,
            marginBottom: 28,
            gap: 4,
          }}>
            {(["login", "signup"] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  background: mode === m ? C.accent : "transparent",
                  color: mode === m ? "#fff" : C.textMuted,
                  transition: "all 0.15s",
                }}
              >
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {mode === "signup" && (
              <div>
                <label style={labelStyle}>Full Name</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="Dr. Jane Smith"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  onFocus={e => (e.target.style.borderColor = C.accent)}
                  onBlur={e => (e.target.style.borderColor = C.border)}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Email</label>
              <input
                style={inputStyle}
                type="email"
                placeholder="you@university.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                onFocus={e => (e.target.style.borderColor = C.accent)}
                onBlur={e => (e.target.style.borderColor = C.border)}
              />
            </div>

            <div>
              <label style={labelStyle}>Password</label>
              <input
                style={inputStyle}
                type="password"
                placeholder={mode === "signup" ? "Min. 8 characters" : "Your password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === "signup" ? 8 : undefined}
                onFocus={e => (e.target.style.borderColor = C.accent)}
                onBlur={e => (e.target.style.borderColor = C.border)}
              />
            </div>

            {mode === "signup" && (
              <div>
                <label style={labelStyle}>Institution <span style={{ color: C.textDim, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="University of Example"
                  value={institution}
                  onChange={e => setInstitution(e.target.value)}
                  onFocus={e => (e.target.style.borderColor = C.accent)}
                  onBlur={e => (e.target.style.borderColor = C.border)}
                />
              </div>
            )}

            {error && (
              <div style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8, padding: "10px 12px",
                color: C.red, fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "13px 0",
                background: loading ? "#374151" : `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
                border: "none", borderRadius: 10, color: "#fff",
                fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
                transition: "opacity 0.15s",
                boxShadow: loading ? "none" : `0 0 20px rgba(99,102,241,0.3)`,
              }}
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", color: C.textDim, fontSize: 12, marginTop: 20 }}>
          Your reviews and analysis are saved privately to your account.
        </p>
      </div>
    </div>
  );
}
