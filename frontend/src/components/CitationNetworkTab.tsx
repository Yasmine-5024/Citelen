import { useState, useRef, useEffect } from "react";
import { useTheme } from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetworkPaper {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  links: number;
}

export interface NetworkCluster {
  name: string;
  color: "blue" | "purple" | "green" | "orange" | "cyan";
  papers: NetworkPaper[];
}

export interface OrphanPaper {
  id: string;
  title: string;
  year: number | null;
  venue: string;
}

export interface CitationNetworkData {
  clusters: NetworkCluster[];
  orphans: OrphanPaper[];
  total_clusters: number;
  total_orphans: number;
  cohesion_score: number;
  avg_connections: number;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const CLUSTER_COLORS: Record<string, { dot: string; border: string; bg: string; cardBg: string }> = {
  blue:   { dot: "#3b82f6", border: "#3b82f640", bg: "#3b82f608", cardBg: "#3b82f610" },
  purple: { dot: "#a78bfa", border: "#a78bfa40", bg: "#a78bfa08", cardBg: "#a78bfa10" },
  green:  { dot: "#10b981", border: "#10b98140", bg: "#10b98108", cardBg: "#10b98110" },
  orange: { dot: "#f97316", border: "#f9731640", bg: "#f9731608", cardBg: "#f9731610" },
  cyan:   { dot: "#06b6d4", border: "#06b6d440", bg: "#06b6d408", cardBg: "#06b6d410" },
};

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({ value, label, sub, color }: { value: any; label: string; sub?: string; color: string }) {
  const { C } = useTheme();
  return (
    <div style={{
      flex: 1, textAlign: "center", padding: "16px 8px",
      background: `linear-gradient(135deg, ${color}08, ${color}14)`,
      borderRadius: 12, border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Link Dots ────────────────────────────────────────────────────────────────

function LinkDots({ links, color, max = 6 }: { links: number; color: string; max?: number }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{
          width: 22, height: 5, borderRadius: 99,
          background: i < links ? color : `${color}25`,
          transition: "background 0.2s",
        }} />
      ))}
      <span style={{ fontSize: 11, color: C.textDim, marginLeft: 4 }}>{links} conn.</span>
    </div>
  );
}

// ─── Paper Mini Card ──────────────────────────────────────────────────────────

function PaperCard({ paper, color }: { paper: NetworkPaper; color: string }) {
  const { C } = useTheme();
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${color}20`,
      borderRadius: 10, padding: "12px 14px",
      flex: "1 1 180px", minWidth: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>{paper.id}</span>
        <span style={{ fontSize: 12, color: C.textDim }}>{paper.links} link{paper.links !== 1 ? "s" : ""}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.4, marginBottom: 6 }}>
        {paper.title.slice(0, 50)}{paper.title.length > 50 ? "..." : ""}
      </div>
      <LinkDots links={Math.min(paper.links, 6)} color={color} />
    </div>
  );
}

// ─── Cluster Group ────────────────────────────────────────────────────────────

function ClusterGroup({ cluster }: { cluster: NetworkCluster }) {
  const { C } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const colors = CLUSTER_COLORS[cluster.color] || CLUSTER_COLORS.blue;

  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderLeft: `3px solid ${colors.dot}`,
      borderRadius: 14, padding: "16px 18px",
      background: colors.bg, marginBottom: 12,
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: expanded ? 14 : 0 }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: colors.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text, flex: 1 }}>{cluster.name}</span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: colors.dot,
          background: `${colors.dot}18`, padding: "2px 10px",
          borderRadius: 20, border: `1px solid ${colors.dot}30`,
        }}>
          {cluster.papers.length} paper{cluster.papers.length !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 13, color: C.textDim, marginLeft: 4 }}>{expanded ? "▴" : "▾"}</span>
      </div>

      {/* Papers grid */}
      {expanded && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {cluster.papers.map(p => (
            <PaperCard key={p.id} paper={p} color={colors.dot} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Orphans Section ──────────────────────────────────────────────────────────

function OrphansSection({ orphans }: { orphans: OrphanPaper[] }) {
  const { C } = useTheme();
  const orange = "#f97316";

  if (orphans.length === 0) return null;

  const REASONS = [
    "No overlap with any cluster topic",
    "Stands alone — verify it belongs",
    "Thematically isolated",
  ];

  return (
    <div style={{
      border: `1px solid ${orange}40`,
      borderLeft: `3px solid ${orange}`,
      borderRadius: 14, padding: "16px 18px",
      background: `${orange}06`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>🏝️</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Orphaned Citations</span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: orange,
          background: `${orange}18`, padding: "2px 10px",
          borderRadius: 20, border: `1px solid ${orange}30`,
        }}>
          {orphans.length} found
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
        These citations have no thematic connection to other references — consider if they truly belong.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {orphans.map((o, i) => (
          <div key={o.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: C.card, border: `1px solid ${orange}20`,
            borderRadius: 10, padding: "10px 14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: orange, fontFamily: "monospace" }}>{o.id}</span>
              <span style={{ fontSize: 14, color: C.textMuted }}>
                {o.title.slice(0, 55)}{o.title.length > 55 ? "..." : ""}
              </span>
            </div>
            <span style={{ fontSize: 13, color: orange, flexShrink: 0, marginLeft: 12 }}>
              {REASONS[i % REASONS.length]}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.textDim, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${orange}20` }}>
        💡 Consider if this citation is essential or could be removed.
      </div>
    </div>
  );
}

// ─── Force Graph ──────────────────────────────────────────────────────────────

const W = 440;
const H = 340;

interface GraphNode {
  id: string;
  title: string;
  year: number | null;
  links: number;
  color: string;
  radius: number;
  clusterName: string | null;
  isOrphan: boolean;
}

interface GraphEdge {
  i: number;
  j: number;
  color: string;
}

interface NodePos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function buildGraphData(data: CitationNetworkData): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Cluster nodes
  for (const cluster of data.clusters) {
    const color = CLUSTER_COLORS[cluster.color]?.dot ?? "#6366f1";
    const startIdx = nodes.length;

    for (const paper of cluster.papers) {
      nodes.push({
        id: paper.id,
        title: paper.title,
        year: paper.year,
        links: paper.links,
        color,
        radius: 10 + Math.min(paper.links, 4) * 1.5,
        clusterName: cluster.name,
        isOrphan: false,
      });
    }

    const count = cluster.papers.length;
    const clusterColor = color;

    if (count <= 4) {
      // All pairs
      for (let a = startIdx; a < startIdx + count; a++) {
        for (let b = a + 1; b < startIdx + count; b++) {
          edges.push({ i: a, j: b, color: clusterColor });
        }
      }
    } else if (count < 10) {
      // Ring + hub (each to paper[0])
      for (let k = 0; k < count; k++) {
        const next = startIdx + (k + 1) % count;
        const cur = startIdx + k;
        edges.push({ i: cur, j: next, color: clusterColor });
      }
      for (let k = 1; k < count; k++) {
        edges.push({ i: startIdx, j: startIdx + k, color: clusterColor });
      }
    } else {
      // Ring only
      for (let k = 0; k < count; k++) {
        const cur = startIdx + k;
        const next = startIdx + (k + 1) % count;
        edges.push({ i: cur, j: next, color: clusterColor });
      }
    }
  }

  // Orphan nodes
  for (const orphan of data.orphans) {
    nodes.push({
      id: orphan.id,
      title: orphan.title,
      year: orphan.year,
      links: 0,
      color: "#f97316",
      radius: 9,
      clusterName: null,
      isOrphan: true,
    });
  }

  return { nodes, edges };
}

function initPositions(data: CitationNetworkData, nodes: GraphNode[]): NodePos[] {
  const positions: NodePos[] = new Array(nodes.length);
  let idx = 0;

  const clusterCount = data.clusters.length;
  const cx = W / 2;
  const cy = H / 2;
  const orbitR = 110;

  for (let ci = 0; ci < data.clusters.length; ci++) {
    const angle = clusterCount > 1 ? (ci / clusterCount) * Math.PI * 2 : 0;
    const clusterCx = cx + Math.cos(angle) * orbitR;
    const clusterCy = cy + Math.sin(angle) * orbitR;
    const count = data.clusters[ci].papers.length;

    for (let pi = 0; pi < count; pi++) {
      const scatter = (Math.random() - 0.5) * 70;
      const scatterY = (Math.random() - 0.5) * 70;
      positions[idx++] = {
        x: Math.max(12, Math.min(W - 12, clusterCx + scatter)),
        y: Math.max(12, Math.min(H - 12, clusterCy + scatterY)),
        vx: 0,
        vy: 0,
      };
    }
  }

  // Orphans in a row near bottom center
  const orphanCount = data.orphans.length;
  for (let oi = 0; oi < orphanCount; oi++) {
    const ox = cx - ((orphanCount - 1) * 28) / 2 + oi * 28;
    positions[idx++] = { x: Math.max(10, Math.min(W - 10, ox)), y: H - 30, vx: 0, vy: 0 };
  }

  return positions;
}


function ForceGraph({ data }: { data: CitationNetworkData }) {
  const { C } = useTheme();
  const orange = "#f97316";
  const { nodes, edges } = buildGraphData(data);

  const posRef = useRef<NodePos[]>([]);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [, setTick] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const hoveredIdRef = useRef<number | null>(null);

  const clusterMembership = useRef<Map<number, number[]>>(new Map());

  useEffect(() => {
    posRef.current = initPositions(data, nodes);
    frameRef.current = 0;

    const membership = new Map<number, number[]>();
    let idx = 0;
    for (let ci = 0; ci < data.clusters.length; ci++) {
      const members: number[] = [];
      for (let pi = 0; pi < data.clusters[ci].papers.length; pi++) members.push(idx++);
      membership.set(ci, members);
    }
    clusterMembership.current = membership;

    function step() {
      if (hoveredIdRef.current !== null) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const frame = frameRef.current;
      if (frame >= 280) return;

      const pos = posRef.current;
      const n = pos.length;
      const alpha = Math.max(0.01, 1 - frame / 200);

      for (let i = 0; i < n; i++) { pos[i].vx *= 0.86; pos[i].vy *= 0.86; }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) continue;
          const d = Math.sqrt(d2);
          if (d > 200) continue;
          const f = 1100 / d2;
          const fx = (dx / d) * f; const fy = (dy / d) * f;
          pos[i].vx += fx; pos[i].vy += fy;
          pos[j].vx -= fx; pos[j].vy -= fy;
        }
      }
      for (const edge of edges) {
        const { i, j } = edge;
        const dx = pos[j].x - pos[i].x; const dy = pos[j].y - pos[i].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 65) * 0.04 * alpha;
        const fx = (dx / d) * f; const fy = (dy / d) * f;
        pos[i].vx += fx; pos[i].vy += fy;
        pos[j].vx -= fx; pos[j].vy -= fy;
      }
      clusterMembership.current.forEach((members) => {
        if (members.length === 0) return;
        let sumX = 0, sumY = 0;
        for (const m of members) { sumX += pos[m].x; sumY += pos[m].y; }
        const centX = sumX / members.length; const centY = sumY / members.length;
        for (const m of members) {
          pos[m].vx += (centX - pos[m].x) * 0.018 * alpha;
          pos[m].vy += (centY - pos[m].y) * 0.018 * alpha;
        }
      });
      for (let i = 0; i < n; i++) {
        pos[i].vx += (W / 2 - pos[i].x) * 0.004;
        pos[i].vy += (H / 2 - pos[i].y) * 0.004;
      }
      for (let i = 0; i < n; i++) {
        const r = nodes[i].radius;
        pos[i].x = Math.max(r, Math.min(W - r, pos[i].x + pos[i].vx));
        pos[i].y = Math.max(r, Math.min(H - r, pos[i].y + pos[i].vy));
      }

      frameRef.current = frame + 1;
      setTick(t => t + 1);
      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pos = posRef.current;

  const hoveredNode = hoveredIdx != null ? (nodes[hoveredIdx] ?? null) : null;

  return (
    <div>
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
        userSelect: "none",
      }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* Background */}
          <rect width={W} height={H} fill={C.surface} />

          {/* Edges */}
          {edges.map((edge, ei) => {
            const a = pos[edge.i];
            const b = pos[edge.j];
            if (!a || !b) return null;
            return (
              <line
                key={ei}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={edge.color}
                strokeOpacity={0.3}
                strokeWidth={1}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node, ni) => {
            const p = pos[ni];
            if (!p) return null;
            const isHovered = ni === hoveredIdx;
            const fillOpacity = isHovered ? 0.55 : 0.2;
            return (
              <g
                key={node.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: "pointer" }}
              >
                {/* Larger invisible hit area prevents hover flicker */}
                <circle
                  r={node.radius + 6}
                  fill="transparent"
                  stroke="none"
                  onMouseEnter={() => { hoveredIdRef.current = ni; setHoveredIdx(ni); }}
                  onMouseLeave={() => { hoveredIdRef.current = null; setHoveredIdx(null); }}
                />
                <circle
                  r={node.radius}
                  fill={node.color}
                  fillOpacity={fillOpacity}
                  stroke={node.color}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  style={{ pointerEvents: "none" }}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fontWeight={700}
                  fill={node.color}
                  style={{ pointerEvents: "none" }}
                >
                  {node.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredNode && hoveredIdx != null && (() => {
        return (
          <div style={{
            marginTop: 8,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px 14px",
            animation: "fadeIn 0.15s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: hoveredNode.color, fontFamily: "monospace" }}>
                {hoveredNode.id}
              </span>
              {hoveredNode.year && (
                <span style={{ fontSize: 13, color: C.textDim }}>{hoveredNode.year}</span>
              )}
              <span style={{
                fontSize: 12, marginLeft: "auto",
                color: hoveredNode.isOrphan ? orange : hoveredNode.color,
                background: hoveredNode.isOrphan ? `${orange}18` : `${hoveredNode.color}18`,
                padding: "1px 8px", borderRadius: 20,
              }}>
                {hoveredNode.isOrphan ? "Orphaned" : hoveredNode.clusterName}
              </span>
            </div>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>
              {hoveredNode.title.slice(0, 200)}{hoveredNode.title.length > 200 ? "..." : ""}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 0 24px" }}>
        <div style={{ fontSize: 32 }}>🕸️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textMuted }}>Building citation network...</div>
        <div style={{ fontSize: 14, color: C.textDim, textAlign: "center", lineHeight: 1.6, maxWidth: 260 }}>
          Analysing thematic relationships and grouping citations
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
          borderRadius: 14, padding: 16, marginBottom: 12, opacity: 0.5 - i * 0.1,
        }}>
          <div style={{ height: 12, borderRadius: 4, background: C.border, marginBottom: 12, width: "35%" }} />
          <div style={{ display: "flex", gap: 10 }}>
            {[1, 2, 3].map(j => (
              <div key={j} style={{ flex: 1, height: 60, borderRadius: 10, background: C.border }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

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
        }}>🕸️</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Citation Network</div>
          <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
            Upload a PDF to discover how your citations cluster into thematic groups.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CitationNetworkTab({
  data,
  loading,
}: {
  data: CitationNetworkData | null;
  loading: boolean;
}) {
  const { C } = useTheme();
  const orange = "#f97316";
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");

  if (loading) return <LoadingState />;
  if (!data) return <EmptyState />;

  const cohesionLabel = data.cohesion_score >= 0.7 ? "High" : data.cohesion_score >= 0.4 ? "Medium" : "Low";
  const cohesionColor = data.cohesion_score >= 0.7 ? "#10b981" : data.cohesion_score >= 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>🕸️</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Citation Network & Relationships</span>
        </div>
        <div style={{ fontSize: 14, color: C.textDim }}>
          How citations relate to each other and form thematic clusters
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <StatBox value={data.total_clusters} label="Clusters" sub="Thematic groups" color="#6366f1" />
        <StatBox value={data.total_orphans} label="Orphaned" sub="Isolated refs" color={data.total_orphans > 0 ? "#f97316" : "#10b981"} />
        <StatBox value={data.cohesion_score} label="Cohesion Score" sub={cohesionLabel} color={cohesionColor} />
        <StatBox value={data.avg_connections} label="Avg Connections" sub="Per citation" color="#3b82f6" />
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["graph", "list"] as const).map((mode) => {
          const active = viewMode === mode;
          const label = mode === "graph" ? "🕸 Graph" : "☰ List";
          return (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 14px",
                fontSize: 14, fontWeight: active ? 700 : 500,
                borderRadius: 8, border: `1px solid ${active ? C.accent + "60" : C.border}`,
                background: active ? `${C.accent}18` : C.card,
                color: active ? C.accent : C.textMuted,
                cursor: "pointer", transition: "all 0.15s",
                outline: "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {viewMode === "graph" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          <ForceGraph data={data} />

          {/* Compact legend */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
            marginTop: 12, padding: "8px 12px",
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10,
          }}>
            {data.clusters.map((cluster, i) => {
              const color = CLUSTER_COLORS[cluster.color]?.dot ?? "#6366f1";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: C.textMuted }}>{cluster.name}</span>
                </div>
              );
            })}
            {data.total_orphans > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: orange, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.textMuted }}>{data.total_orphans} orphan{data.total_orphans !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === "list" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          {data.clusters.map((cluster, i) => (
            <ClusterGroup key={i} cluster={cluster} />
          ))}
          <OrphansSection orphans={data.orphans} />
        </div>
      )}
    </div>
  );
}
