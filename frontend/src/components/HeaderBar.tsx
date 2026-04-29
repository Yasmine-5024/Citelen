import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../theme";

export interface HeaderBarProps {
  paperTitle: string | null;
  phase: "idle" | "grobid" | "analyzing" | "complete" | "missing" | "error";
  aiLikely: number;
  uncertain: number;
  missingCount: number;
  reliabilityScore: number | null;
  actionsCount: number;
  onNewUpload: () => void;
  userName: string | null;
}

function StatusBadge({ phase }: { phase: HeaderBarProps["phase"] }) {
  const { C } = useTheme();
  const config: Record<string, { label: string; color: string; bg: string; dot?: boolean }> = {
    idle:      { label: "Idle",       color: C.textDim,  bg: `${C.textDim}15` },
    grobid:    { label: "Parsing…",   color: C.yellow,   bg: `${C.yellow}15`, dot: true },
    analyzing: { label: "Analyzing…", color: C.accent,   bg: `${C.accent}15`, dot: true },
    missing:   { label: "Detecting…", color: C.accent,   bg: `${C.accent}15`, dot: true },
    complete:  { label: "Complete",   color: C.green,    bg: `${C.green}15` },
    error:     { label: "Error",      color: C.red,      bg: `${C.red}15` },
  };
  const cfg = config[phase] ?? config.idle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 20, fontSize: 13, fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}22`,
      flexShrink: 0,
    }}>
      {cfg.dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: cfg.color,
          boxShadow: `0 0 5px ${cfg.color}`,
          animation: "pulse 1.5s ease-in-out infinite",
          display: "inline-block",
        }} />
      )}
      {cfg.label}
    </span>
  );
}

function HealthPill({
  icon, value, color, label,
}: {
  icon: string;
  value: string | number;
  color: string;
  label?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20,
      background: `${color}12`, border: `1px solid ${color}25`,
      fontSize: 13, fontWeight: 600, color, flexShrink: 0,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span>{value}</span>
      {label && <span style={{ color: `${color}99`, fontWeight: 400 }}>{label}</span>}
    </div>
  );
}

function AvatarCircle({ name }: { name: string | null }) {
  const { C } = useTheme();
  const initials = name
    ? name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  return (
    <div style={{
      width: 30, height: 30, borderRadius: "50%",
      background: `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
      userSelect: "none",
    }}>
      {initials}
    </div>
  );
}

export default function HeaderBar({
  paperTitle,
  phase,
  aiLikely,
  uncertain,
  missingCount,
  reliabilityScore,
  actionsCount,
  onNewUpload,
  userName,
}: HeaderBarProps) {
  const { C, theme, toggle } = useTheme();
  const showPills = phase !== "idle" && phase !== "grobid";

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <header style={{
        height: 52,
        flexShrink: 0,
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        zIndex: 50,
        position: "relative",
      }}>
        {/* Left: Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{
            fontSize: 16, fontWeight: 800, color: C.accent,
            letterSpacing: -0.5, fontFamily: "'DM Sans', sans-serif",
          }}>
            Citelen
          </span>
          <div style={{ width: 1, height: 18, background: C.border }} />
        </div>

        {/* Center: paper title + status */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          minWidth: 0, overflow: "hidden",
        }}>
          {paperTitle ? (
            <>
              <span style={{
                fontSize: 14, color: C.textMuted, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 420,
              }}>
                {paperTitle}
              </span>
              <StatusBadge phase={phase} />
            </>
          ) : (
            <span style={{ fontSize: 14, color: C.textDim, fontStyle: "italic" }}>
              {phase === "grobid" ? "Parsing document…" : "No paper loaded"}
            </span>
          )}
        </div>

        {/* Right: health pills */}
        {showPills && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {aiLikely > 0 && (
              <HealthPill icon="🤖" value={aiLikely} color={C.red} label="flagged" />
            )}
            {uncertain > 0 && (
              <HealthPill icon="❓" value={uncertain} color={C.yellow} label="uncertain" />
            )}
            {missingCount > 0 && (
              <HealthPill icon="🔍" value={missingCount} color={C.accent} label="missing" />
            )}
            {reliabilityScore !== null && (
              <HealthPill
                icon="📊"
                value={`${reliabilityScore}%`}
                color={
                  reliabilityScore >= 70 ? C.green :
                  reliabilityScore >= 40 ? C.yellow : C.red
                }
                label="reliability"
              />
            )}
            {actionsCount > 0 && (
              <HealthPill icon="⚠" value={actionsCount} color={C.yellow} label="actions" />
            )}
          </div>
        )}

        {/* Far right: theme toggle + New button + avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.card, color: C.textMuted,
              cursor: "pointer", transition: "all 0.15s",
              flexShrink: 0,
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
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button
            onClick={onNewUpload}
            style={{
              padding: "5px 14px",
              background: `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
              border: "none", borderRadius: 8,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: "pointer", transition: "opacity 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            New
          </button>
          <AvatarCircle name={userName} />
        </div>
      </header>
    </>
  );
}
