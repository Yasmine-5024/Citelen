import { useState } from "react";
import { useTheme } from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormatIssue {
  severity: "error" | "warning" | "info";
  type: string;
  citation_id: string;
  title: string;
  detail: string;
}

export interface FormatSummary {
  total_issues: number;
  errors: number;
  warnings: number;
  info: number;
  score: number;
  by_type: Record<string, number>;
  total_citations: number;
}

export interface FormatCheckData {
  issues: FormatIssue[];
  summary: FormatSummary;
}

// ─── Semantic colours (stable across themes) ──────────────────────────────────

const _green  = "#10b981";
const _yellow = "#f59e0b";
const _orange = "#f97316";
const _red    = "#ef4444";
const _blue   = "#3b82f6";

const SEV_COLOR = { error: _red, warning: _orange, info: _blue };
const SEV_ICON  = { error: "✕", warning: "⚠", info: "ℹ" };

const TYPE_LABEL: Record<string, string> = {
  missing_title:     "Missing Title",
  missing_year:      "Missing Year",
  missing_authors:   "Missing Authors",
  missing_venue:     "Missing Venue/DOI",
  title_allcaps:     "ALL CAPS Title",
  title_case_mix:    "Inconsistent Title Case",
  doi_format_mix:    "Inconsistent DOI Format",
  author_format_mix: "Inconsistent Author Format",
  duplicate:         "Possible Duplicate",
  year_outlier:      "Year Outlier",
};

const TYPE_DESC: Record<string, string> = {
  missing_title:     "References without titles cannot be verified by reviewers.",
  missing_year:      "Missing year makes it impossible to assess recency.",
  missing_authors:   "References without authors are difficult to locate.",
  missing_venue:     "No venue or DOI — provenance unclear.",
  title_allcaps:     "All-caps titles are typically a copy-paste artifact.",
  title_case_mix:    "The reference list mixes Title Case and sentence case styles.",
  doi_format_mix:    "DOI entries use inconsistent formats across the reference list.",
  author_format_mix: "Some references use 'Last, First' while others use 'First Last'.",
  duplicate:         "Two references appear to cite the same paper.",
  year_outlier:      "The publication year looks like a data entry error.",
};

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const { C } = useTheme();
  const size = 96, r = 38, circ = 2 * Math.PI * r;
  const color = score >= 80 ? _green : score >= 60 ? _yellow : _orange;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`${color}20`} strokeWidth={5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "monospace" }}>{score}</span>
        <span style={{ fontSize: 9, color: C.textDim }}>/ 100</span>
      </div>
    </div>
  );
}

// ─── Stat Pill ─────────────────────────────────────────────────────────────────

function SevPill({ count, label, color }: { count: number; label: string; color: string }) {
  const { C } = useTheme();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      flex: 1, padding: "10px 6px",
      background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 10,
    }}>
      <span style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "monospace" }}>{count}</span>
      <span style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{label}</span>
    </div>
  );
}

// ─── Issue Group ──────────────────────────────────────────────────────────────

function IssueGroup({ type, issues }: { type: string; issues: FormatIssue[] }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;

  const sev   = issues[0].severity;
  const color = SEV_COLOR[sev] ?? C.textDim;
  const icon  = SEV_ICON[sev] ?? "•";
  const label = TYPE_LABEL[type] ?? type;
  const desc  = TYPE_DESC[type] ?? "";

  return (
    <div style={{
      background: C.card, border: `1px solid ${color}25`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, marginBottom: 8, overflow: "hidden",
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.6)",
          background: color, width: 18, height: 18, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{label}</div>
          <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 1 }}>{desc}</div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, color,
          background: `${color}18`, padding: "2px 9px",
          borderRadius: 20, border: `1px solid ${color}30`, flexShrink: 0,
        }}>
          {issues.length}
        </span>
        <span style={{ fontSize: 10, color: C.textDim }}>{open ? "▴" : "▾"}</span>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "6px 10px 10px" }}>
          {issues.map((issue, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              padding: "6px 6px",
              borderBottom: i < issues.length - 1 ? `1px solid ${C.border}33` : "none",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace", flexShrink: 0, width: 30 }}>
                {issue.citation_id}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {issue.title && (
                  <div style={{
                    fontSize: 11, color: C.textMuted, marginBottom: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={issue.title}>
                    {issue.title}
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.4 }}>
                  {issue.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loading ──────────────────────────────────────────────────────────────────

function LoadingState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 0 24px" }}>
        <div style={{ fontSize: 32 }}>🔎</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted }}>Checking format consistency...</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: "50%", background: C.accent,
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Empty ────────────────────────────────────────────────────────────────────

function EmptyState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "0 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0 28px", textAlign: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: `linear-gradient(135deg, ${C.accent}20, #a78bfa20)`,
          border: `1px solid ${C.accent}30`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
        }}>🔎</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Format Checker</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
            Upload a PDF to audit the reference list for formatting inconsistencies.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QualityTab({
  data,
  loading,
}: {
  data: FormatCheckData | null;
  loading: boolean;
}) {
  const { C } = useTheme();
  const [sevFilter, setSevFilter] = useState<"all" | "error" | "warning" | "info">("all");

  if (loading) return <LoadingState />;
  if (!data)   return <EmptyState />;

  const { issues, summary } = data;

  const filtered = sevFilter === "all" ? issues : issues.filter(i => i.severity === sevFilter);
  const byType = filtered.reduce<Record<string, FormatIssue[]>>((acc, issue) => {
    (acc[issue.type] = acc[issue.type] ?? []).push(issue);
    return acc;
  }, {});

  const sevOrder = { error: 0, warning: 1, info: 2 };
  const sortedTypes = Object.keys(byType).sort((a, b) => {
    const sa = sevOrder[byType[a][0]?.severity ?? "info"] ?? 2;
    const sb = sevOrder[byType[b][0]?.severity ?? "info"] ?? 2;
    if (sa !== sb) return sa - sb;
    return byType[b].length - byType[a].length;
  });

  const scoreColor = summary.score >= 80 ? _green : summary.score >= 60 ? _yellow : _orange;

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <style>{`
        @keyframes bounce { 0%,80%,100%{transform:scale(0.6);opacity:0.4}40%{transform:scale(1);opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>🔎</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Reference Format Checker</span>
        </div>
        <div style={{ fontSize: 12, color: C.textDim }}>
          Consistency audit across {summary.total_citations} references — no AI required
        </div>
      </div>

      {/* Score + severity pills */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: "16px 18px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 20,
      }}>
        <ScoreRing score={summary.score} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor, marginBottom: 2 }}>
            {summary.score >= 80 ? "Good consistency" : summary.score >= 60 ? "Some inconsistencies" : "Multiple issues found"}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
            {summary.total_issues === 0
              ? "No formatting issues detected."
              : `${summary.total_issues} issue${summary.total_issues !== 1 ? "s" : ""} across ${summary.total_citations} references`}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <SevPill count={summary.errors}   label="Errors"   color={_red}    />
            <SevPill count={summary.warnings} label="Warnings" color={_orange} />
            <SevPill count={summary.info}     label="Notes"    color={_blue}   />
          </div>
        </div>
      </div>

      {summary.total_issues === 0 ? (
        <div style={{
          textAlign: "center", padding: "28px 0",
          color: _green, fontSize: 14, fontWeight: 600,
          background: `${_green}08`, border: `1px solid ${_green}20`,
          borderRadius: 12,
        }}>
          ✓ Reference list formatting looks consistent
        </div>
      ) : (
        <>
          {/* Severity filter */}
          <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
            {(["all", "error", "warning", "info"] as const).map(s => {
              const cnt = s === "all" ? issues.length : issues.filter(i => i.severity === s).length;
              if (cnt === 0 && s !== "all") return null;
              const color = s === "all" ? C.accent : SEV_COLOR[s];
              const isActive = sevFilter === s;
              return (
                <button key={s} onClick={() => setSevFilter(s)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 20,
                  border: `1px solid ${isActive ? color : color + "40"}`,
                  background: isActive ? `${color}20` : "transparent",
                  color: isActive ? color : C.textDim,
                  fontSize: 10.5, fontWeight: isActive ? 600 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  <span style={{ fontSize: 9.5, opacity: 0.8 }}>{cnt}</span>
                </button>
              );
            })}
          </div>

          <div style={{ animation: "fadeIn 0.3s ease" }}>
            {sortedTypes.map(type => (
              <IssueGroup key={type} type={type} issues={byType[type]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
