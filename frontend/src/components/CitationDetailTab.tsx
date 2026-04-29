import { CitationResult } from "../types";
import { ReliabilityCitation } from "../types";
import { CitationNetworkData } from "./CitationNetworkTab";

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0e1a",
  surface: "#0f1624",
  card: "#111827",
  cardBorder: "#1e293b",
  accent: "#6366f1",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  border: "#1e293b",
  green: "#10b981", greenBg: "rgba(16,185,129,0.10)",
  yellow: "#f59e0b", yellowBg: "rgba(245,158,11,0.10)",
  red: "#ef4444",   redBg: "rgba(239,68,68,0.10)",
  orange: "#f97316",
  blue: "#3b82f6",
  purple: "#a78bfa",
};

const STATUS_CONFIG = {
  ai_likely: { color: C.red,    bg: C.redBg,    icon: "🤖", label: "AI-Likely"       },
  uncertain: { color: C.yellow, bg: C.yellowBg,  icon: "❓", label: "Uncertain"       },
  human:     { color: C.green,  bg: C.greenBg,   icon: "✓",  label: "Verified Human"  },
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 12, padding: "14px 16px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 12 }}>
      <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: C.text, textAlign: "right", flex: 1 }}>{children}</span>
    </div>
  );
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: `${color}20`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{
          width: `${value}%`, height: "100%",
          background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          borderRadius: 10,
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, width: 32, textAlign: "right" }}>{value}%</span>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "52px 24px", textAlign: "center" }}>
      <div style={{
        width: 64, height: 64, borderRadius: 18,
        background: `linear-gradient(135deg, ${C.accent}20, ${C.purple}20)`,
        border: `1px solid ${C.accent}30`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
      }}>📌</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}>No Citation Selected</div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, maxWidth: 240 }}>
          Click any citation marker in the PDF to see its full details here.
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CitationDetailTab({
  selectedCitationId,
  citations,
  reliabilityData,
  networkData,
  onCitationSelect,
}: {
  selectedCitationId: string | null;
  citations: CitationResult[];
  reliabilityData: { citations: ReliabilityCitation[] } | null;
  networkData: CitationNetworkData | null;
  onCitationSelect?: (id: string) => void;
}) {
  if (!selectedCitationId) return <EmptyState />;

  const aiCit = citations.find(c => c.id === selectedCitationId);

  const idx  = citations.findIndex(c => c.id === selectedCitationId);
  const prev = idx > 0 ? citations[idx - 1] : null;
  const next = idx < citations.length - 1 ? citations[idx + 1] : null;
  const prevCfg = prev ? STATUS_CONFIG[prev.status] : null;
  const nextCfg = next ? STATUS_CONFIG[next.status] : null;
  const relCit = reliabilityData?.citations.find(c => c.id === selectedCitationId);

  // Find which cluster this citation belongs to
  let clusterName: string | null = null;
  let clusterColor: string | null = null;
  if (networkData) {
    for (const cluster of networkData.clusters) {
      if (cluster.papers.some(p => p.id === selectedCitationId)) {
        clusterName = cluster.name;
        clusterColor = cluster.color;
        break;
      }
    }
    if (!clusterName && networkData.orphans.some(o => o.id === selectedCitationId)) {
      clusterName = "Orphaned";
      clusterColor = "orange";
    }
  }

  const CLUSTER_DOT: Record<string, string> = {
    blue: "#3b82f6", purple: "#a78bfa", green: "#10b981",
    orange: "#f97316", cyan: "#06b6d4",
  };

  const title = aiCit?.title ?? relCit?.title ?? "Unknown";
  const year = aiCit?.year ?? (relCit?.year ? parseInt(relCit.year) : null);
  const doi = aiCit?.doi ?? aiCit?.discovered_doi ?? null;
  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
  const doiUrl = doi ? `https://doi.org/${doi}` : null;

  const statusCfg = aiCit ? STATUS_CONFIG[aiCit.status] : null;
  const revColor = relCit && relCit.relevance != null
    ? relCit.relevance >= 70 ? C.green : relCit.relevance >= 40 ? C.yellow : C.red
    : C.textDim;

  return (
    <div style={{ padding: "16px 16px 32px", animation: "fadeIn 0.25s ease" }}>

      {/* Prev / Next navigation */}
      {onCitationSelect && citations.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <button
            onClick={() => prev && onCitationSelect(prev.id)}
            disabled={!prev}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 8,
              border: `1px solid ${prev ? (prevCfg?.color ?? C.border) + "40" : C.border}`,
              background: prev ? `${prevCfg?.color ?? C.accent}0a` : "transparent",
              color: prev ? prevCfg?.color ?? C.accent : C.textDim,
              fontSize: 11, fontWeight: 600, cursor: prev ? "pointer" : "default",
              opacity: prev ? 1 : 0.35, transition: "all 0.15s",
            }}
          >
            ← {prev?.id ?? ""}
          </button>
          <span style={{ fontSize: 10, color: C.textDim }}>
            {idx + 1} / {citations.length}
          </span>
          <button
            onClick={() => next && onCitationSelect(next.id)}
            disabled={!next}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 8,
              border: `1px solid ${next ? (nextCfg?.color ?? C.border) + "40" : C.border}`,
              background: next ? `${nextCfg?.color ?? C.accent}0a` : "transparent",
              color: next ? nextCfg?.color ?? C.accent : C.textDim,
              fontSize: 11, fontWeight: 600, cursor: next ? "pointer" : "default",
              opacity: next ? 1 : 0.35, transition: "all 0.15s",
            }}
          >
            {next?.id ?? ""} →
          </button>
        </div>
      )}

      {/* Citation ID + title */}
      <div style={{
        background: C.card, border: `1px solid ${C.cardBorder}`,
        borderLeft: `3px solid ${statusCfg?.color ?? C.accent}`,
        borderRadius: 12, padding: "14px 16px", marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: 800, color: statusCfg?.color ?? C.accent,
            fontFamily: "monospace",
          }}>{selectedCitationId}</span>
          {statusCfg && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: statusCfg.color,
              background: statusCfg.bg, padding: "2px 8px",
              borderRadius: 20, border: `1px solid ${statusCfg.color}30`,
            }}>
              {statusCfg.icon} {statusCfg.label}
            </span>
          )}
          {aiCit?.duplicate_of && (
            <span style={{ fontSize: 9.5, color: C.orange, background: `${C.orange}15`, padding: "1px 6px", borderRadius: 10 }}>
              dup of {aiCit.duplicate_of}
            </span>
          )}
        </div>

        {/* Title as link */}
        <a
          href={doiUrl ?? scholarUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.5,
            textDecoration: "none", borderBottom: `1px dashed ${C.accent}50`,
            display: "block",
          }}
          onMouseEnter={e => (e.currentTarget.style.borderBottomStyle = "solid")}
          onMouseLeave={e => (e.currentTarget.style.borderBottomStyle = "dashed")}
        >
          {title}
        </a>

        {/* Metadata row */}
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          {year && <span style={{ fontSize: 10.5, color: C.textDim }}>{year}</span>}
          {relCit?.venue && <span style={{ fontSize: 10.5, color: C.textDim }}>· {relCit.venue}</span>}
          {doi && (
            <a href={doiUrl!} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10.5, color: C.accent, textDecoration: "none" }}>
              DOI ↗
            </a>
          )}
          <a href={scholarUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10.5, color: C.accent, textDecoration: "none" }}>
            Scholar ↗
          </a>
        </div>
      </div>

      {/* AI Detection */}
      {aiCit && (
        <Section title="AI Detection" icon="🤖">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            {/* Donut score */}
            <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
              {(() => {
                const displayScore = aiCit.status === "human" ? 100 : aiCit.aiScore;
                const r = 22, circ = 2 * Math.PI * r;
                const color = aiCit.status === "human" ? C.green : aiCit.aiScore >= 70 ? C.red : aiCit.aiScore >= 40 ? C.yellow : C.green;
                return (
                  <svg width={52} height={52} style={{ transform: "rotate(-90deg)" }}>
                    <circle cx={26} cy={26} r={r} fill="none" stroke={`${color}20`} strokeWidth={3.5} />
                    <circle cx={26} cy={26} r={r} fill="none" stroke={color} strokeWidth={3.5}
                      strokeDasharray={circ} strokeDashoffset={circ - (displayScore / 100) * circ}
                      strokeLinecap="round" />
                  </svg>
                );
              })()}
              <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 11, fontWeight: 700,
                color: aiCit.status === "human" ? C.green : aiCit.aiScore >= 70 ? C.red : aiCit.aiScore >= 40 ? C.yellow : C.green,
              }}>{aiCit.status === "human" ? 100 : aiCit.aiScore}%</div>
            </div>
            <div style={{ flex: 1 }}>
              {aiCit.reasoning && (
                <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
                  {aiCit.reasoning}
                </div>
              )}
            </div>
          </div>

          {/* Found in databases */}
          {aiCit.found_in !== undefined && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: aiCit.flags.length > 0 ? 8 : 0 }}>
              {aiCit.found_in.length === 0
                ? <span style={{ fontSize: 10, color: C.red, background: `${C.red}15`, padding: "2px 7px", borderRadius: 10, border: `1px solid ${C.red}30` }}>⚠ Not found in any database</span>
                : aiCit.found_in.map(db => (
                  <span key={db} style={{ fontSize: 10, color: C.green, background: `${C.green}15`, padding: "2px 7px", borderRadius: 10, border: `1px solid ${C.green}30` }}>✓ {db}</span>
                ))
              }
            </div>
          )}

          {/* Flags */}
          {aiCit.flags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {aiCit.flags.map((f, i) => (
                <span key={i} style={{ fontSize: 10, color: C.orange, background: `${C.orange}15`, padding: "2px 7px", borderRadius: 10, border: `1px solid ${C.orange}30` }}>⚠ {f}</span>
              ))}
            </div>
          )}

          {/* In-text usage */}
          {aiCit.contexts && aiCit.contexts.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Used in paper:</div>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5, fontStyle: "italic" }}>
                "...{aiCit.contexts[0].slice(0, 200)}..."
              </div>
              {aiCit.contexts.length > 1 && (
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>+{aiCit.contexts.length - 1} more usage{aiCit.contexts.length > 2 ? "s" : ""}</div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Relevance */}
      {relCit && (
        <Section title="Relevance" icon="📍">
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Claim Support</div>
            {relCit.relevance != null
              ? <ScoreBar value={relCit.relevance} color={revColor} />
              : <span style={{ fontSize: 11, color: C.textDim, fontStyle: "italic" }}>Not assessed — no abstract</span>
            }
          </div>
          {relCit.claim && (
            <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5, marginTop: 8, padding: "8px 10px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}` }}>
              {relCit.claim}
            </div>
          )}
          {relCit.warning && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.orange, background: `${C.orange}10`, padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.orange}25` }}>
              ⚠ {relCit.warning}
            </div>
          )}
          {relCit.flags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
              {relCit.flags.map((f, i) => (
                <span key={i} style={{ fontSize: 10, color: C.orange, background: `${C.orange}15`, padding: "2px 7px", borderRadius: 10, border: `1px solid ${C.orange}30` }}>⚠ {f}</span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Network cluster */}
      {networkData && (
        <Section title="Citation Network" icon="🕸️">
          {clusterName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: clusterColor ? CLUSTER_DOT[clusterColor] ?? C.accent : C.orange,
              }} />
              <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{clusterName}</span>
              {clusterName === "Orphaned" && (
                <span style={{ fontSize: 10, color: C.orange, background: `${C.orange}15`, padding: "1px 7px", borderRadius: 10 }}>isolated</span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: C.textDim }}>Not found in network data</span>
          )}
        </Section>
      )}

      {/* No data fallback */}
      {!aiCit && !relCit && (
        <div style={{ textAlign: "center", padding: "24px 0", color: C.textDim, fontSize: 12 }}>
          Analysis data not yet available for this citation.
        </div>
      )}
    </div>
  );
}
