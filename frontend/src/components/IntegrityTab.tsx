import { useState } from "react";
import { useTheme } from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FairnessResult {
  citation_id: string;
  title: string;
  year: number | null;
  authors: string[];
  description: string[];
  abstract_snippet: string | null;
  verdict: "understated" | "misrepresented" | "strawman";
  severity: "low" | "medium" | "high";
  issue: string | null;
  omitted: string | null;
}

export interface OverclaimResult {
  sentence: string;
  is_overclaim: boolean;
  claim_type: "generalizability" | "novelty" | "performance" | "scope" | "universality" | "significance";
  issue: string | null;
  severity: "low" | "medium" | "high";
  suggestion: string | null;
}

export interface IntegritySummary {
  fairness_issues: number;
  overclaim_issues: number;
  total_issues: number;
  high_severity: number;
  related_work_checked: number;
}

export interface IntegrityData {
  fairness: FairnessResult[];
  overclaims: OverclaimResult[];
  summary: IntegritySummary;
}

// ─── Semantic colours (don't change between themes) ───────────────────────────

const _green  = "#10b981";
const _yellow = "#f59e0b";
const _orange = "#f97316";
const _red    = "#ef4444";
const _blue   = "#3b82f6";
const _purple = "#a855f7";
const _teal   = "#14b8a6";
const _indigo = "#6366f1";

const SEV_COLOR: Record<string, string> = {
  high: _red, medium: _orange, low: _yellow,
};

const VERDICT_COLOR: Record<string, string> = {
  strawman:       _red,
  misrepresented: _orange,
  understated:    _yellow,
};

const VERDICT_LABEL: Record<string, string> = {
  strawman:       "Strawman",
  misrepresented: "Misrepresented",
  understated:    "Understated",
};

const CLAIM_COLOR: Record<string, string> = {
  generalizability: _purple,
  novelty:          _indigo,
  performance:      _blue,
  scope:            _teal,
  universality:     _red,
  significance:     _orange,
};

const CLAIM_LABEL: Record<string, string> = {
  generalizability: "Generalizability",
  novelty:          "Novelty",
  performance:      "Performance",
  scope:            "Scope",
  universality:     "Universality",
  significance:     "Significance",
};

// ─── Small shared components ──────────────────────────────────────────────────

function Pill({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20,
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
      color, background: bg ?? `${color}22`,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function SevDot({ severity }: { severity: string }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: SEV_COLOR[severity] ?? "#64748b", flexShrink: 0,
    }} />
  );
}

function SectionHeader({ icon, title, count }: { icon: string; title: string; count: number }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{title}</span>
      <span style={{
        marginLeft: "auto", fontSize: 11, fontWeight: 600,
        color: count === 0 ? _green : _orange,
        background: count === 0 ? `${_green}18` : `${_orange}18`,
        padding: "2px 8px", borderRadius: 20,
        border: `1px solid ${count === 0 ? _green : _orange}44`,
      }}>
        {count === 0 ? "✓ No issues" : `${count} issue${count !== 1 ? "s" : ""}`}
      </span>
    </div>
  );
}

// ─── Related Work Fairness Card ───────────────────────────────────────────────

function FairnessCard({ item }: { item: FairnessResult }) {
  const { C } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const color = VERDICT_COLOR[item.verdict] ?? _yellow;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <SevDot severity={item.severity} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: C.text, fontSize: 12.5, fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {item.title || item.citation_id}
          </div>
          <div style={{ color: C.textDim, fontSize: 10.5, marginTop: 2 }}>
            {item.citation_id}
            {item.year ? ` · ${item.year}` : ""}
            {item.authors.length > 0 ? ` · ${item.authors[0]}${item.authors.length > 1 ? " et al." : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <Pill label={VERDICT_LABEL[item.verdict] ?? item.verdict} color={color} />
          <span style={{ color: C.textDim, fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {item.issue && (
        <div style={{
          marginTop: 8, fontSize: 11.5, color: C.textMuted,
          paddingLeft: 18, lineHeight: 1.5,
        }}>
          {item.issue}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12, paddingLeft: 18, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              Described in related work as
            </div>
            {item.description.slice(0, 3).map((s, i) => (
              <div key={i} style={{
                fontSize: 11.5, color: C.textMuted, lineHeight: 1.55,
                padding: "6px 10px", background: `${color}0d`,
                borderRadius: 6, marginBottom: 4,
                border: `1px solid ${color}22`,
              }}>
                "{s}"
              </div>
            ))}
          </div>

          {item.abstract_snippet && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                Paper's own abstract (excerpt)
              </div>
              <div style={{
                fontSize: 11.5, color: C.textMuted, lineHeight: 1.55,
                padding: "6px 10px", background: `${_green}0d`,
                borderRadius: 6, border: `1px solid ${_green}22`,
              }}>
                {item.abstract_snippet}
              </div>
            </div>
          )}

          {item.omitted && (
            <div style={{
              fontSize: 11.5, color: _orange, lineHeight: 1.5,
              padding: "6px 10px", background: `${_orange}0d`,
              borderRadius: 6, border: `1px solid ${_orange}22`,
            }}>
              <span style={{ fontWeight: 600 }}>Omitted: </span>{item.omitted}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Overclaim Card ────────────────────────────────────────────────────────────

function OverclaimCard({ item }: { item: OverclaimResult }) {
  const { C } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const claimColor = CLAIM_COLOR[item.claim_type] ?? _purple;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${SEV_COLOR[item.severity] ?? _yellow}`,
        borderRadius: 10, padding: "12px 14px", cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <SevDot severity={item.severity} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55, fontStyle: "italic" }}>
            "{item.sentence.length > 180 ? item.sentence.slice(0, 180) + "…" : item.sentence}"
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "flex-start" }}>
          <Pill label={CLAIM_LABEL[item.claim_type] ?? item.claim_type} color={claimColor} />
          <span style={{ color: C.textDim, fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {item.issue && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: C.textMuted, paddingLeft: 18, lineHeight: 1.5 }}>
          {item.issue}
        </div>
      )}

      {expanded && item.suggestion && (
        <div style={{
          marginTop: 12, paddingLeft: 18,
          borderTop: `1px solid ${C.border}`, paddingTop: 12,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Suggested rephrasing
          </div>
          <div style={{
            fontSize: 11.5, color: _green, lineHeight: 1.55,
            padding: "6px 10px", background: `${_green}0d`,
            borderRadius: 6, border: `1px solid ${_green}22`,
          }}>
            {item.suggestion}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: IntegritySummary }) {
  const { C } = useTheme();
  const total = summary.total_issues;
  const score = Math.max(0, 100 - summary.high_severity * 15 - (total - summary.high_severity) * 5);
  const scoreColor = score >= 80 ? _green : score >= 60 ? _yellow : _red;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 18px", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
    }}>
      <div style={{ textAlign: "center", minWidth: 70 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
          {score}
        </div>
        <div style={{ fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>
          / 100
        </div>
      </div>

      <div style={{ width: 1, height: 44, background: C.border }} />

      {[
        { label: "Fairness Issues",   val: summary.fairness_issues,       color: _orange },
        { label: "Overclaims",        val: summary.overclaim_issues,      color: _red    },
        { label: "High Severity",     val: summary.high_severity,         color: _red    },
        { label: "RW Cits Checked",   val: summary.related_work_checked,  color: _blue   },
      ].map(({ label, val, color }) => (
        <div key={label} style={{ textAlign: "center", flex: "1 1 60px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: val === 0 ? _green : color }}>
            {val}
          </div>
          <div style={{ fontSize: 9.5, color: C.textDim, marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntegrityTab({
  data,
  loading,
}: {
  data: IntegrityData | null;
  loading: boolean;
}) {
  const { C } = useTheme();
  const [fairnessFilter, setFairnessFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [overclaimFilter, setOverclaimFilter] = useState<"all" | "high" | "medium" | "low">("all");

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🔬</div>
        <div style={{ color: C.textMuted, fontSize: 13 }}>Running integrity audit…</div>
        <div style={{ color: C.textDim, fontSize: 11, marginTop: 6 }}>
          Analysing related work + claim strength
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: C.textDim, fontSize: 13 }}>
        Upload a PDF to run the integrity audit.
      </div>
    );
  }

  const filteredFairness = data.fairness.filter(
    r => fairnessFilter === "all" || r.severity === fairnessFilter,
  );
  const filteredOverclaims = data.overclaims.filter(
    r => overclaimFilter === "all" || r.severity === overclaimFilter,
  );

  const noIssues = data.summary.total_issues === 0;

  return (
    <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 2 }}>
          🔬 Integrity Audit
        </div>
        <div style={{ fontSize: 11.5, color: C.textDim }}>
          Related work fairness · overclaim detection
        </div>
      </div>

      <SummaryBar summary={data.summary} />

      {noIssues && (
        <div style={{
          padding: "18px 20px", background: `${_green}10`,
          border: `1px solid ${_green}33`, borderRadius: 12,
          color: _green, fontSize: 13, fontWeight: 500, textAlign: "center",
        }}>
          ✓ No integrity issues detected
        </div>
      )}

      {/* ── Related Work Fairness ─────────────────────────────────────── */}
      <div>
        <SectionHeader icon="📚" title="Related Work Fairness" count={data.fairness.length} />

        {data.fairness.length === 0 ? (
          <div style={{
            padding: "14px 16px", background: `${_green}0d`,
            border: `1px solid ${_green}22`, borderRadius: 10,
            color: _green, fontSize: 12,
          }}>
            ✓ Prior work appears to be characterised fairly.
            {data.summary.related_work_checked > 0 &&
              ` (${data.summary.related_work_checked} related-work citations checked)`}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {(["all", "high", "medium", "low"] as const).map(f => {
                const count = f === "all"
                  ? data.fairness.length
                  : data.fairness.filter(r => r.severity === f).length;
                const active = fairnessFilter === f;
                return (
                  <button
                    key={f}
                    onClick={e => { e.stopPropagation(); setFairnessFilter(f); }}
                    style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 10.5,
                      fontWeight: active ? 600 : 400, cursor: "pointer",
                      background: active ? C.accent : C.surface,
                      color: active ? "white" : C.textDim,
                      border: `1px solid ${active ? C.accent : C.border}`,
                    }}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} {count}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredFairness.map(item => (
                <FairnessCard key={item.citation_id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Overclaim Detector ────────────────────────────────────────── */}
      <div>
        <SectionHeader icon="⚠️" title="Overclaim & Exaggeration" count={data.overclaims.length} />

        {data.overclaims.length === 0 ? (
          <div style={{
            padding: "14px 16px", background: `${_green}0d`,
            border: `1px solid ${_green}22`, borderRadius: 10,
            color: _green, fontSize: 12,
          }}>
            ✓ No overclaims detected in abstract, introduction, or conclusion.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {(["all", "high", "medium", "low"] as const).map(f => {
                const count = f === "all"
                  ? data.overclaims.length
                  : data.overclaims.filter(r => r.severity === f).length;
                const active = overclaimFilter === f;
                return (
                  <button
                    key={f}
                    onClick={e => { e.stopPropagation(); setOverclaimFilter(f); }}
                    style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 10.5,
                      fontWeight: active ? 600 : 400, cursor: "pointer",
                      background: active ? C.accent : C.surface,
                      color: active ? "white" : C.textDim,
                      border: `1px solid ${active ? C.accent : C.border}`,
                    }}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} {count}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {Object.entries(CLAIM_LABEL).map(([key, label]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: CLAIM_COLOR[key] }} />
                  <span style={{ fontSize: 9.5, color: C.textDim }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredOverclaims.map((item, i) => (
                <OverclaimCard key={i} item={item} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
