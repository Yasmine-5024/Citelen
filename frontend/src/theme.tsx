import { createContext, useContext, useState, ReactNode } from "react";

export interface ThemeColors {
  bg: string;
  surface: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  green: string;
  yellow: string;
  red: string;
  purple: string;
  greenBg: string;
  yellowBg: string;
  redBg: string;
}

export const DARK: ThemeColors = {
  bg:        "#0a0e1a",
  surface:   "#0f1624",
  card:      "#111827",
  border:    "#1e293b",
  text:      "#f1f5f9",
  textMuted: "#94a3b8",
  textDim:   "#64748b",
  accent:    "#6366f1",
  green:     "#10b981",
  yellow:    "#f59e0b",
  red:       "#ef4444",
  purple:    "#a78bfa",
  greenBg:   "rgba(16,185,129,0.10)",
  yellowBg:  "rgba(245,158,11,0.10)",
  redBg:     "rgba(239,68,68,0.10)",
};

export const LIGHT: ThemeColors = {
  bg:        "#ffffff",
  surface:   "#f8fafc",
  card:      "#f1f5f9",
  border:    "#e2e8f0",
  text:      "#0f172a",
  textMuted: "#475569",
  textDim:   "#94a3b8",
  accent:    "#6366f1",
  green:     "#059669",
  yellow:    "#d97706",
  red:       "#dc2626",
  purple:    "#7c3aed",
  greenBg:   "rgba(5,150,105,0.08)",
  yellowBg:  "rgba(217,119,6,0.08)",
  redBg:     "rgba(220,38,38,0.08)",
};

interface ThemeCtx {
  theme: "dark" | "light";
  C: ThemeColors;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "dark", C: DARK, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const C = theme === "dark" ? DARK : LIGHT;
  const toggle = () => setTheme(t => (t === "dark" ? "light" : "dark"));
  return (
    <ThemeContext.Provider value={{ theme, C, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
