import { useEffect, useRef, useState } from "react";
import { Bot, Search, BarChart2, Network, Scale, ScanSearch, FlaskConical, ClipboardList, MessageSquare, PenLine, Settings, CheckCircle } from "lucide-react";
import { CitationResult, Signal, Summary, Metadata, MissingCitationsData, ReliabilityData } from "../types";
import MissingCitationsTab from "./MissingCitationsTab";
import ReliabilityTab from "./ReliabilityTab";
import CitationNetworkTab, { CitationNetworkData } from "./CitationNetworkTab";
import CitationBiasTab, { CitationBiasData } from "./CitationBiasTab";
import CitationDetailTab from "./CitationDetailTab";
import QualityTab, { FormatCheckData } from "./QualityTab";
import IntegrityTab, { IntegrityData } from "./IntegrityTab";
import ChatPanel from "./ChatPanel";
import DraftPanel from "./DraftPanel";

const C = {
  bg: "#0a0e1a",
  surface: "#0f1624",
  card: "#111827",
  cardBorder: "#1e293b",
  accent: "#6366f1",
  accentGlow: "rgba(99,102,241,0.15)",
  green: "#10b981", greenBg: "rgba(16,185,129,0.12)",
  yellow: "#f59e0b", yellowBg: "rgba(245,158,11,0.12)",
  red: "#ef4444", redBg: "rgba(239,68,68,0.12)",
  orange: "#f97316", orangeBg: "rgba(249,115,22,0.12)",
  blue: "#3b82f6", blueBg: "rgba(59,130,246,0.12)",
  cyan: "#06b6d4", cyanBg: "rgba(6,182,212,0.12)",
  purple: "#a78bfa", purpleBg: "rgba(167,139,250,0.12)",
  text: "#f1f5f9", textMuted: "#94a3b8", textDim: "#64748b",
  border: "#1e293b",
};

const SIGNAL_SHORT: Record<string, string> = {
  "Author names and year are missing in the citation": "Missing authors & year",
  "The cited work does not directly support the context in which it is used": "Context mismatch",
  "Found in multiple databases but with mismatched authorship": "Mismatched authorship",
  "Abstract does not support the citation context": "Abstract mismatch",
  "Author names do not match": "Author mismatch",
};

function shortenSignal(s: string): string {
  if (SIGNAL_SHORT[s]) return SIGNAL_SHORT[s];
  return s.length > 38 ? s.slice(0, 36) + "…" : s;
}

// ─── Shared UI primitives ───────────────────────────────────────────────────

const Card = ({ children, style = {}, left }: { children: React.ReactNode; style?: React.CSSProperties; left?: string }) => (
  <div style={{
    background: C.card, border: `1px solid ${C.cardBorder}`,
    borderLeft: left ? `3px solid ${left}` : undefined,
    borderRadius: 12, padding: 16, ...style,
  }}>{children}</div>
);

const Badge = ({ color, bg, children, icon }: { color: string; bg: string; children: React.ReactNode; icon?: string }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 600,
    color, background: bg, border: `1px solid ${color}22`,
  }}>
    {icon && <span>{icon}</span>}{children}
  </span>
);

const StatBox = ({ value, label, color, sub }: { value: any; label: string; color: string; sub?: string }) => (
  <div style={{
    flex: 1, textAlign: "center", padding: "12px 6px",
    background: `linear-gradient(135deg, ${color}06, ${color}12)`,
    borderRadius: 10, border: `1px solid ${color}20`,
  }}>
    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{label}</div>
    {sub && <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{sub}</div>}
  </div>
);

const ProgressBar = ({ value, max, color, height = 6 }: { value: number; max: number; color: string; height?: number }) => (
  <div style={{ flex: 1, background: `${color}15`, borderRadius: 10, height, overflow: "hidden" }}>
    <div style={{
      width: `${(value / max) * 100}%`, height: "100%",
      background: `linear-gradient(90deg, ${color}, ${color}cc)`,
      borderRadius: 10, transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
    }} />
  </div>
);

const ConfidenceMeter = ({ score, size = 44, forceGreen = false }: { score: number; size?: number; forceGreen?: boolean }) => {
  const color = forceGreen ? C.green : score >= 70 ? C.red : score >= 40 ? C.yellow : C.green;
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`${color}20`} strokeWidth={3} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.26, fontWeight: 700, color,
      }}>{score}%</div>
    </div>
  );
};

const ComingSoonOverlay = ({ icon, label }: { icon: string; label: string }) => (
  <div style={{
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "60px 32px", textAlign: "center", gap: 16,
  }}>
    <div style={{
      width: 64, height: 64, borderRadius: 18,
      background: `linear-gradient(135deg, ${C.accent}20, ${C.purple}20)`,
      border: `1px solid ${C.accent}30`,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
    }}>{icon}</div>
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
        Backend analysis coming soon. This tab will show real data once the pipeline is built.
      </div>
    </div>
    <div style={{
      padding: "8px 20px",
      background: C.accentGlow, border: `1px solid ${C.accent}30`,
      borderRadius: 20, fontSize: 11.5, color: C.accent, fontWeight: 600,
    }}>⏳ In Development</div>
  </div>
);

// ─── TAB 1: AI Detection ────────────────────────────────────────────────────

const STATUS_CONFIG = {
  ai_likely: {
    color: C.red, bg: C.redBg, icon: "🤖",
    label: "AI-Likely", desc: "High probability of fabrication — verify these citations",
  },
  uncertain: {
    color: C.yellow, bg: C.yellowBg, icon: "❓",
    label: "Uncertain", desc: "Low confidence — review before submitting",
  },
  human: {
    color: C.green, bg: C.greenBg, icon: "✓",
    label: "Verified Human", desc: "These citations appear legitimate",
  },
} as const;

function CitationCard({
  c, isSelected, onSelect, selectedRef,
}: {
  c: CitationResult;
  isSelected: boolean;
  onSelect: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedRef: React.Ref<any> | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cfg = STATUS_CONFIG[c.status];
  return (
    <div
      ref={selectedRef}
      onClick={() => setIsExpanded(e => !e)}
      style={{
        background: isSelected ? `${C.accent}10` : C.card,
        border: `1px solid ${isSelected ? C.accent : C.cardBorder}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 12, padding: 14, cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: isSelected ? `0 0 0 1px ${C.accent}30` : "none",
        animation: "fadeIn 0.3s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, width: 22, height: 22, borderRadius: 6, flexShrink: 0,
            background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{cfg.icon}</span>
          <span
            onClick={e => { e.stopPropagation(); onSelect(); }}
            style={{ fontSize: 13, fontWeight: 700, color: C.accent, flexShrink: 0, cursor: "pointer", textDecoration: "underline dotted" }}
          >{c.id}</span>
          {c.citation_count !== undefined && c.citation_count > 0 && (
            <span style={{ fontSize: 9.5, color: C.textDim, background: `${C.textDim}15`, padding: "1px 6px", borderRadius: 10 }}>
              cited {c.citation_count}×
            </span>
          )}
          {c.duplicate_of && (
            <span style={{ fontSize: 9.5, color: "#f97316", background: "#f9731615", padding: "1px 6px", borderRadius: 10, border: "1px solid #f9731630" }}>
              ⚠ dup of {c.duplicate_of}
            </span>
          )}
          {c.agent_analyzed && (
            <span style={{ fontSize: 9.5, color: C.accent, background: C.accentGlow, padding: "1px 6px", borderRadius: 10 }}>GPT-4</span>
          )}
          {c.flags.slice(0, 2).map((f, fi) => (
            <span key={fi} style={{
              fontSize: 9.5, color: C.orange, background: C.orangeBg,
              padding: "2px 6px", borderRadius: 20, border: `1px solid ${C.orange}20`,
            }}>⚠ {f}</span>
          ))}
        </div>
        <ConfidenceMeter score={c.status === "human" ? 100 : c.aiScore} size={42} forceGreen={c.status === "human"} />
      </div>

      {(() => {
        const sourceDoi = c.doi;
        const foundDoi = c.discovered_doi;
        const doi = sourceDoi || foundDoi;
        const href = doi
          ? `https://doi.org/${doi}`
          : `https://scholar.google.com/scholar?q=${encodeURIComponent(c.title)}`;
        const displayTitle = c.title.slice(0, 110) + (c.title.length > 110 ? "..." : "");
        return (
          <div style={{ marginBottom: 6 }}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 12, color: C.accent, lineHeight: 1.5,
                textDecoration: "none", borderBottom: `1px dashed ${C.accent}60`,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderBottomStyle = "solid")}
              onMouseLeave={e => (e.currentTarget.style.borderBottomStyle = "dashed")}
            >
              {displayTitle}
            </a>
            {!sourceDoi && foundDoi && (
              <span style={{ marginLeft: 6, fontSize: 9.5, color: C.orange, background: C.orangeBg, padding: "1px 6px", borderRadius: 10 }}>
                DOI not in source
              </span>
            )}
            {!doi && (
              <span style={{ marginLeft: 6, fontSize: 9.5, color: C.textDim }}>↗ Google Scholar</span>
            )}
          </div>
        );
      })()}
      <span style={{ fontSize: 11, color: C.textDim }}>— {c.source}</span>

      {isExpanded && c.found_in !== undefined && (
        <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {c.found_in.length === 0
            ? <span style={{ fontSize: 9.5, color: "#ef4444", background: "#ef444415", padding: "2px 7px", borderRadius: 10, border: "1px solid #ef444430" }}>⚠ Not found in any database</span>
            : c.found_in.map(db => (
              <span key={db} style={{ fontSize: 9.5, color: "#22c55e", background: "#22c55e15", padding: "2px 7px", borderRadius: 10, border: "1px solid #22c55e30" }}>✓ {db}</span>
            ))
          }
        </div>
      )}

      {isExpanded && c.reasoning && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: cfg.bg, borderRadius: 8,
          border: `1px solid ${cfg.color}20`,
          fontSize: 11.5, color: cfg.color, lineHeight: 1.6,
        }}>
          💬 {c.reasoning}
        </div>
      )}

    </div>
  );
}

function CitationGroup({
  status, citations, selectedCitationId, onCitationSelect, selectedRef, defaultCollapsed,
}: {
  status: "ai_likely" | "uncertain" | "human";
  citations: CitationResult[];
  selectedCitationId: string | null;
  onCitationSelect: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedRef: React.RefObject<any>;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const cfg = STATUS_CONFIG[status];
  if (citations.length === 0) return null;

  // Sort by aiScore desc within group
  const sorted = [...citations].sort((a, b) => b.aiScore - a.aiScore);

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Group header — clickable to collapse */}
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          marginBottom: collapsed ? 0 : 8, paddingLeft: 2, paddingRight: 4,
          background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 14 }}>{cfg.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
        <div style={{ flex: 1, height: 1, background: `${cfg.color}25` }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: cfg.color,
          background: cfg.bg, padding: "1px 7px", borderRadius: 20,
          border: `1px solid ${cfg.color}25`,
        }}>{citations.length}</span>
        <span style={{
          fontSize: 11, color: C.textDim,
          transition: "transform 0.2s",
          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        }}>▾</span>
      </button>

      {!collapsed && (
        <>
          <p style={{ fontSize: 10.5, color: C.textDim, margin: "0 0 8px 4px", lineHeight: 1.5 }}>
            {cfg.desc}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map(c => (
              <CitationCard
                key={c.id}
                c={c}
                isSelected={selectedCitationId === c.id}
                onSelect={() => onCitationSelect(c.id)}
                selectedRef={selectedCitationId === c.id ? selectedRef : null}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AIDetectionTab({
  citations, summary, signals, totalCitations, isAnalyzing, selectedCitationId, onCitationSelect,
}: {
  citations: CitationResult[];
  summary: Summary | null;
  signals: Signal[];
  totalCitations: number;
  isAnalyzing: boolean;
  selectedCitationId: string | null;
  onCitationSelect: (id: string) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedRef = useRef<any>(null);

  useEffect(() => {
    if (selectedCitationId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedCitationId]);

  const [activeSignal, setActiveSignal] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");

  if (citations.length === 0 && !isAnalyzing) {
    return <ComingSoonOverlay icon="🤖" label="AI Detection" />;
  }

  const filterBySignal = (list: CitationResult[]) =>
    activeSignal ? list.filter(c => c.flags.some(f => f === activeSignal)) : list;

  const aiLikely  = filterBySignal(citations.filter(c => c.status === "ai_likely"));
  const uncertain = filterBySignal(citations.filter(c => c.status === "uncertain"));
  const human     = filterBySignal(citations.filter(c => c.status === "human"));
  const filteredTotal = aiLikely.length + uncertain.length + human.length;

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      {/* Stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { value: summary?.ai_likely  ?? aiLikely.length,  label: "AI-Likely", color: C.red },
          { value: summary?.uncertain  ?? uncertain.length,  label: "Uncertain",  color: C.yellow },
          { value: summary?.human      ?? human.length,      label: "Verified",   color: C.green },
          { value: summary ? `${summary.ai_rate}%` : "—",   label: "AI Rate",    color: C.orange },
        ].map((s, i) => <StatBox key={i} {...s} />)}
      </div>

      {/* Analyzing progress */}
      {isAnalyzing && (
        <Card style={{ marginBottom: 14, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.textDim }}>Analyzing with GPT-4...</span>
            <span style={{ fontSize: 11, color: C.accent }}>{citations.length} / {totalCitations}</span>
          </div>
          <ProgressBar value={citations.length} max={totalCitations} color={C.accent} height={4} />
        </Card>
      )}

      {/* Detection signals */}
      {signals.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            ⚡ Detection Signals
            {activeSignal && (
              <span
                onClick={() => setActiveSignal(null)}
                style={{ marginLeft: "auto", fontSize: 10, color: C.accent, cursor: "pointer", background: C.accentGlow, padding: "1px 8px", borderRadius: 10 }}
              >
                ✕ clear filter
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {signals.slice(0, 6).map((s, i) => {
              const isActive = activeSignal === s.signal;
              return (
                <div
                  key={i}
                  onClick={() => setActiveSignal(isActive ? null : s.signal)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "6px 10px", borderRadius: 7, cursor: "pointer",
                    background: isActive ? `${C.red}18` : `${C.red}06`,
                    border: `1px solid ${isActive ? C.red : `${C.red}15`}`,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: 11, color: isActive ? C.text : C.textMuted, flex: 1, marginRight: 8 }} title={s.signal}>{shortenSignal(s.signal)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.red, flexShrink: 0 }}>{s.count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Active filter banner */}
      {activeSignal && (
        <div style={{
          marginBottom: 12, padding: "7px 12px", borderRadius: 8,
          background: `${C.accent}10`, border: `1px solid ${C.accent}30`,
          fontSize: 11, color: C.accent, display: "flex", justifyContent: "space-between",
        }}>
          <span>Showing {filteredTotal} citation{filteredTotal !== 1 ? "s" : ""} with: <strong>{activeSignal}</strong></span>
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: C.textDim }}>{filteredTotal} citations</span>
        <div style={{ display: "flex", background: C.surface, borderRadius: 8, padding: 3, gap: 2, border: `1px solid ${C.border}` }}>
          {(["table", "cards"] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10,
              background: viewMode === mode ? C.card : "transparent",
              color: viewMode === mode ? C.text : C.textDim,
              fontWeight: viewMode === mode ? 600 : 400,
              boxShadow: viewMode === mode ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
              transition: "all 0.15s",
            }}>
              {mode === "table" ? "⊟ Table" : "⊞ Cards"}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped citation lists */}
      {viewMode === "cards" && (
        <>
          <CitationGroup status="ai_likely"  citations={aiLikely}  selectedCitationId={selectedCitationId} onCitationSelect={onCitationSelect} selectedRef={selectedRef} defaultCollapsed={true} />
          <CitationGroup status="uncertain"  citations={uncertain}  selectedCitationId={selectedCitationId} onCitationSelect={onCitationSelect} selectedRef={selectedRef} defaultCollapsed={true} />
          <CitationGroup status="human"      citations={human}      selectedCitationId={selectedCitationId} onCitationSelect={onCitationSelect} selectedRef={selectedRef} defaultCollapsed={true} />

          {/* Skeleton cards while streaming */}
          {isAnalyzing && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {Array.from({ length: Math.min(3, totalCitations - citations.length) }).map((_, i) => (
                <div key={`sk-${i}`} style={{
                  background: C.card, border: `1px solid ${C.cardBorder}`,
                  borderRadius: 12, padding: 14, opacity: 0.4 - i * 0.1,
                }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: C.border }} />
                    <div style={{ width: 40, height: 13, borderRadius: 4, background: C.border }} />
                    <div style={{ width: 70, height: 13, borderRadius: 4, background: C.border }} />
                  </div>
                  <div style={{ height: 11, borderRadius: 4, background: C.border, marginBottom: 6 }} />
                  <div style={{ height: 11, borderRadius: 4, background: C.border, width: "65%" }} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {viewMode === "table" && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: "8px 6px 8px 10px", textAlign: "left", fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 36 }}>ID</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4 }}>Title</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 88 }}>Status</th>
                <th style={{ padding: "8px 8px 8px 6px", textAlign: "right", fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 52 }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {[...aiLikely, ...uncertain, ...human].map((c, i, arr) => {
                const cfg = STATUS_CONFIG[c.status];
                const score = c.status === "human" ? 0 : c.aiScore;
                const isSelected = selectedCitationId === c.id;
                return (
                  <tr key={c.id}
                    ref={isSelected ? selectedRef : null}
                    onClick={() => onCitationSelect(c.id)}
                    style={{
                      borderBottom: i < arr.length - 1 ? `1px solid ${C.border}44` : "none",
                      background: isSelected ? `${cfg.color}12` : "transparent",
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${C.card}99`; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? `${cfg.color}12` : "transparent"; }}
                  >
                    <td style={{ padding: "7px 6px 7px 10px", borderLeft: `3px solid ${cfg.color}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, fontFamily: "monospace" }}>{c.id}</span>
                    </td>
                    <td style={{ padding: "7px 6px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 0 }}>
                      <span style={{ fontSize: 11, color: C.textMuted }} title={c.title}>{c.title}</span>
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color, background: `${cfg.color}18`, padding: "2px 6px", borderRadius: 20, whiteSpace: "nowrap" }}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: "7px 8px 7px 6px", textAlign: "right" }}>
                      {c.status === "human"
                        ? <span style={{ fontSize: 10, color: C.green, fontFamily: "monospace" }}>—</span>
                        : <span style={{ fontSize: 11, fontWeight: 700, color: score >= 70 ? C.red : score >= 40 ? C.yellow : C.green, fontFamily: "monospace" }}>{score}%</span>
                      }
                    </td>
                  </tr>
                );
              })}
              {isAnalyzing && Array.from({ length: Math.min(3, totalCitations - citations.length) }).map((_, i) => (
                <tr key={`sk-${i}`} style={{ opacity: 0.4 - i * 0.1 }}>
                  <td style={{ padding: "7px 6px 7px 10px", borderLeft: `3px solid ${C.border}` }}>
                    <div style={{ width: 28, height: 12, borderRadius: 3, background: C.border }} />
                  </td>
                  <td style={{ padding: "7px 6px" }}>
                    <div style={{ height: 10, borderRadius: 3, background: C.border, width: "80%" }} />
                  </td>
                  <td style={{ padding: "7px 6px" }}>
                    <div style={{ height: 10, borderRadius: 3, background: C.border, width: 60, margin: "0 auto" }} />
                  </td>
                  <td style={{ padding: "7px 8px 7px 6px" }}>
                    <div style={{ height: 10, borderRadius: 3, background: C.border, width: 28, marginLeft: "auto" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}



// ─── TAB 5: Bias ────────────────────────────────────────────────────────────

function BiasTab({ hasData }: { hasData: boolean }) {
  if (!hasData) return (
    <div style={{ padding: "0 16px 24px" }}>
      <ComingSoonOverlay icon="⚖️" label="Citation Bias & Diversity Analysis" />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { label: "Self-Citation", color: C.orange },
          { label: "Geo Diversity", color: C.blue },
          { label: "Recency Score", color: C.green },
          { label: "Gender Balance", color: C.purple },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: "center", padding: "10px 4px",
            background: `${s.color}08`, borderRadius: 10, border: `1px solid ${s.color}20`,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>—</div>
            <div style={{ fontSize: 9, color: C.textDim, marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 12 }}>📅 Publication Year</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
          {["≤18", "19", "20", "21", "22", "23", "24", "25"].map((y, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: "100%", height: `${[15, 10, 25, 35, 55, 75, 60, 30][i]}%`,
                background: `${C.accent}30`, borderRadius: "3px 3px 0 0", minHeight: 4,
              }} />
              <span style={{ fontSize: 8, color: C.textDim }}>{y}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, textAlign: "center", marginTop: 8 }}>
          Real distribution will show after analysis
        </div>
      </Card>
    </div>
  );

  return <div />;
}

// ─── TAB 6: Action Items ────────────────────────────────────────────────────

function ActionItemsTab({
  citations, summary, missingData, reliabilityData,
}: {
  citations: CitationResult[];
  summary: Summary | null;
  missingData: MissingCitationsData | null;
  reliabilityData: ReliabilityData | null;
}) {
  const [doneSet, setDoneSet] = useState<Set<string>>(new Set());
  const toggleDone = (key: string) =>
    setDoneSet(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const aiLikely = citations.filter(c => c.status === "ai_likely");
  const uncertain = citations.filter(c => c.status === "uncertain");
  const criticalMissing = (missingData?.missing_papers ?? []).filter(p => p.severity === "critical");
  const highMissing     = (missingData?.missing_papers ?? []).filter(p => p.severity === "high");
  const lowRel = (reliabilityData?.citations ?? []).filter(c => c.relevance != null && c.relevance < 45);
  const flaggedRel = (reliabilityData?.citations ?? []).filter(c => c.flags.length > 0);

  const totalItems = aiLikely.length + uncertain.length + criticalMissing.length + highMissing.length + lowRel.length + flaggedRel.length;
  const doneCount = doneSet.size;
  const healthScore = summary
    ? Math.round(Math.max(0, 100 - summary.ai_rate * 1.2 - (criticalMissing.length * 8) - (flaggedRel.length * 4)))
    : null;

  // Deduplicated: flagged citations that are also low-rel
  const flaggedOnly = flaggedRel.filter(c => !lowRel.find(r => r.id === c.id));

  const ActionItem = ({
    id, color, bg, badge, title, body,
  }: { id: string; color: string; bg: string; badge: string; title: string; body: string }) => {
    const done = doneSet.has(id);
    return (
      <div style={{
        padding: "10px 14px",
        background: done ? C.greenBg : bg,
        borderRadius: 10,
        border: `1px solid ${done ? C.green : color}20`,
        borderLeft: `3px solid ${done ? C.green : color}`,
        transition: "all 0.2s",
        opacity: done ? 0.65 : 1,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: done ? 0 : 4, gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: done ? C.green : C.text, flex: 1 }}>
            {done ? "✓ " : ""}{title}
          </span>
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
            {!done && <Badge color={color} bg={`${color}20`}>{badge}</Badge>}
            <button
              onClick={() => toggleDone(id)}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 6,
                border: `1px solid ${done ? C.green : C.border}`,
                background: done ? C.greenBg : "transparent",
                color: done ? C.green : C.textDim,
                cursor: "pointer",
              }}
            >
              {done ? "Undo" : "Done"}
            </button>
          </div>
        </div>
        {!done && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>{body}</div>}
      </div>
    );
  };

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      {/* Health score */}
      {(summary || reliabilityData) && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 12 }}>📊 Citation Health Score</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ConfidenceMeter score={healthScore ?? Math.max(0, 100 - ((summary?.ai_rate ?? 0) * 1.5))} size={72} />
            <div style={{ flex: 1 }}>
              {summary && (
                <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, marginBottom: 10 }}>
                  {(summary.ai_rate >= 30)
                    ? <span>Citation quality is <span style={{ color: C.red, fontWeight: 600 }}>concerning</span> — significant issues found.</span>
                    : (summary.ai_rate >= 15)
                    ? <span>Citation quality is <span style={{ color: C.yellow, fontWeight: 600 }}>moderate</span> — some issues to address.</span>
                    : <span>Citation quality is <span style={{ color: C.green, fontWeight: 600 }}>good</span> — minor issues only.</span>
                  }
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {summary && <>
                  <Badge color={C.green} bg={C.greenBg} icon="✓">{summary.human} Solid</Badge>
                  <Badge color={C.yellow} bg={C.yellowBg} icon="~">{summary.uncertain} Review</Badge>
                  <Badge color={C.red} bg={C.redBg} icon="✗">{summary.ai_likely} AI-likely</Badge>
                </>}
                {reliabilityData && (
                  <Badge color={C.orange} bg={C.orangeBg} icon="⚠">{flaggedRel.length} Flagged</Badge>
                )}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          {totalItems > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10.5, color: C.textDim }}>Action items resolved</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: doneCount === totalItems ? C.green : C.accent }}>
                  {doneCount} / {totalItems}
                </span>
              </div>
              <ProgressBar value={doneCount} max={totalItems} color={doneCount === totalItems ? C.green : C.accent} height={5} />
            </div>
          )}
        </Card>
      )}

      {/* ── AI Detection issues ── */}
      {(aiLikely.length > 0 || uncertain.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMuted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            🤖 AI Detection
            <div style={{ flex: 1, height: 1, background: `${C.red}25`, marginLeft: 4 }} />
            <span style={{ fontSize: 10, color: C.red }}>{aiLikely.length + uncertain.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {aiLikely.slice(0, 5).map((c, i) => (
              <ActionItem
                key={`ai-${c.id}`}
                id={`ai-${c.id}`}
                color={C.red} bg={C.redBg} badge="CRITICAL"
                title={`Verify citation ${c.id}`}
                body={c.reasoning || `AI-likely citation — ${c.flags.join(", ") || "flagged by model"}`}
              />
            ))}
            {uncertain.slice(0, 3).map((c, i) => (
              <ActionItem
                key={`unc-${c.id}`}
                id={`unc-${c.id}`}
                color={C.yellow} bg={C.yellowBg} badge="MEDIUM"
                title={`Review citation ${c.id}`}
                body={c.reasoning || `Uncertain citation — ${c.flags.join(", ") || "low confidence score"}`}
              />
            ))}
            {aiLikely.length === 0 && uncertain.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", color: C.green, fontSize: 12 }}>
                ✓ No AI detection issues
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Missing citations issues ── */}
      {missingData && (criticalMissing.length > 0 || highMissing.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMuted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            🔍 Missing Citations
            <div style={{ flex: 1, height: 1, background: `${C.orange}25`, marginLeft: 4 }} />
            <span style={{ fontSize: 10, color: C.orange }}>{criticalMissing.length + highMissing.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {criticalMissing.slice(0, 4).map((p, i) => (
              <ActionItem
                key={`miss-crit-${i}`}
                id={`miss-crit-${i}-${p.title.slice(0, 20)}`}
                color={C.red} bg={C.redBg} badge="MUST ADD"
                title={`Add: ${p.title.slice(0, 55)}${p.title.length > 55 ? "…" : ""}`}
                body={`${p.reason} (${p.section})`}
              />
            ))}
            {highMissing.slice(0, 3).map((p, i) => (
              <ActionItem
                key={`miss-high-${i}`}
                id={`miss-high-${i}-${p.title.slice(0, 20)}`}
                color={C.orange} bg={C.orangeBg} badge="SHOULD ADD"
                title={`Consider: ${p.title.slice(0, 50)}${p.title.length > 50 ? "…" : ""}`}
                body={`${p.reason} (${p.section})`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Reliability issues ── */}
      {reliabilityData && (lowRel.length > 0 || flaggedOnly.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMuted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            📊 Reliability Issues
            <div style={{ flex: 1, height: 1, background: `${C.purple}25`, marginLeft: 4 }} />
            <span style={{ fontSize: 10, color: C.purple }}>{lowRel.length + flaggedOnly.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {lowRel.slice(0, 4).map((c, i) => (
              <ActionItem
                key={`rel-${c.id}`}
                id={`rel-${c.id}`}
                color={C.purple} bg={C.purpleBg} badge="LOW SCORE"
                title={`Check reliability of ${c.id}`}
                body={`${c.title.slice(0, 60)}${c.title.length > 60 ? "…" : ""} — relevance ${c.relevance != null ? `${c.relevance}%` : "N/A"} (${c.verdict})${c.warning ? `. ${c.warning}` : ""}`}
              />
            ))}
            {flaggedOnly.slice(0, 3).map((c, i) => (
              <ActionItem
                key={`flag-${c.id}`}
                id={`flag-${c.id}`}
                color={C.yellow} bg={C.yellowBg} badge={c.flags[0] ?? "FLAGGED"}
                title={`Review flagged citation ${c.id}`}
                body={`${c.title.slice(0, 60)}${c.title.length > 60 ? "…" : ""} — ${c.flags.join(", ")}${c.warning ? `. ${c.warning}` : ""}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* All clear */}
      {totalItems === 0 && citations.length > 0 && (
        <div style={{
          textAlign: "center", padding: "32px 16px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <CheckCircle size={36} color={C.green} strokeWidth={1.5} />
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>No action items</div>
          <div style={{ fontSize: 12, color: C.textDim }}>All checks passed — your citations look good.</div>
        </div>
      )}

      {/* Waiting for data */}
      {citations.length === 0 && (
        <div style={{
          textAlign: "center", padding: "32px 16px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div style={{ fontSize: 13, color: C.textDim }}>Upload a PDF to generate action items</div>
        </div>
      )}
    </div>
  );
}

// ─── Main Sidebar ───────────────────────────────────────────────────────────

const TABS = [
  { id: "ai", label: "AI Detection", icon: Bot },
  { id: "missing", label: "Missing", icon: Search },
  { id: "reliability", label: "Reliability", icon: BarChart2 },
  { id: "network", label: "Network", icon: Network },
  { id: "bias", label: "Bias", icon: Scale },
  { id: "quality", label: "Quality", icon: ScanSearch },
  { id: "integrity", label: "Integrity", icon: FlaskConical },
  { id: "actions", label: "Actions", icon: ClipboardList },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "draft", label: "Draft", icon: PenLine },
];

interface SidebarProps {
  citations: CitationResult[];
  metadata: Metadata | null;
  summary: Summary | null;
  signals: Signal[];
  totalCitations: number;
  loading: boolean;
  analyzing: boolean;
  error: string | null;
  selectedCitationId: string | null;
  onCitationSelect: (id: string) => void;
  missingData: MissingCitationsData | null;
  missingLoading: boolean;
  reliabilityData: ReliabilityData | null;
  reliabilityLoading: boolean;
  networkData: CitationNetworkData | null;
  networkLoading: boolean;
  biasData: CitationBiasData | null;
  biasLoading: boolean;
  formatData: FormatCheckData | null;
  formatLoading: boolean;
  integrityData: IntegrityData | null;
  integrityLoading: boolean;
  pdfHash: string | null;
  user: { id: number; email: string; name: string } | null;
}

export default function Sidebar({
  citations, metadata, summary, signals, totalCitations,
  loading, analyzing, error, selectedCitationId, onCitationSelect,
  missingData, missingLoading,
  reliabilityData, reliabilityLoading,
  networkData, networkLoading,
  biasData, biasLoading,
  formatData, formatLoading,
  integrityData, integrityLoading,
  pdfHash, user,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState("ai");
  const [citationMode, setCitationMode] = useState(false);
  const isAnalyzing = analyzing || (citations.length > 0 && citations.length < totalCitations);

  // Switch to citation detail view whenever a citation is selected (PDF click or sidebar click)
  useEffect(() => {
    if (selectedCitationId) setCitationMode(true);
  }, [selectedCitationId]);

  const hasAIData = citations.length > 0;

  const base: React.CSSProperties = {
    height: "100vh", display: "flex", flexDirection: "column",
    background: C.bg, fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  };

  if (loading && citations.length === 0) {
    return (
      <div style={{ ...base, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Settings size={36} color={C.textMuted} strokeWidth={1.5} />
        <div style={{ fontSize: 15, color: C.textMuted, fontWeight: 600 }}>Parsing PDF...</div>
        <div style={{ fontSize: 12, color: C.textDim }}>Extracting citations with GROBID</div>
        <LoadingDots />
      </div>
    );
  }

  if (error) return (
    <div style={{ ...base, alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.red, textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 14 }}>{error}</div>
      </div>
    </div>
  );

  if (!metadata && citations.length === 0) return (
    <div style={{ ...base, alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.textDim, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
        <div>Upload a PDF to begin</div>
      </div>
    </div>
  );

  return (
    <div style={base}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "12px 16px 0", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "white",
          }}>R</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>RefLens</span>
          <span style={{
            fontSize: 10, color: isAnalyzing ? C.yellow : hasAIData ? C.green : C.textDim,
            background: isAnalyzing ? C.yellowBg : hasAIData ? C.greenBg : `${C.textDim}15`,
            padding: "2px 7px", borderRadius: 20,
            border: `1px solid ${isAnalyzing ? C.yellow : hasAIData ? C.green : C.textDim}22`,
          }}>
            {isAnalyzing ? `⏳ Analyzing ${citations.length}/${totalCitations}` : hasAIData ? "✓ Complete" : "● Ready"}
          </span>

          {/* Mode toggle */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: citationMode ? C.textDim : C.accent, fontWeight: citationMode ? 400 : 600 }}>Overview</span>
            <button
              onClick={() => setCitationMode(m => !m)}
              title={citationMode ? "Switch to Overview mode" : "Switch to Citation mode"}
              style={{
                width: 36, height: 20, borderRadius: 10, border: "none",
                background: citationMode ? C.accent : `${C.textDim}30`,
                cursor: "pointer", position: "relative", transition: "background 0.2s",
                flexShrink: 0, padding: 0,
              }}
            >
              <div style={{
                position: "absolute", top: 2, left: citationMode ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%",
                background: "white", transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }} />
            </button>
            <span style={{ fontSize: 10, color: citationMode ? C.accent : C.textDim, fontWeight: citationMode ? 600 : 400 }}>
              📌 Citation
              {selectedCitationId && citationMode && (
                <span style={{ marginLeft: 4, color: C.accent, fontFamily: "monospace" }}>{selectedCitationId}</span>
              )}
            </span>
          </div>
        </div>

        {metadata && (
          <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginBottom: 10, marginLeft: 36 }}>
            {metadata.title.slice(0, 65)}{metadata.title.length > 65 ? "..." : ""}
          </div>
        )}

        {/* Tab nav — hidden in citation mode */}
        {!citationMode && (
          <div style={{ display: "flex", gap: 2, overflowX: "auto", paddingBottom: 0 }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "7px 10px",
                    borderRadius: "8px 8px 0 0",
                    border: isActive ? `1px solid ${C.border}` : "1px solid transparent",
                    borderBottom: isActive ? `1px solid ${C.bg}` : "1px solid transparent",
                    background: isActive ? C.bg : "transparent",
                    color: isActive ? C.accent : C.textDim,
                    fontSize: 11, fontWeight: isActive ? 600 : 500,
                    cursor: "pointer", whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  <tab.icon size={13} strokeWidth={2} />
                  {tab.label}
                  {tab.id === "ai" && isAnalyzing && (
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: C.yellow, animation: "pulse 1.5s infinite",
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {citationMode ? (
          <CitationDetailTab
            selectedCitationId={selectedCitationId}
            citations={citations}
            reliabilityData={reliabilityData}
            networkData={networkData}
            onCitationSelect={onCitationSelect}
          />
        ) : (
          <>
            {activeTab === "ai" && (
              <AIDetectionTab
                citations={citations}
                summary={summary}
                signals={signals}
                totalCitations={totalCitations}
                isAnalyzing={isAnalyzing}
                selectedCitationId={selectedCitationId}
                onCitationSelect={onCitationSelect}
              />
            )}
            {activeTab === "missing" && (
              <MissingCitationsTab data={missingData} loading={missingLoading} onCitationSelect={onCitationSelect} />
            )}
            {activeTab === "reliability" && <ReliabilityTab data={reliabilityData} loading={reliabilityLoading} aiCitations={citations} />}
            {activeTab === "network" && <CitationNetworkTab data={networkData} loading={networkLoading} />}
            {activeTab === "bias" && <CitationBiasTab data={biasData} loading={biasLoading} />}
            {activeTab === "quality" && <QualityTab data={formatData} loading={formatLoading} />}
            {activeTab === "integrity" && <IntegrityTab data={integrityData} loading={integrityLoading} />}
            {activeTab === "actions" && (
              <ActionItemsTab
                citations={citations}
                summary={summary}
                missingData={missingData}
                reliabilityData={reliabilityData}
              />
            )}
            {activeTab === "chat" && (
              <ChatPanel pdfHash={pdfHash} paperTitle={metadata?.title ?? null} user={user} />
            )}
            {activeTab === "draft" && (
              <DraftPanel pdfHash={pdfHash} paperTitle={metadata?.title ?? null} user={user} />
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

function LoadingDots() {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%", background: C.accent,
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}