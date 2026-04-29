export interface ReproItem {
  id: string;
  label: string;
  status: "found" | "partial" | "missing";
  text: string | null;
}

export interface ReproducibilityData {
  items: ReproItem[];
  found: boolean;
}

const STATUS_CONFIG = {
  found:   { icon: "✓", color: "#10b981", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)", label: "Found" },
  partial: { icon: "~", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", label: "Partial" },
  missing: { icon: "✕", color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  label: "Missing" },
};

const C = {
  bg: "#0d1117",
  surface: "#111827",
  border: "#1e293b",
  text: "#f1f5f9",
  dim: "#64748b",
};

function ReproRow({ item, expanded, onToggle }: {
  item: ReproItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = STATUS_CONFIG[item.status];

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${expanded ? s.border : C.border}`,
      overflow: "hidden",
      transition: "border-color 0.15s ease",
    }}>
      {/* Row header */}
      <div
        onClick={item.text ? onToggle : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          cursor: item.text ? "pointer" : "default",
          background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
          transition: "background 0.15s ease",
        }}
      >
        {/* Status icon */}
        <span style={{
          width: 22, height: 22,
          borderRadius: 6,
          background: s.bg,
          border: `1px solid ${s.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800, color: s.color,
          flexShrink: 0,
        }}>
          {s.icon}
        </span>

        {/* Label */}
        <span style={{ fontSize: 12, color: C.text, fontWeight: 500, flex: 1 }}>
          {item.label}
        </span>

        {/* Status badge */}
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: s.color,
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: 4,
          padding: "2px 6px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}>
          {s.label}
        </span>

        {/* Expand arrow */}
        {item.text && (
          <span style={{
            fontSize: 10, color: C.dim, marginLeft: 2, flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            display: "inline-block",
          }}>
            ▾
          </span>
        )}
      </div>

      {/* Snippet */}
      {expanded && item.text && (
        <div style={{
          padding: "8px 12px 10px 44px",
          borderTop: `1px solid ${C.border}`,
          background: "rgba(0,0,0,0.2)",
        }}>
          <p style={{
            margin: 0,
            fontSize: 11,
            color: "#94a3b8",
            lineHeight: 1.6,
            fontStyle: "italic",
          }}>
            "{item.text}"
          </p>
        </div>
      )}
    </div>
  );
}

export default function ReproducibilityPanel({
  data,
  loading,
  open,
  onClose,
}: {
  data: ReproducibilityData | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  const toggle = (id: string) =>
    setExpandedId(prev => (prev === id ? null : id));

  return (
    <div style={{
      position: "absolute",
      top: 56,          // below toolbar
      right: 0,
      width: 300,
      maxHeight: "calc(100% - 72px)",
      background: C.bg,
      border: `1px solid #334155`,
      borderRight: "none",
      borderRadius: "12px 0 0 12px",
      boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>🔬</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          Reproducibility
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto", background: "none", border: "none",
            color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 12px" }}>
        {loading ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 30, color: C.dim, fontSize: 12, gap: 8,
          }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Checking paper…
          </div>
        ) : !data ? (
          <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 30 }}>
            No data available.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {data.items.map((item) => (
              <ReproRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {data && !loading && (
        <div style={{
          padding: "8px 14px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          gap: 12,
          flexShrink: 0,
        }}>
          {(["found", "partial", "missing"] as const).map(s => {
            const cfg = STATUS_CONFIG[s];
            const count = data.items.filter(i => i.status === s).length;
            return (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 2,
                  background: cfg.bg, border: `1px solid ${cfg.border}`,
                }} />
                <span style={{ color: cfg.color }}>{count}</span>
                <span style={{ color: C.dim }}>{cfg.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// useState import needed
import { useState } from "react";
