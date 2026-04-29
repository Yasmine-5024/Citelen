import { useState, useRef, useEffect } from "react";
import { LimitationsData, StatsData, ReviewTemplateData } from "../types";

interface Props {
  onClose: () => void;
  limitationsData: LimitationsData | null;
  limitationsLoading: boolean;
  statsData: StatsData | null;
  statsLoading: boolean;
  reviewData: ReviewTemplateData | null;
  reviewLoading: boolean;
  onGenerateReview: () => void;
  paperTitle?: string;
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 76 }: { score: number; size?: number }) {
  const r = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={10} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.2s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.05em" }}>/ 100</span>
      </div>
    </div>
  );
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SevBadge({ sev }: { sev: string }) {
  const colors: Record<string, [string, string]> = {
    high: ["#ef4444", "#3f1919"],
    medium: ["#f59e0b", "#3d2f0a"],
    low: ["#3b82f6", "#0f2040"],
  };
  const [fg, bg] = colors[sev] ?? ["#64748b", "#1e293b"];
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", color: fg, background: bg,
      padding: "2px 7px", borderRadius: 20,
    }}>{sev}</span>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function Skeleton({ lines = 3, h = 14 }: { lines?: number; h?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{
          height: h,
          background: "linear-gradient(90deg, #1e293b 25%, #273548 50%, #1e293b 75%)",
          backgroundSize: "200% 100%",
          borderRadius: 6,
          width: i === lines - 1 ? "65%" : "100%",
          animation: "shimmer 1.4s infinite",
        }} />
      ))}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

// ── Recommendation pill ───────────────────────────────────────────────────────

function RecommendationBadge({ rec }: { rec: string }) {
  const map: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    accept:           { label: "Accept",           color: "#10b981", bg: "#052e16", icon: "✓" },
    minor_revision:   { label: "Minor Revision",   color: "#f59e0b", bg: "#2d1f00", icon: "△" },
    major_revision:   { label: "Major Revision",   color: "#f97316", bg: "#2d1400", icon: "⚠" },
    reject:           { label: "Reject",            color: "#ef4444", bg: "#2d0a0a", icon: "✗" },
  };
  const { label, color, bg, icon } = map[rec] ?? map.major_revision;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: bg, border: `1px solid ${color}33`,
      borderRadius: 12, padding: "8px 16px",
    }}>
      <span style={{ fontSize: 18, color }}>{icon}</span>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recommendation</div>
        <div style={{ fontSize: 14, fontWeight: 700, color }}>{label}</div>
      </div>
    </div>
  );
}

// ── Column 1: Limitations ─────────────────────────────────────────────────────

function LimitationsColumn({ data, loading }: { data: LimitationsData | null; loading: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
            Limitations Audit
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
            Section Analysis
          </div>
        </div>
        {data && <ScoreRing score={data.score} />}
      </div>

      {loading && <Skeleton lines={5} />}

      {!loading && !data && (
        <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          Loading limitations analysis…
        </div>
      )}

      {data && (
        <>
          {/* Section detection */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: data.has_section ? "#052e16" : "#2d1000",
            border: `1px solid ${data.has_section ? "#10b98144" : "#f9731644"}`,
            borderRadius: 10, padding: "10px 14px",
          }}>
            <span style={{ fontSize: 18 }}>{data.has_section ? "✓" : "✗"}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: data.has_section ? "#10b981" : "#f97316" }}>
                {data.has_section ? `Section found: "${data.section_name}"` : "No limitations section detected"}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {data.has_section
                  ? `${data.stated_limitations.length} stated limitation${data.stated_limitations.length !== 1 ? "s" : ""}`
                  : "Consider adding a dedicated limitations section"}
              </div>
            </div>
          </div>

          {/* Stated limitations */}
          {data.stated_limitations.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Stated Limitations
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.stated_limitations.map((lim, i) => (
                  <div key={i} style={{
                    background: "#111827", borderRadius: 8, padding: "8px 12px",
                    borderLeft: "3px solid #3b82f6",
                    display: "flex", alignItems: "flex-start", gap: 8,
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                      color: "#3b82f6", background: "#0f2040",
                      padding: "2px 6px", borderRadius: 20, marginTop: 1, flexShrink: 0,
                    }}>{lim.category}</span>
                    <span style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{lim.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Undisclosed weaknesses */}
          {data.undisclosed.length > 0 && (
            <div>
              <div style={{
                fontSize: 11, color: "#ef4444", textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
              }}>
                <span>⚠</span> Undisclosed Weaknesses ({data.undisclosed.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.undisclosed.map((w, i) => (
                  <div key={i} style={{
                    background: "#1a0a0a", borderRadius: 8, padding: "8px 12px",
                    borderLeft: "3px solid #ef4444",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <SevBadge sev={w.severity} />
                      <span style={{ fontSize: 10, color: "#64748b" }}>{w.source_section}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{w.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.undisclosed.length === 0 && data.has_section && (
            <div style={{ color: "#10b981", fontSize: 12, background: "#052e16", borderRadius: 8, padding: "8px 12px" }}>
              All detected weaknesses appear to be acknowledged in the limitations section.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Column 2: Statistical Reporting ──────────────────────────────────────────

const ISSUE_LABELS: Record<string, string> = {
  missing_ci:           "Missing CI",
  missing_effect_size:  "No Effect Size",
  missing_n:            "Missing N",
  bare_p_value:         "Bare p-value",
  informal_significance:"Informal",
  missing_test_stat:    "No Test Stat",
};

function StatsColumn({ data, loading }: { data: StatsData | null; loading: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
            Statistics
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
            Reporting Quality
          </div>
        </div>
        {data && <ScoreRing score={data.score} />}
      </div>

      {loading && <Skeleton lines={5} />}

      {!loading && !data && (
        <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          Loading statistical analysis…
        </div>
      )}

      {data && (
        <>
          {/* Summary bar */}
          <div style={{ background: "#111827", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>{data.summary}</div>
            {data.total_stats_found > 0 && (
              <div style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "Found", value: data.total_stats_found, color: "#6366f1" },
                  { label: "OK", value: data.properly_reported, color: "#10b981" },
                  { label: "Issues", value: data.issues.length, color: "#ef4444" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Issue type breakdown */}
          {data.issues.length > 0 && (() => {
            const counts: Record<string, number> = {};
            for (const iss of data.issues) counts[iss.issue_type] = (counts[iss.issue_type] ?? 0) + 1;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(counts).map(([type, count]) => (
                  <div key={type} style={{
                    background: "#1e293b", borderRadius: 20,
                    padding: "3px 10px", fontSize: 11, color: "#94a3b8",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{count}</span>
                    {ISSUE_LABELS[type] ?? type}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Individual issues */}
          {data.issues.length === 0 && (
            <div style={{ color: "#10b981", fontSize: 12, background: "#052e16", borderRadius: 8, padding: "8px 12px" }}>
              {data.total_stats_found === 0
                ? "No statistical claims detected."
                : "All statistical claims appear properly reported."}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.issues.map((iss, i) => (
              <div key={i} style={{
                background: "#111827", borderRadius: 8, padding: "10px 12px",
                borderLeft: `3px solid ${iss.severity === "high" ? "#ef4444" : iss.severity === "medium" ? "#f59e0b" : "#3b82f6"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <SevBadge sev={iss.severity} />
                  <span style={{
                    fontSize: 10, color: "#8b5cf6", background: "#1e1040",
                    padding: "2px 7px", borderRadius: 20, fontWeight: 600,
                  }}>{ISSUE_LABELS[iss.issue_type] ?? iss.issue_type}</span>
                  <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto" }}>{iss.section}</span>
                </div>
                <div style={{
                  fontSize: 11, color: "#94a3b8", fontStyle: "italic",
                  lineHeight: 1.5, marginBottom: 6,
                  borderLeft: "2px solid #1e293b", paddingLeft: 8,
                }}>
                  "{iss.sentence.length > 120 ? iss.sentence.slice(0, 120) + "…" : iss.sentence}"
                </div>
                <div style={{ fontSize: 11, color: "#10b981" }}>→ {iss.suggestion}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Column 3: Review Draft ────────────────────────────────────────────────────

function ReviewColumn({
  data, loading, onGenerate,
}: {
  data: ReviewTemplateData | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<ReviewTemplateData | null>(null);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (data) setDraft({ ...data }); }, [data]);

  const active = draft ?? data;

  const buildText = (d: ReviewTemplateData) =>
    `PAPER REVIEW\n${"─".repeat(60)}\n\n` +
    `SUMMARY\n${d.paper_summary}\n\n` +
    `STRENGTHS\n${d.strengths.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` +
    `WEAKNESSES\n${d.weaknesses.map((w, i) => `${i + 1}. ${w}`).join("\n")}\n\n` +
    `QUESTIONS FOR AUTHORS\n${d.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n` +
    `RECOMMENDATION: ${d.recommendation.replace(/_/g, " ").toUpperCase()}\n${d.recommendation_note}`;

  const copyAll = () => {
    if (!active) return;
    navigator.clipboard.writeText(buildText(active));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "#ec4899", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
            Review Draft
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
            Peer Review Template
          </div>
        </div>
        {active && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setEditMode(v => !v)} style={{
              background: editMode ? "#4f46e5" : "#1e293b",
              border: "none", borderRadius: 8, padding: "6px 12px",
              color: "#f1f5f9", fontSize: 11, cursor: "pointer", fontWeight: 600,
            }}>{editMode ? "Preview" : "Edit"}</button>
            <button onClick={copyAll} style={{
              background: copied ? "#052e16" : "#1e293b",
              border: "none", borderRadius: 8, padding: "6px 12px",
              color: copied ? "#10b981" : "#f1f5f9", fontSize: 11, cursor: "pointer", fontWeight: 600,
            }}>{copied ? "Copied!" : "Copy All"}</button>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0" }}>
          <div style={{
            width: 36, height: 36, border: "3px solid #1e293b",
            borderTop: "3px solid #ec4899", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 12, color: "#64748b" }}>Generating review draft…</div>
        </div>
      )}

      {!loading && !active && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 16, padding: "40px 20px", textAlign: "center",
        }}>
          <div style={{ fontSize: 40 }}>📝</div>
          <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, maxWidth: 240 }}>
            Generate a pre-filled peer review template based on the paper and analysis results.
          </div>
          <button onClick={onGenerate} style={{
            background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
            border: "none", borderRadius: 12, padding: "12px 24px",
            color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: "pointer", letterSpacing: "0.02em",
          }}>
            Generate Review Draft
          </button>
        </div>
      )}

      {active && !loading && (
        editMode ? (
          <textarea
            ref={textRef}
            value={buildText(active)}
            onChange={e => {
              /* Allow free editing in textarea mode — parse back if needed */
            }}
            style={{
              flex: 1, minHeight: 400, background: "#0d1a2e",
              border: "1px solid #1e293b", borderRadius: 10,
              color: "#f1f5f9", fontSize: 12, fontFamily: "monospace",
              padding: 16, lineHeight: 1.7, resize: "none",
              outline: "none",
            }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Recommendation */}
            <RecommendationBadge rec={active.recommendation} />
            {active.recommendation_note && (
              <div style={{ fontSize: 12, color: "#64748b", fontStyle: "italic", lineHeight: 1.5 }}>
                {active.recommendation_note}
              </div>
            )}

            {/* Summary */}
            <ReviewSection title="Summary" color="#6366f1" icon="📄">
              <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.7, margin: 0 }}>
                {active.paper_summary}
              </p>
            </ReviewSection>

            {/* Strengths */}
            <ReviewSection title="Strengths" color="#10b981" icon="✦">
              {active.strengths.map((s, i) => (
                <BulletItem key={i} text={s} color="#10b981" index={i + 1} />
              ))}
            </ReviewSection>

            {/* Weaknesses */}
            <ReviewSection title="Weaknesses" color="#f59e0b" icon="⚠">
              {active.weaknesses.map((w, i) => (
                <BulletItem key={i} text={w} color="#f59e0b" index={i + 1} />
              ))}
            </ReviewSection>

            {/* Questions */}
            <ReviewSection title="Questions for Authors" color="#ec4899" icon="?">
              {active.questions.map((q, i) => (
                <BulletItem key={i} text={q} color="#ec4899" index={i + 1} />
              ))}
            </ReviewSection>
          </div>
        )
      )}
    </div>
  );
}

function ReviewSection({ title, color, icon, children }: {
  title: string; color: string; icon: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#111827", borderRadius: 10, overflow: "hidden" }}>
      <div style={{
        padding: "8px 14px", borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 13, color }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {title}
        </span>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function BulletItem({ text, color, index }: { text: string; color: string; index: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color, background: `${color}22`,
        borderRadius: 20, padding: "2px 7px", marginTop: 2, flexShrink: 0,
      }}>{index}</span>
      <span style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>{text}</span>
    </div>
  );
}

// ── Main component — inline side panel (no overlay) ──────────────────────────

export default function ReviewWorkspace({
  onClose,
  limitationsData, limitationsLoading,
  statsData, statsLoading,
  reviewData, reviewLoading,
  onGenerateReview,
  paperTitle,
}: Omit<Props, "isOpen">) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: "#0a0e1a",
      animation: "slideInRight 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px",
        background: "linear-gradient(90deg, #0f172a 0%, #1a1040 50%, #0f172a 100%)",
        borderBottom: "1px solid #1e293b",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, #6366f1, #ec4899)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, flexShrink: 0,
          }}>📋</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
              Peer Review Workspace
            </div>
            {paperTitle && (
              <div style={{
                fontSize: 10, color: "#475569",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 340,
              }}>
                {paperTitle}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {[
            { label: "Lim", score: limitationsData?.score, loading: limitationsLoading, color: "#6366f1" },
            { label: "Stats", score: statsData?.score, loading: statsLoading, color: "#8b5cf6" },
          ].map(({ label, score, loading, color }) => (
            <div key={label} style={{
              background: "#111827", borderRadius: 6, padding: "3px 8px",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: loading ? "#475569" : score !== undefined
                  ? (score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444")
                  : "#475569",
              }} />
              <span style={{ fontSize: 9, color: "#64748b" }}>{label}</span>
              {score !== undefined && !loading && (
                <span style={{ fontSize: 9, fontWeight: 700, color }}>{score}</span>
              )}
            </div>
          ))}
          <button onClick={onClose} title="Close workspace (Esc)" style={{
            background: "#1e293b", border: "none", borderRadius: 6,
            color: "#94a3b8", cursor: "pointer", padding: "5px 8px",
            fontSize: 13, lineHeight: 1, transition: "all 0.15s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#273548"; (e.currentTarget as HTMLButtonElement).style.color = "#f1f5f9"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1e293b"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
          >✕</button>
        </div>
      </div>

      {/* 3-column content */}
      <div style={{
        flex: 1, display: "flex", overflow: "hidden",
        padding: "16px 18px", gap: 0,
      }}>
        {/* Column 1 — Limitations */}
        <div style={{ flex: 1, height: "100%", overflowY: "auto", paddingRight: 16, borderRight: "1px solid #1e293b" }}>
          <LimitationsColumn data={limitationsData} loading={limitationsLoading} />
        </div>
        {/* Column 2 — Stats */}
        <div style={{ flex: 1, height: "100%", overflowY: "auto", paddingLeft: 16, paddingRight: 16, borderRight: "1px solid #1e293b" }}>
          <StatsColumn data={statsData} loading={statsLoading} />
        </div>
        {/* Column 3 — Review Draft */}
        <div style={{ flex: 1.1, height: "100%", overflowY: "auto", paddingLeft: 16 }}>
          <ReviewColumn data={reviewData} loading={reviewLoading} onGenerate={onGenerateReview} />
        </div>
      </div>
    </div>
  );
}

// ── Trigger Button (exported separately for use in PDFViewer area) ─────────────

export function ReviewWorkspaceTrigger({
  onClick,
  loading,
  ready,
}: {
  onClick: () => void;
  loading: boolean;
  ready: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title="Open Peer Review Workspace"
      style={{
        position: "absolute",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)",
        border: "none",
        borderRadius: 40,
        padding: "10px 22px",
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 4px 24px rgba(99,102,241,0.45)",
        letterSpacing: "0.02em",
        zIndex: 50,
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) translateY(-2px)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 32px rgba(99,102,241,0.6)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateX(-50%) translateY(0)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 24px rgba(99,102,241,0.45)";
      }}
    >
      {loading ? (
        <>
          <div style={{
            width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)",
            borderTop: "2px solid #fff", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          Analyzing…
        </>
      ) : (
        <>
          {ready && (
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 6px #10b981",
              animation: "pulse 2s infinite",
            }} />
          )}
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
          📋 Review Workspace
        </>
      )}
    </button>
  );
}
