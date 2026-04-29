import {
  Network,
  Scale,
  ScanSearch,
  FlaskConical,
  ClipboardList,
  MessageSquare,
  PenLine,
  LayoutDashboard,
} from "lucide-react";
import { useTheme } from "../theme";

export interface BottomDockProps {
  activeOverlay: string | null;
  onToggle: (id: string) => void;
  networkLoading: boolean;
  biasLoading: boolean;
  formatLoading: boolean;
  integrityLoading: boolean;
  phase: string;
}

interface DockButton {
  id: string;
  icon: React.ReactNode;
  label: string;
  loading?: boolean;
}

function DockBtn({
  id,
  icon,
  label,
  isActive,
  isLoading,
  onClick,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  isLoading?: boolean;
  onClick: () => void;
}) {
  const { C } = useTheme();
  return (
    <button
      key={id}
      onClick={onClick}
      title={label}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        padding: "8px 0", border: "none", borderRadius: 8, cursor: "pointer",
        background: isActive ? `${C.accent}20` : "transparent",
        color: isActive ? C.accent : C.textDim,
        fontSize: 11, fontWeight: isActive ? 700 : 500,
        transition: "background 0.15s, color 0.15s",
        position: "relative",
        opacity: isLoading ? 0.7 : 1,
        animation: isLoading ? "dockPulse 1.5s ease-in-out infinite" : "none",
        outline: isActive ? `1px solid ${C.accent}30` : "none",
        width: "100%",
      }}
      onMouseEnter={e => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = `${C.accent}10`;
          (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = C.textDim;
        }
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18 }}>
        {icon}
      </span>
      <span style={{ fontSize: 11, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

export default function BottomDock({
  activeOverlay,
  onToggle,
  networkLoading,
  biasLoading,
  formatLoading,
  integrityLoading,
}: BottomDockProps) {
  const { C } = useTheme();

  const buttons: DockButton[] = [
    { id: "network",   icon: <Network size={16} />,       label: "Network",   loading: networkLoading },
    { id: "bias",      icon: <Scale size={16} />,         label: "Bias",      loading: biasLoading },
    { id: "quality",   icon: <ScanSearch size={16} />,    label: "Quality",   loading: formatLoading },
    { id: "integrity", icon: <FlaskConical size={16} />,  label: "Integrity", loading: integrityLoading },
    { id: "actions",   icon: <ClipboardList size={16} />, label: "Actions" },
    { id: "chat",      icon: <MessageSquare size={16} />, label: "Chat" },
    { id: "draft",     icon: <PenLine size={16} />,       label: "Draft" },
  ];

  return (
    <>
      <style>{`
        @keyframes dockPulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
      <div style={{
        width: 56,
        flexShrink: 0,
        background: C.bg,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 4px",
        zIndex: 40,
        gap: 2,
      }}>
        {/* Tool buttons */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2,
          background: C.card, borderRadius: 10,
          border: `1px solid ${C.border}`,
          padding: "4px",
          width: "100%",
        }}>
          {buttons.map(btn => (
            <DockBtn
              key={btn.id}
              id={btn.id}
              icon={btn.icon}
              label={btn.label}
              isActive={activeOverlay === btn.id}
              isLoading={btn.loading}
              onClick={() => onToggle(btn.id)}
            />
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Workspace button */}
        <button
          onClick={() => onToggle("workspace")}
          title="Peer Review Workspace"
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: "8px 4px", border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: "pointer", width: "100%",
            background: activeOverlay === "workspace" ? `${C.accent}20` : C.card,
            color: activeOverlay === "workspace" ? C.accent : C.textMuted,
            fontSize: 10, fontWeight: 600, transition: "all 0.15s",
            outline: activeOverlay === "workspace" ? `1px solid ${C.accent}30` : "none",
          }}
          onMouseEnter={e => {
            if (activeOverlay !== "workspace") {
              (e.currentTarget as HTMLButtonElement).style.background = `${C.accent}10`;
              (e.currentTarget as HTMLButtonElement).style.color = C.text;
            }
          }}
          onMouseLeave={e => {
            if (activeOverlay !== "workspace") {
              (e.currentTarget as HTMLButtonElement).style.background = C.card;
              (e.currentTarget as HTMLButtonElement).style.color = C.textMuted;
            }
          }}
        >
          <LayoutDashboard size={16} />
          <span style={{ fontSize: 10, whiteSpace: "nowrap", writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: 0.5 }}>Workspace</span>
        </button>
      </div>
    </>
  );
}
