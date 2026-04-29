import { useState } from "react";

export interface AlignmentClaim {
  text: string;
  has_match: boolean;
  match_index: number | null;
}

export interface AlignmentData {
  abstract_text: string;
  conclusion_text: string;
  abstract_claims: AlignmentClaim[];
  conclusion_claims: AlignmentClaim[];
  found: boolean;
}

const MATCH_COLORS = [
  { bg: "rgba(99,102,241,0.18)",  border: "rgba(99,102,241,0.7)",  text: "#818cf8" },
  { bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.7)",  text: "#34d399" },
  { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.7)",  text: "#fbbf24" },
  { bg: "rgba(236,72,153,0.18)",  border: "rgba(236,72,153,0.7)",  text: "#f472b6" },
  { bg: "rgba(59,130,246,0.18)",  border: "rgba(59,130,246,0.7)",  text: "#60a5fa" },
  { bg: "rgba(168,85,247,0.18)",  border: "rgba(168,85,247,0.7)",  text: "#c084fc" },
];

const UNMATCHED = {
  bg: "rgba(100,116,139,0.12)",
  border: "rgba(100,116,139,0.35)",
  text: "#94a3b8",
};

const C = {
  bg: "#0a0e1a",
  surface: "#111827",
  surface2: "#0f172a",
  border: "#1e293b",
  text: "#f1f5f9",
  dim: "#64748b",
};

function ClaimPill({
  claim,
  colorIndex,
  side,
  onHover,
  highlighted,
}: {
  claim: AlignmentClaim;
  colorIndex: number;
  side: "abstract" | "conclusion";
  onHover: (idx: number | null) => void;
  highlighted: boolean;
}) {
  const color = claim.has_match ? MATCH_COLORS[colorIndex % MATCH_COLORS.length] : UNMATCHED;

  return (
    <div
      onMouseEnter={() => claim.has_match && claim.match_index !== null && onHover(claim.match_index)}
      onMouseLeave={() => onHover(null)}
      style={{
        background: highlighted ? color.bg.replace(/[\d.]+\)$/, "0.35)") : color.bg,
        border: `1px solid ${highlighted ? color.border : color.border.replace(/[\d.]+\)$/, "0.45)")}`,
        borderRadius: 8,
        padding: "7px 11px",
        fontSize: 12,
        color: claim.has_match ? color.text : C.dim,
        cursor: claim.has_match ? "default" : "default",
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        boxShadow: highlighted ? `0 0 0 1px ${color.border}` : "none",
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1 }}>
        {claim.has_match ? (
          <span style={{ color: color.text, fontSize: 10 }}>●</span>
        ) : (
          <span style={{ color: C.dim, fontSize: 10 }}>○</span>
        )}
      </span>
      <span style={{ lineHeight: 1.45 }}>{claim.text}</span>
      {!claim.has_match && (
        <span style={{
          marginLeft: "auto", flexShrink: 0,
          fontSize: 9, color: "#ef4444",
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 4, padding: "1px 5px",
        }}>
          only {side === "abstract" ? "in abstract" : "in conclusion"}
        </span>
      )}
    </div>
  );
}

export default function AlignmentDrawer({
  data,
  loading,
  open,
  onClose,
}: {
  data: AlignmentData | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<{ side: "abstract" | "conclusion"; idx: number } | null>(null);

  if (!open) return null;

  const drawerHeight = 320;

  const getAbstractColorIndex = (claim: AlignmentClaim, i: number) => {
    // matched abstract claims get color by their own index among matched ones
    const matchedBefore = (data?.abstract_claims ?? []).slice(0, i).filter(c => c.has_match).length;
    return matchedBefore;
  };

  const getConclusionColorIndex = (claim: AlignmentClaim) => {
    // matched conclusion claims: color by their match_index (which abstract claim they match)
    if (!claim.has_match || claim.match_index === null) return 0;
    const abstract_claims = data?.abstract_claims ?? [];
    const matchedBefore = abstract_claims.slice(0, claim.match_index).filter(c => c.has_match).length;
    return matchedBefore;
  };

  const isAbstractHighlighted = (claim: AlignmentClaim, i: number): boolean => {
    if (!hoveredIdx || hoveredIdx.side !== "conclusion") return false;
    if (!claim.has_match) return false;
    // this abstract claim is highlighted if its index matches the hovered conclusion's match_index
    const hovClaim = data?.conclusion_claims[hoveredIdx.idx];
    if (!hovClaim?.has_match) return false;
    return hovClaim.match_index === i;
  };

  const isConclusionHighlighted = (claim: AlignmentClaim, i: number): boolean => {
    if (!hoveredIdx || hoveredIdx.side !== "abstract") return false;
    if (!claim.has_match) return false;
    const hovClaim = data?.abstract_claims[hoveredIdx.idx];
    if (!hovClaim?.has_match) return false;
    return claim.match_index === hoveredIdx.idx;
  };

  return (
    <div style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: drawerHeight,
      background: C.surface2,
      borderTop: `1px solid #334155`,
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
        gap: 10,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          Abstract ↔ Conclusion Alignment
        </span>
        {data && !loading && (
          <>
            <span style={{
              fontSize: 11,
              color: C.dim,
              marginLeft: 4,
            }}>
              {data.abstract_claims.filter(c => c.has_match).length} matched ·{" "}
              {data.abstract_claims.filter(c => !c.has_match).length + data.conclusion_claims.filter(c => !c.has_match).length} unmatched
            </span>
            <div style={{
              display: "flex", gap: 6, marginLeft: 8, alignItems: "center", flexWrap: "wrap"
            }}>
              {MATCH_COLORS.slice(0, Math.min(
                data.abstract_claims.filter(c => c.has_match).length,
                MATCH_COLORS.length
              )).map((col, i) => (
                <span key={i} style={{
                  width: 8, height: 8, borderRadius: 2,
                  background: col.bg, border: `1px solid ${col.border}`,
                  display: "inline-block",
                }} />
              ))}
            </div>
          </>
        )}
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto", background: "none", border: "none",
            color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {loading ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.dim, fontSize: 13, gap: 10,
          }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Analyzing alignment…
          </div>
        ) : !data || !data.found ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.dim, fontSize: 13,
          }}>
            Could not extract abstract or conclusion from this paper.
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Abstract column */}
            <div style={{
              flex: 1,
              borderRight: `1px solid ${C.border}`,
              overflow: "auto",
              padding: "14px 16px",
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#6366f1",
                letterSpacing: "0.08em", textTransform: "uppercase",
                marginBottom: 10,
              }}>
                Abstract
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {data.abstract_claims.map((claim, i) => (
                  <ClaimPill
                    key={i}
                    claim={claim}
                    colorIndex={getAbstractColorIndex(claim, i)}
                    side="abstract"
                    onHover={(idx) => setHoveredIdx(idx !== null ? { side: "abstract", idx: i } : null)}
                    highlighted={isAbstractHighlighted(claim, i)}
                  />
                ))}
              </div>
            </div>

            {/* Conclusion column */}
            <div style={{
              flex: 1,
              overflow: "auto",
              padding: "14px 16px",
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#10b981",
                letterSpacing: "0.08em", textTransform: "uppercase",
                marginBottom: 10,
              }}>
                Conclusion
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {data.conclusion_claims.map((claim, i) => (
                  <ClaimPill
                    key={i}
                    claim={claim}
                    colorIndex={getConclusionColorIndex(claim)}
                    side="conclusion"
                    onHover={(idx) => setHoveredIdx(idx !== null ? { side: "conclusion", idx: i } : null)}
                    highlighted={isConclusionHighlighted(claim, i)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
