import { useState, useRef, useEffect, useCallback } from "react";
import { CitationResult, Summary, Signal, MissingCitationsData, ReliabilityData } from "../types";
import MissingCitationsTab from "./MissingCitationsTab";
import ReliabilityTab from "./ReliabilityTab";
import CitationDetailTab from "./CitationDetailTab";
import { useTheme, ThemeColors } from "../theme";

// ─── Signal helpers ───────────────────────────────────────────────────────────

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

function makeStatusCfg(C: ThemeColors) {
  return {
    ai_likely: { color: C.red,    bg: C.redBg,    icon: "🤖", label: "AI-Likely"  },
    uncertain: { color: C.yellow, bg: C.yellowBg, icon: "❓", label: "Uncertain"  },
    human:     { color: C.green,  bg: C.greenBg,  icon: "✓",  label: "Verified"   },
  } as const;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextPanelProps {
  citations: CitationResult[];
  summary: Summary | null;
  signals: Signal[];
  totalCitations: number;
  analyzing: boolean;
  selectedCitationId: string | null;
  onCitationSelect: (id: string) => void;
  onBack: () => void;
  missingData: MissingCitationsData | null;
  missingLoading: boolean;
  reliabilityData: ReliabilityData | null;
  reliabilityLoading: boolean;
}

type TabId = "citations" | "missing" | "reliability";

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({
  label, value, color, bg,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <div style={{
      flex: 1, padding: "8px 10px", borderRadius: 10,
      background: bg, border: `1px solid ${color}25`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 19, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12.5, color, opacity: 0.75, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}

// ─── Citation Card ────────────────────────────────────────────────────────────

function CitationCard({
  citation,
  onClick,
  isSelected,
}: {
  citation: CitationResult;
  onClick: () => void;
  isSelected: boolean;
}) {
  const { C } = useTheme();
  const STATUS_CFG = makeStatusCfg(C);
  const cfg = STATUS_CFG[citation.status];
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 14px",
        background: isSelected ? `${C.accent}12` : C.card,
        border: `1px solid ${isSelected ? C.accent + "40" : C.border}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s",
        marginBottom: 6,
      }}
      onMouseEnter={e => {
        if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = `${C.accent}08`;
      }}
      onMouseLeave={e => {
        if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = C.card;
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: cfg.color,
          fontFamily: "monospace", flexShrink: 0,
        }}>
          {citation.id}
        </span>
        <span style={{
          fontSize: 11.5, fontWeight: 600, color: cfg.color,
          background: cfg.bg, padding: "1px 6px",
          borderRadius: 20, border: `1px solid ${cfg.color}25`,
          flexShrink: 0,
        }}>
          {cfg.icon} {cfg.label}
        </span>
        {citation.year && (
          <span style={{ fontSize: 12, color: C.textDim, marginLeft: "auto" }}>{citation.year}</span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 14.5, color: C.textMuted, lineHeight: 1.5,
        overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>
        {citation.title || "Untitled"}
      </div>

      {/* Score bar */}
      {citation.status !== "human" && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, height: 3, background: `${cfg.color}20`, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: `${citation.aiScore}%`, height: "100%",
              background: cfg.color, borderRadius: 4,
              transition: "width 0.3s ease",
            }} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: cfg.color, flexShrink: 0 }}>
            {citation.aiScore}%
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Citations Tab ────────────────────────────────────────────────────────────

function CitationsTabContent({
  citations,
  summary,
  signals,
  totalCitations,
  analyzing,
  selectedCitationId,
  onCitationSelect,
}: {
  citations: CitationResult[];
  summary: Summary | null;
  signals: Signal[];
  totalCitations: number;
  analyzing: boolean;
  selectedCitationId: string | null;
  onCitationSelect: (id: string) => void;
}) {
  const { C } = useTheme();
  const [activeSignal, setActiveSignal] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const STATUS_CFG = makeStatusCfg(C);

  const filterBySignal = (list: CitationResult[]) =>
    activeSignal ? list.filter(c => c.flags.some(f => f === activeSignal)) : list;

  const aiLikely  = filterBySignal(citations.filter(c => c.status === "ai_likely"));
  const uncertain = filterBySignal(citations.filter(c => c.status === "uncertain"));
  const human     = filterBySignal(citations.filter(c => c.status === "human"));
  const filteredTotal = aiLikely.length + uncertain.length + human.length;
  const aiRate    = summary?.ai_rate ?? (totalCitations > 0 ? Math.round((citations.filter(c => c.status === "ai_likely").length / totalCitations) * 100) : 0);
  const loaded    = citations.length;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "14px 16px 24px" }}>
      {/* Stat boxes */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
          <StatBox label="AI Likely"  value={summary?.ai_likely  ?? citations.filter(c => c.status === "ai_likely").length}  color={C.red}    bg={C.redBg} />
          <StatBox label="Uncertain"  value={summary?.uncertain  ?? citations.filter(c => c.status === "uncertain").length}   color={C.yellow} bg={C.yellowBg} />
          <StatBox label="Verified"   value={summary?.human      ?? citations.filter(c => c.status === "human").length}       color={C.green}  bg={C.greenBg} />
          <StatBox label="AI Rate"    value={`${aiRate}%`}                                                                    color={C.purple} bg={`${C.purple}12`} />
        </div>

        {/* Progress bar */}
        {analyzing && totalCitations > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: C.textDim }}>Analyzing with GPT-4…</span>
              <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>{loaded} / {totalCitations}</span>
            </div>
            <div style={{ height: 5, background: `${C.accent}20`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, (loaded / totalCitations) * 100)}%`,
                background: `linear-gradient(90deg, ${C.accent}, #8b5cf6)`,
                borderRadius: 4, transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        {/* Detection signals */}
        {signals.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: "10px 12px", marginBottom: 10,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              ⚡ Detection Signals
              {activeSignal && (
                <span
                  onClick={() => setActiveSignal(null)}
                  style={{ marginLeft: "auto", fontSize: 12, color: C.accent, cursor: "pointer", background: `${C.accent}15`, padding: "1px 8px", borderRadius: 10 }}
                >
                  ✕ clear
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
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
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 13.5, color: isActive ? C.text : C.textMuted, flex: 1, marginRight: 8 }} title={s.signal}>
                      {shortenSignal(s.signal)}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.red, flexShrink: 0 }}>{s.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active filter banner */}
        {activeSignal && (
          <div style={{
            marginBottom: 10, padding: "7px 12px", borderRadius: 8,
            background: `${C.accent}10`, border: `1px solid ${C.accent}30`,
            fontSize: 13.5, color: C.accent,
          }}>
            Showing {filteredTotal} citation{filteredTotal !== 1 ? "s" : ""} matching this signal
          </div>
        )}

        {/* View toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, color: C.textDim }}>{filteredTotal} citations</span>
          <div style={{ display: "flex", background: C.bg, borderRadius: 8, padding: 3, gap: 2, border: `1px solid ${C.border}` }}>
            {(["cards", "table"] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12.5,
                background: viewMode === mode ? C.card : "transparent",
                color: viewMode === mode ? C.text : C.textDim,
                fontWeight: viewMode === mode ? 600 : 400,
                boxShadow: viewMode === mode ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
                transition: "all 0.15s",
              }}>
                {mode === "cards" ? "⊞ Cards" : "⊟ Table"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Citation list */}
      <div>
        {citations.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 10, padding: "40px 0", textAlign: "center",
          }}>
            {analyzing ? (
              <>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  border: `3px solid ${C.accent}20`,
                  borderTop: `3px solid ${C.accent}`,
                  animation: "spin 1s linear infinite",
                }} />
                <span style={{ fontSize: 15, color: C.textDim }}>Loading citations…</span>
              </>
            ) : (
              <span style={{ fontSize: 15, color: C.textDim }}>No citations found</span>
            )}
          </div>
        )}

        {/* ── Cards view ── */}
        {viewMode === "cards" && (
          <>
            {aiLikely.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: 0.8, margin: "8px 0 7px" }}>
                  🤖 AI-Likely ({aiLikely.length})
                </div>
                {aiLikely.map(c => (
                  <CitationCard key={c.id} citation={c} isSelected={c.id === selectedCitationId} onClick={() => onCitationSelect(c.id)} />
                ))}
              </>
            )}
            {uncertain.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.yellow, textTransform: "uppercase", letterSpacing: 0.8, margin: "8px 0 7px" }}>
                  ❓ Uncertain ({uncertain.length})
                </div>
                {uncertain.map(c => (
                  <CitationCard key={c.id} citation={c} isSelected={c.id === selectedCitationId} onClick={() => onCitationSelect(c.id)} />
                ))}
              </>
            )}
            {human.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: 0.8, margin: "8px 0 7px" }}>
                  ✓ Verified ({human.length})
                </div>
                {human.map(c => (
                  <CitationCard key={c.id} citation={c} isSelected={c.id === selectedCitationId} onClick={() => onCitationSelect(c.id)} />
                ))}
              </>
            )}
          </>
        )}

        {/* ── Table view ── */}
        {viewMode === "table" && [...aiLikely, ...uncertain, ...human].length > 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "9px 6px 9px 12px", textAlign: "left", fontSize: 12.5, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 42 }}>ID</th>
                  <th style={{ padding: "9px 6px", textAlign: "left", fontSize: 12.5, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4 }}>Title</th>
                  <th style={{ padding: "9px 6px", textAlign: "center", fontSize: 12.5, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 96 }}>Status</th>
                  <th style={{ padding: "9px 10px 9px 6px", textAlign: "right", fontSize: 12.5, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 56 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {[...aiLikely, ...uncertain, ...human].map((c, i, arr) => {
                  const cfg = STATUS_CFG[c.status];
                  const score = c.status === "human" ? 0 : c.aiScore;
                  const isSelected = selectedCitationId === c.id;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onCitationSelect(c.id)}
                      style={{
                        borderBottom: i < arr.length - 1 ? `1px solid ${C.border}44` : "none",
                        background: isSelected ? `${cfg.color}12` : "transparent",
                        cursor: "pointer", transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${C.card}99`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? `${cfg.color}12` : "transparent"; }}
                    >
                      <td style={{ padding: "8px 6px 8px 12px", borderLeft: `3px solid ${cfg.color}` }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: cfg.color, fontFamily: "monospace" }}>{c.id}</span>
                      </td>
                      <td style={{ padding: "8px 6px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 0 }}>
                        <span style={{ fontSize: 14, color: C.textMuted }} title={c.title}>{c.title}</span>
                      </td>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: cfg.color, background: `${cfg.color}18`, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px 8px 6px", textAlign: "right" }}>
                        {c.status === "human"
                          ? <span style={{ fontSize: 13, color: C.green, fontFamily: "monospace" }}>—</span>
                          : <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: score >= 70 ? C.red : score >= 40 ? C.yellow : C.green }}>{score}%</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
  missingCount,
  analyzingMissing,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  missingCount: number;
  analyzingMissing: boolean;
}) {
  const { C } = useTheme();
  const tabs: { id: TabId; label: string; badge?: number | string }[] = [
    { id: "citations",   label: "Citations" },
    { id: "missing",     label: "Missing", badge: analyzingMissing ? "…" : missingCount > 0 ? missingCount : undefined },
    { id: "reliability", label: "Reliability" },
  ];

  return (
    <div style={{
      display: "flex", borderBottom: `1px solid ${C.border}`,
      background: C.surface, flexShrink: 0,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            flex: 1, padding: "13px 4px", border: "none",
            background: "transparent", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            fontSize: 15, fontWeight: active === tab.id ? 700 : 500,
            color: active === tab.id ? C.text : C.textDim,
            borderBottom: active === tab.id ? `2px solid ${C.accent}` : "2px solid transparent",
            transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={e => {
            if (active !== tab.id) (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
          }}
          onMouseLeave={e => {
            if (active !== tab.id) (e.currentTarget as HTMLButtonElement).style.color = C.textDim;
          }}
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              background: C.accent, color: "#fff",
              padding: "1px 5px", borderRadius: 10, lineHeight: 1.4,
            }}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContextPanel({
  citations,
  summary,
  signals,
  totalCitations,
  analyzing,
  selectedCitationId,
  onCitationSelect,
  onBack,
  missingData,
  missingLoading,
  reliabilityData,
  reliabilityLoading,
}: ContextPanelProps) {
  const { C } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("citations");
  const [panelWidth, setPanelWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    setIsResizing(true);
  }, [panelWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      setPanelWidth(Math.max(340, Math.min(window.innerWidth - 400, dragStartWidth.current + delta)));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isResizing]);

  const missingHighCount = missingData?.missing_papers?.filter(
    p => p.severity === "critical" || p.severity === "high"
  ).length ?? 0;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <div style={{
        width: panelWidth,
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        height: "100%",
        overflow: "hidden",
        userSelect: isResizing ? "none" : undefined,
        cursor: isResizing ? "col-resize" : undefined,
      }}>
        {/* Resize handle */}
        <div
          onMouseDown={onResizeMouseDown}
          style={{
            width: 5, flexShrink: 0, cursor: "col-resize",
            background: isResizing ? "#4f46e5" : "transparent",
            borderLeft: `1px solid ${isResizing ? "transparent" : C.border}`,
            transition: "background 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#6366f133"; }}
          onMouseLeave={e => { if (!isResizing) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        />
        {/* Panel content */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: C.surface,
          height: "100%",
          overflow: "hidden",
          minWidth: 0,
        }}>
        {/* Detail view when a citation is selected */}
        {selectedCitationId ? (
          <>
            {/* Back button */}
            <div style={{
              padding: "10px 14px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", gap: 8,
              background: C.bg, flexShrink: 0,
            }}>
              <button
                onClick={onBack}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", border: `1px solid ${C.border}`,
                  borderRadius: 7, background: C.card,
                  color: C.textMuted, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = C.text;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent + "60";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
                }}
              >
                ← Overview
              </button>
              <span style={{ fontSize: 13, color: C.textDim }}>Citation Detail</span>
            </div>

            {/* Citation detail content */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              <CitationDetailTab
                selectedCitationId={selectedCitationId}
                citations={citations}
                reliabilityData={reliabilityData}
                networkData={null}
                onCitationSelect={onCitationSelect}
              />
            </div>
          </>
        ) : (
          <>
            {/* Tab bar */}
            <TabBar
              active={activeTab}
              onChange={setActiveTab}
              missingCount={missingHighCount}
              analyzingMissing={missingLoading}
            />

            {/* Tab content */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {activeTab === "citations" && (
                <CitationsTabContent
                  citations={citations}
                  summary={summary}
                  signals={signals}
                  totalCitations={totalCitations}
                  analyzing={analyzing}
                  selectedCitationId={selectedCitationId}
                  onCitationSelect={onCitationSelect}
                />
              )}

              {activeTab === "missing" && (
                <div style={{ flex: 1, overflowY: "auto" }}>
                  <MissingCitationsTab data={missingData} loading={missingLoading} />
                </div>
              )}

              {activeTab === "reliability" && (
                <div style={{ flex: 1, overflowY: "auto" }}>
                  <ReliabilityTab
                    data={reliabilityData}
                    loading={reliabilityLoading}
                    aiCitations={citations}
                  />
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </>
  );
}
