import { useState, useMemo, useRef, useEffect } from "react";
import { CitationResult } from "../types";
import { useTheme } from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReliabilityCitation {
  id: string;
  title: string;
  venue: string;
  year: string;
  relevance: number | null;
  verdict: string;
  flags: string[];
  claim: string;
  warning: string | null;
  abstractFound?: boolean;
  citationCount?: number;
  contexts?: string[];
  category?: string;
}

export interface ReliabilitySummary {
  avg_reliability: number;
  avg_relevance: number;
  flagged: number;
  self_citations: number;
  total: number;
  no_abstract?: number;
}

export interface ReliabilityData {
  citations: ReliabilityCitation[];
  summary: ReliabilitySummary;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "Directly Relevant":  "#6366f1",
  "Methodological":     "#3b82f6",
  "Background":         "#64748b",
  "Baseline":           "#10b981",
  "Inspiration":        "#a78bfa",
  "Gap Identification": "#f59e0b",
  "Example":            "#06b6d4",
  "Unknown":            "#334155",
};

const VERDICT_COLOR: Record<string, string> = {
  strong:      "#10b981",
  moderate:    "#f59e0b",
  weak:        "#f97316",
  unsupported: "#ef4444",
  no_data:     "#64748b",
};

const VERDICT_LABEL: Record<string, string> = {
  strong:      "Strong",
  moderate:    "Moderate",
  weak:        "Weak",
  unsupported: "Unsupported",
  no_data:     "No Data",
};

// ─── Primitives ───────────────────────────────────────────────────────────────

function scoreColor(v: number, green: string, yellow: string, red: string) {
  if (v >= 70) return green;
  if (v >= 45) return yellow;
  return red;
}

function StatBox({
  value, label, color, sub,
}: {
  value: any; label: string; color: string; sub?: string;
}) {
  const { C } = useTheme();
  return (
    <div style={{
      flex: 1, textAlign: "center", padding: "12px 6px",
      background: `linear-gradient(135deg, ${color}06, ${color}12)`,
      borderRadius: 10, border: `1px solid ${color}20`,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Verdict Distribution Bar ─────────────────────────────────────────────────

function VerdictBar({ citations }: { citations: ReliabilityCitation[] }) {
  const { C } = useTheme();
  const counts: Record<string, number> = { strong: 0, moderate: 0, weak: 0, unsupported: 0, no_data: 0 };
  citations.forEach(c => {
    const v = c.verdict ?? "no_data";
    counts[v] = (counts[v] ?? 0) + 1;
  });
  const order = ["strong", "moderate", "weak", "unsupported", "no_data"];
  const total = citations.length;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 18px", marginBottom: 14,
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 10,
        textTransform: "uppercase", letterSpacing: 0.5,
      }}>
        Claim Support Distribution
      </div>
      <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {order.map(v => counts[v] > 0 && (
          <div key={v} title={`${VERDICT_LABEL[v]}: ${counts[v]}`} style={{
            flex: counts[v], background: VERDICT_COLOR[v],
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.5)",
            transition: "flex 0.5s ease",
          }}>
            {counts[v] > 1 ? counts[v] : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        {order.map(v => counts[v] > 0 && (
          <div key={v} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: VERDICT_COLOR[v] }} />
            <span style={{ fontSize: 12, color: C.textMuted }}>{VERDICT_LABEL[v]}</span>
            <span style={{ fontSize: 12, color: C.textDim }}>
              {counts[v]} ({Math.round(counts[v] / total * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bubble Chart ─────────────────────────────────────────────────────────────

function BubbleChart({ citations, onBubbleClick }: { citations: ReliabilityCitation[]; onBubbleClick?: (id: string) => void }) {
  const { C } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  const W = 560, H = 270, PL = 44, PR = 24, PT = 16, PB = 36;
  const iW = W - PL - PR, iH = H - PT - PB;

  const assessed = citations.filter(c => c.relevance !== null && c.year && !isNaN(parseInt(c.year)));
  const noData   = citations.filter(c => c.relevance === null);

  const years = assessed.map(c => parseInt(c.year));
  const minYear = years.length ? Math.min(...years) - 1 : 2015;
  const maxYear = years.length ? Math.max(...years) + 1 : 2024;
  const yearRange = maxYear - minYear || 1;

  const toX = (y: number) => PL + ((y - minYear) / yearRange) * iW;
  const toY = (r: number) => PT + iH - (r / 100) * iH;
  const BUBBLE_R = 11;
  const MIN_DIST  = BUBBLE_R * 2 + 3; // minimum center-to-center gap

  // Pre-compute non-overlapping positions via iterative collision resolution
  const positions = useMemo(() => {
    const pos: Record<string, { cx: number; cy: number }> = {};
    assessed.forEach(c => {
      pos[c.id] = {
        cx: PL + ((parseInt(c.year) - minYear) / yearRange) * iW,
        cy: PT + iH - ((c.relevance as number) / 100) * iH,
      };
    });
    for (let iter = 0; iter < 120; iter++) {
      let anyMoved = false;
      const ids = Object.keys(pos);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const dx = b.cx - a.cx, dy = b.cy - a.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MIN_DIST && dist > 0.01) {
            const push = (MIN_DIST - dist) / 2 + 0.5;
            const nx = dx / dist, ny = dy / dist;
            a.cx -= nx * push; a.cy -= ny * push;
            b.cx += nx * push; b.cy += ny * push;
            anyMoved = true;
          }
        }
      }
      // Clamp to plot area
      Object.values(pos).forEach(p => {
        p.cx = Math.max(PL + BUBBLE_R + 2, Math.min(PL + iW - BUBBLE_R - 2, p.cx));
        p.cy = Math.max(PT + BUBBLE_R + 2, Math.min(PT + iH - BUBBLE_R - 2, p.cy));
      });
      if (!anyMoved) break;
    }
    return pos;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citations]);

  const tickStep = yearRange <= 5 ? 1 : yearRange <= 10 ? 2 : yearRange <= 20 ? 4 : 5;
  const yearTicks: number[] = [];
  for (let y = Math.ceil((minYear + 1) / tickStep) * tickStep; y <= maxYear - 1; y += tickStep) {
    yearTicks.push(y);
  }

  const noDataH = noData.length > 0 ? 34 : 0;
  const totalH  = H + noDataH;
  const hoveredCit = citations.find(c => c.id === hovered);

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 18px", marginBottom: 14,
    }}>
      {/* Header + legend */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>📍 Citation Relevance Map</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {["strong", "moderate", "weak", "unsupported"].map(v => (
            <div key={v} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.textMuted }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: VERDICT_COLOR[v] }} />
              {VERDICT_LABEL[v]}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.textMuted }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px dashed ${C.textDim}` }} />
            No Abstract
          </div>
        </div>
      </div>

      {/* Chart */}
      <svg width="100%" viewBox={`0 0 ${W} ${totalH}`} style={{ display: "block", overflow: "visible" }}>
        {/* Y-axis grid + labels */}
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={PL} y1={toY(v)} x2={PL + iW} y2={toY(v)} stroke="#ffffff07" strokeDasharray="4,4" />
            <text x={PL - 6} y={toY(v) + 4} fill="#475569" fontSize={9} textAnchor="end">{v}</text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PL} y1={PT}      x2={PL}      y2={PT + iH} stroke={C.border} />
        <line x1={PL} y1={PT + iH} x2={PL + iW} y2={PT + iH} stroke={C.border} />

        {/* X-axis ticks */}
        {yearTicks.map(y => (
          <g key={y}>
            <line x1={toX(y)} y1={PT + iH} x2={toX(y)} y2={PT + iH + 4} stroke="#334155" />
            <text x={toX(y)} y={PT + iH + 14} fill="#475569" fontSize={9} textAnchor="middle">{y}</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={PL + iW / 2} y={H - 2}           fill="#475569" fontSize={10} textAnchor="middle">Publication Year →</text>
        <text x={12}          y={PT + iH / 2}      fill="#475569" fontSize={10} textAnchor="middle"
          transform={`rotate(-90,12,${PT + iH / 2})`}>Relevance →</text>

        {/* Assessed bubbles — collision-resolved positions */}
        {assessed.map(c => {
          const pos   = positions[c.id];
          if (!pos) return null;
          const color = VERDICT_COLOR[c.verdict] ?? C.textDim;
          const isHov = hovered === c.id;
          return (
            <g key={c.id} style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBubbleClick?.(c.id)}>
              <circle cx={pos.cx} cy={pos.cy} r={BUBBLE_R + (isHov ? 3 : 0)}
                fill={`${color}22`} stroke={color}
                strokeWidth={isHov ? 2.5 : 1.5} />
              <text x={pos.cx} y={pos.cy + 4} textAnchor="middle" fill={color}
                fontSize={9} fontWeight={700} style={{ pointerEvents: "none" }}>
                {c.id}
              </text>
            </g>
          );
        })}

        {/* No-data strip below X axis */}
        {noData.length > 0 && (
          <>
            <text x={PL - 6} y={H + 18} fill="#334155" fontSize={8} textAnchor="end">N/A</text>
            <line x1={PL} y1={H + 6} x2={PL + iW} y2={H + 6} stroke="#1e293b" strokeDasharray="3,3" />
            {noData.map((c, i) => {
              const cx = PL + 14 + (i % Math.floor(iW / 28)) * 28;
              const cy = H + 20;
              return (
                <g key={c.id} style={{ cursor: "pointer" }} opacity={0.45}
                  onMouseEnter={() => setHovered(c.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onBubbleClick?.(c.id)}>
                  <circle cx={cx} cy={cy} r={9} fill="transparent"
                    stroke={C.textDim} strokeWidth={1.5} strokeDasharray="3,2" />
                  <text x={cx} y={cy + 4} textAnchor="middle" fill={C.textDim}
                    fontSize={7} fontWeight={700} style={{ pointerEvents: "none" }}>{c.id}</text>
                </g>
              );
            })}
          </>
        )}
      </svg>


      {/* Hover tooltip */}
      {hoveredCit && (
        <div style={{
          marginTop: 10, padding: "8px 12px",
          background: C.card, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${VERDICT_COLOR[hoveredCit.verdict] ?? C.textDim}`,
          borderRadius: 8,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>{hoveredCit.id}</span>
            <span style={{ fontSize: 13, color: C.text }}>
              {hoveredCit.title.slice(0, 65)}{hoveredCit.title.length > 65 ? "…" : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.textMuted, flexWrap: "wrap" }}>
            <span>
              Relevance:{" "}
              <b style={{ color: VERDICT_COLOR[hoveredCit.verdict] ?? C.textDim }}>
                {hoveredCit.relevance != null ? `${hoveredCit.relevance}%` : "N/A"}
              </b>
            </span>
            <span>
              Verdict:{" "}
              <b style={{ color: VERDICT_COLOR[hoveredCit.verdict] ?? C.textDim }}>
                {VERDICT_LABEL[hoveredCit.verdict] ?? hoveredCit.verdict}
              </b>
            </span>
            <span>Year: <b style={{ color: C.text }}>{hoveredCit.year || "—"}</b></span>
            <span>Impact: <b style={{ color: C.text }}>{hoveredCit.citationCount != null ? hoveredCit.citationCount.toLocaleString() : "—"}</b></span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: C.textDim, fontStyle: "italic" }}>click to expand in table ↓</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Category Pie Chart ───────────────────────────────────────────────────────

function CategoryPieChart({
  citations,
  activeCategory,
  onCategoryClick,
}: {
  citations: ReliabilityCitation[];
  activeCategory: string | null;
  onCategoryClick: (cat: string | null) => void;
}) {
  const { C } = useTheme();
  const counts: Record<string, number> = {};
  citations.forEach(c => {
    const cat = c.category ?? "Unknown";
    counts[cat] = (counts[cat] ?? 0) + 1;
  });

  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = citations.length;
  if (entries.length === 0 || entries.every(([cat]) => cat === "Unknown")) return null;

  const CX = 90, CY = 90, R = 72, RI = 44;
  let cumAngle = -Math.PI / 2;

  const slices = entries.map(([cat, count]) => {
    const start = cumAngle;
    const sweep = (count / total) * Math.PI * 2;
    cumAngle += sweep;
    return { cat, count, start, end: cumAngle };
  });

  function pt(r: number, angle: number) {
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  }

  function slicePath(start: number, end: number) {
    const large = end - start > Math.PI ? 1 : 0;
    const o1 = pt(R, start), o2 = pt(R, end);
    const i1 = pt(RI, start), i2 = pt(RI, end);
    return `M ${o1.x} ${o1.y} A ${R} ${R} 0 ${large} 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${RI} ${RI} 0 ${large} 0 ${i1.x} ${i1.y} Z`;
  }

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 18px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>
        🎯 Citation Category Breakdown
        {activeCategory && (
          <button
            onClick={() => onCategoryClick(null)}
            style={{
              marginLeft: 10, fontSize: 12, color: C.accent,
              background: `${C.accent}15`, border: `1px solid ${C.accent}30`,
              borderRadius: 8, padding: "1px 8px", cursor: "pointer",
            }}
          >
            ✕ clear
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {/* Donut */}
        <svg width={180} height={180} style={{ flexShrink: 0 }}>
          {slices.map(({ cat, count, start, end }) => {
            const color = CATEGORY_COLORS[cat] ?? C.textDim;
            const isActive = activeCategory === cat;
            const dimmed = activeCategory !== null && !isActive;
            const mid = (start + end) / 2;
            const ox = isActive ? Math.cos(mid) * 6 : 0;
            const oy = isActive ? Math.sin(mid) * 6 : 0;
            return (
              <g
                key={cat}
                transform={`translate(${ox},${oy})`}
                onClick={() => onCategoryClick(isActive ? null : cat)}
                style={{ cursor: "pointer", opacity: dimmed ? 0.3 : 1, transition: "opacity 0.15s, transform 0.15s" }}
              >
                <path d={slicePath(start, end)} fill={color} stroke={C.surface} strokeWidth={2} />
              </g>
            );
          })}
          {/* Center */}
          <text x={CX} y={CY - 5} textAnchor="middle" fill={C.text} fontSize={20} fontWeight={800} fontFamily="monospace">{total}</text>
          <text x={CX} y={CY + 11} textAnchor="middle" fill={C.textDim} fontSize={9}>total</text>
        </svg>

        {/* Legend */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {entries.filter(([cat]) => cat !== "Unknown").map(([cat, count]) => {
            const color = CATEGORY_COLORS[cat] ?? C.textDim;
            const isActive = activeCategory === cat;
            const pct = Math.round((count / total) * 100);
            return (
              <div
                key={cat}
                onClick={() => onCategoryClick(isActive ? null : cat)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "3px 6px", borderRadius: 6,
                  background: isActive ? `${color}18` : "transparent",
                  border: `1px solid ${isActive ? color + "40" : "transparent"}`,
                  opacity: activeCategory && !isActive ? 0.45 : 1,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: isActive ? color : C.textMuted, flex: 1 }}>{cat}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "monospace" }}>{count}</span>
                <span style={{ fontSize: 12, color: C.textDim, width: 26, textAlign: "right" }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {activeCategory && (
        <div style={{ marginTop: 8, fontSize: 13, color: C.textMuted }}>
          Showing <span style={{ color: CATEGORY_COLORS[activeCategory] ?? C.accent, fontWeight: 600 }}>{activeCategory}</span> citations in table below
        </div>
      )}
    </div>
  );
}

// ─── Citation Table ───────────────────────────────────────────────────────────

type SortKey = "relevance" | "year" | "impact";

function CitationTable({ citations, aiCitations, expandedId, onExpandChange }: {
  citations: ReliabilityCitation[];
  aiCitations: CitationResult[];
  expandedId: string | null;
  onExpandChange: (id: string | null) => void;
}) {
  const { C } = useTheme();
  const [sort, setSort] = useState<{ by: SortKey; dir: 1 | -1 }>({ by: "relevance", dir: -1 });
  const expandedRowRef  = useRef<HTMLTableRowElement>(null);

  // Scroll expanded row into view when it changes
  useEffect(() => {
    if (expandedId && expandedRowRef.current) {
      expandedRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedId]);

  const handleSort = (by: SortKey) =>
    setSort(prev => prev.by === by ? { by, dir: (-prev.dir) as 1 | -1 } : { by, dir: -1 });

  const sorted = [...citations].sort((a, b) => {
    if (sort.by === "relevance") return sort.dir * ((a.relevance ?? -1) - (b.relevance ?? -1));
    if (sort.by === "year")      return sort.dir * ((parseInt(a.year) || 0) - (parseInt(b.year) || 0));
    if (sort.by === "impact")    return sort.dir * ((a.citationCount ?? 0) - (b.citationCount ?? 0));
    return 0;
  });

  const SortTh = ({ label, by, width }: { label: string; by: SortKey; width?: number }) => (
    <th onClick={() => handleSort(by)} style={{
      padding: "10px 10px 8px", textAlign: "right", fontSize: 12, width,
      color: sort.by === by ? C.accent : C.textDim,
      textTransform: "uppercase", letterSpacing: 0.4,
      cursor: "pointer", userSelect: "none",
    }}>
      {label} {sort.by === by ? (sort.dir === -1 ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "8px 6px 8px 10px", textAlign: "left", fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 34 }}>ID</th>
              <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4 }}>Title</th>
              <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, width: 82 }}>Verdict</th>
              <SortTh label="Rel."  by="relevance" width={52} />
              <SortTh label="Year"  by="year"      width={44} />
              <SortTh label="Cited" by="impact"    width={52} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => {
              const color      = VERDICT_COLOR[c.verdict] ?? C.textDim;
              const isSelected = expandedId === c.id;
              const rowAi      = aiCitations.find(a => a.id === c.id) ?? null;
              const rowColor   = VERDICT_COLOR[c.verdict] ?? C.textDim;
              return (
                <>
                  <tr key={c.id}
                    ref={isSelected ? (expandedRowRef as React.RefObject<HTMLTableRowElement>) : null}
                    onClick={() => onExpandChange(isSelected ? null : c.id)}
                    style={{
                      borderBottom: !isSelected && i < sorted.length - 1 ? `1px solid ${C.border}44` : "none",
                      background: isSelected ? `${color}10` : "transparent",
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${C.card}99`; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? `${color}10` : "transparent"; }}
                  >
                    <td style={{ padding: "8px 6px 8px 10px", borderLeft: `3px solid ${color}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>{c.id}</span>
                    </td>
                    <td style={{ padding: "8px 6px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 0 }} title={c.title}>
                      <span style={{ fontSize: 13, color: C.textMuted }}>{c.title}</span>
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "center" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color, background: `${color}18`, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
                        {VERDICT_LABEL[c.verdict] ?? c.verdict}
                      </span>
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right" }}>
                      {c.relevance != null
                        ? <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "monospace" }}>{c.relevance}%</span>
                        : <span style={{ fontSize: 12, color: C.textDim, fontStyle: "italic" }}>N/A</span>
                      }
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 12, color: C.textMuted, fontFamily: "monospace" }}>
                      {c.year || "—"}
                    </td>
                    <td style={{ padding: "8px 8px 8px 6px", textAlign: "right", fontSize: 12, color: C.textDim, fontFamily: "monospace" }}>
                      {c.citationCount != null ? c.citationCount.toLocaleString() : "—"}
                      <span style={{ marginLeft: 5, fontSize: 11, color: isSelected ? rowColor : C.textDim }}>{isSelected ? "▴" : "▾"}</span>
                    </td>
                  </tr>
                  {isSelected && (
                    <tr key={`${c.id}-detail`}>
                      <td colSpan={6} style={{ padding: "0 0 8px 0", borderBottom: i < sorted.length - 1 ? `1px solid ${C.border}44` : "none" }}>
                        <div style={{
                          margin: "0 8px",
                          background: C.card, border: `1px solid ${rowColor}33`,
                          borderLeft: `3px solid ${rowColor}`,
                          borderRadius: 10, padding: "14px 14px 14px 16px",
                          animation: "fadeIn 0.2s ease",
                        }}>
                          {/* Relevance bar */}
                          {c.relevance != null ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                              <span style={{ fontSize: 13, color: C.textMuted, width: 64, flexShrink: 0 }}>Relevance</span>
                              <div style={{ flex: 1, height: 6, background: "#1a2235", borderRadius: 99, overflow: "hidden" }}>
                                <div style={{
                                  height: "100%", width: `${c.relevance}%`,
                                  background: `linear-gradient(90deg, ${rowColor}bb, ${rowColor})`,
                                  borderRadius: 99, boxShadow: `0 0 6px ${rowColor}44`,
                                  transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
                                }} />
                              </div>
                              <span style={{ fontSize: 14, fontWeight: 700, color: rowColor, fontFamily: "monospace", width: 34, textAlign: "right" }}>{c.relevance}%</span>
                            </div>
                          ) : (
                            <div style={{ fontSize: 13, color: C.textDim, fontStyle: "italic", marginBottom: 12 }}>
                              No abstract found — relevance could not be assessed.
                            </div>
                          )}

                          {/* Category badge */}
                          {c.category && c.category !== "Unknown" && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                              <span style={{ fontSize: 13, color: C.textMuted, width: 64, flexShrink: 0 }}>Category</span>
                              <span style={{
                                fontSize: 13, fontWeight: 600,
                                color: CATEGORY_COLORS[c.category] ?? C.textDim,
                                background: `${CATEGORY_COLORS[c.category] ?? C.textDim}18`,
                                padding: "2px 10px", borderRadius: 20,
                                border: `1px solid ${CATEGORY_COLORS[c.category] ?? C.textDim}30`,
                              }}>
                                {c.category}
                              </span>
                            </div>
                          )}

                          {/* In-text usage from the paper */}
                          {(() => {
                            const ctxs = (c.contexts && c.contexts.length > 0)
                              ? c.contexts
                              : (rowAi?.contexts && rowAi.contexts.length > 0 ? rowAi.contexts : null);
                            if (!ctxs) return null;
                            return (
                              <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
                                  Used in paper
                                </div>
                                {ctxs.map((ctx, j) => (
                                  <div key={j} style={{
                                    fontSize: 13.5, color: C.textMuted, lineHeight: 1.65, fontStyle: "italic",
                                    background: C.surface, padding: "9px 12px",
                                    borderRadius: 8, border: `1px solid ${C.border}`,
                                    wordBreak: "break-word",
                                    marginBottom: j < ctxs.length - 1 ? 6 : 0,
                                  }}>
                                    "…{ctx}"
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          {/* GPT relevance explanation */}
                          {c.claim && (
                            <div style={{ marginBottom: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
                                Relevance assessment
                              </div>
                              <div style={{
                                fontSize: 13.5, color: C.textMuted, lineHeight: 1.65,
                                background: C.surface, padding: "9px 12px",
                                borderRadius: 8, border: `1px solid ${C.border}`,
                                wordBreak: "break-word",
                              }}>
                                {c.claim}
                              </div>
                            </div>
                          )}

                          {/* Warning */}
                          {c.warning && (
                            <div style={{
                              marginTop: 8, fontSize: 13, color: "#fca5a5",
                              background: "rgba(239,68,68,0.07)", padding: "7px 10px",
                              borderRadius: 7, border: "1px solid rgba(239,68,68,0.18)",
                            }}>
                              ⚠ {c.warning}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────────

function LoadingState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 0 24px" }}>
        <div style={{ fontSize: 32 }}>📍</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textMuted }}>Analysing citations...</div>
        <div style={{ fontSize: 14, color: C.textDim, textAlign: "center", lineHeight: 1.6, maxWidth: 260 }}>
          Fetching abstracts and assessing claim support
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: "50%", background: C.accent,
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 14, marginBottom: 10, opacity: 0.5 - i * 0.1,
        }}>
          <div style={{ height: 12, borderRadius: 4, background: C.border, marginBottom: 8, width: "40%" }} />
          <div style={{ height: 7, borderRadius: 4, background: C.border, marginBottom: 6 }} />
          <div style={{ height: 7, borderRadius: 4, background: C.border, width: "75%" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type FilterType = "all" | "flagged" | "ok" | "strong" | "moderate" | "weak" | "unsupported";

export default function ReliabilityTab({
  data,
  loading,
  aiCitations = [],
}: {
  data: ReliabilityData | null;
  loading: boolean;
  aiCitations?: CitationResult[];
}) {
  const { C } = useTheme();
  const orange = "#f97316";
  const accentGlow = `${C.accent}18`;
  const [filter, setFilter]           = useState<FilterType>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const tableRef                      = useRef<HTMLDivElement>(null);

  const handleBubbleClick = (id: string) => {
    setExpandedId(id);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const handleCategoryClick = (cat: string | null) => {
    setCategoryFilter(cat);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  if (loading) return <LoadingState />;

  if (!data) return (
    <div style={{ padding: "0 16px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 40, textAlign: "center" }}>
      <div style={{
        width: 64, height: 64, borderRadius: 18,
        background: `linear-gradient(135deg, ${C.accent}20, #a78bfa20)`,
        border: `1px solid ${C.accent}30`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
      }}>📍</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Citation Relevance</div>
        <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
          Upload a paper to see how well each citation supports its in-text claim.
        </div>
      </div>
    </div>
  );

  const { citations, summary } = data;
  const strongCount = citations.filter(c => c.verdict === "strong").length;

  const visible = citations.filter(c => {
    const passesVerdict = (() => {
      if (filter === "flagged") return c.flags.length > 0;
      if (filter === "ok")      return c.flags.length === 0;
      if (filter === "strong" || filter === "moderate" || filter === "weak" || filter === "unsupported")
        return c.verdict === filter;
      return true;
    })();
    const passesCategory = !categoryFilter || (c.category ?? "Unknown") === categoryFilter;
    return passesVerdict && passesCategory;
  });

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Summary stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <StatBox value={summary.total} label="Citations" color={C.accent} />
        <StatBox
          value={summary.avg_relevance > 0 ? `${summary.avg_relevance}%` : "—"}
          label="Avg. Relevance"
          color={summary.avg_relevance > 0 ? scoreColor(summary.avg_relevance, "#10b981", "#f59e0b", "#ef4444") : C.textDim}
          sub={summary.no_abstract ? `${summary.no_abstract} not assessed` : undefined}
        />
        <StatBox value={strongCount}           label="Strong Support" color={C.green} />
        <StatBox value={summary.self_citations} label="Self-Cite"      color={summary.self_citations > 0 ? orange : C.textDim} />
      </div>

      {/* Verdict distribution */}
      <VerdictBar citations={citations} />

      {/* Category pie chart */}
      <CategoryPieChart
        citations={citations}
        activeCategory={categoryFilter}
        onCategoryClick={handleCategoryClick}
      />

      {/* Bubble chart */}
      <BubbleChart citations={citations} onBubbleClick={handleBubbleClick} />

      {/* Filter row */}
      <div style={{ marginBottom: 12 }}>
        {/* Status filters */}
        <div style={{
          display: "flex", gap: 4, marginBottom: 6,
          background: C.surface, borderRadius: 10, padding: 4,
          border: `1px solid ${C.border}`,
        }}>
          {([
            { id: "all",     label: "All",     icon: "📋", count: citations.length },
            { id: "flagged", label: "Flagged", icon: "⚠️",  count: citations.filter(c => c.flags.length > 0).length },
            { id: "ok",      label: "Clean",   icon: "✓",  count: citations.filter(c => c.flags.length === 0).length },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setFilter(tab.id)} style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "7px 8px", borderRadius: 7, border: "none",
              background: filter === tab.id ? C.card : "transparent",
              color: filter === tab.id ? C.text : C.textDim,
              fontSize: 13.5, fontWeight: filter === tab.id ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
              boxShadow: filter === tab.id ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
            }}>
              <span>{tab.icon}</span>
              {tab.label}
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: filter === tab.id ? C.accent : C.textDim,
                background: filter === tab.id ? accentGlow : "transparent",
                padding: "0px 5px", borderRadius: 10,
              }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Verdict filters */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {(["strong", "moderate", "weak", "unsupported"] as const).map(v => {
            const count = citations.filter(c => c.verdict === v).length;
            if (count === 0) return null;
            const color = VERDICT_COLOR[v];
            const isActive = filter === v;
            return (
              <button key={v} onClick={() => setFilter(isActive ? "all" : v)} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 10px", borderRadius: 20,
                border: `1px solid ${isActive ? color : color + "40"}`,
                background: isActive ? `${color}22` : "transparent",
                color: isActive ? color : C.textDim,
                fontSize: 12.5, fontWeight: isActive ? 600 : 400,
                cursor: "pointer", transition: "all 0.15s",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
                {VERDICT_LABEL[v]}
                <span style={{ fontSize: 11.5, opacity: 0.75 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Citation table */}
      <div ref={tableRef}>
        {visible.length === 0
          ? <div style={{ textAlign: "center", color: C.green, padding: "24px 0", fontSize: 15 }}>✓ No issues found in this category</div>
          : <CitationTable
              citations={visible}
              aiCitations={aiCitations}
              expandedId={expandedId}
              onExpandChange={setExpandedId}
            />
        }
      </div>
    </div>
  );
}
