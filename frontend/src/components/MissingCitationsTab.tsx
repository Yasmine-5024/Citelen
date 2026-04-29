import { useState } from "react";
import { MissingCitationsData, UncitedClaim, MissingPaper } from "../types";
import { useTheme } from "../theme";

// ─── Severity / category config factories ────────────────────────────────────

function makeSeverityConfig(C: any) {
  const orange = "#f97316"; const orangeBg = "rgba(249,115,22,0.12)";
  return {
    critical: { color: C.red,    bg: C.redBg,    label: "Critical", icon: "🔴" },
    high:     { color: orange,   bg: orangeBg,   label: "High",     icon: "🟠" },
    medium:   { color: C.yellow, bg: C.yellowBg, label: "Medium",   icon: "🟡" },
  };
}

function makeCategoryConfig(C: any) {
  const blue = "#3b82f6"; const blueBg = "rgba(59,130,246,0.12)";
  const cyan = "#06b6d4"; const cyanBg = "rgba(6,182,212,0.12)";
  const purpleBg = "rgba(167,139,250,0.12)";
  return {
    foundational:   { color: C.purple, bg: purpleBg, label: "Foundational",   icon: "📚" },
    competitor:     { color: cyan,     bg: cyanBg,   label: "Competitor",     icon: "⚔️" },
    methodological: { color: blue,     bg: blueBg,   label: "Methodological", icon: "🔬" },
    dataset:        { color: C.green,  bg: C.greenBg, label: "Dataset",       icon: "🗃️" },
    survey:         { color: C.accent, bg: `${C.accent}18`, label: "Survey",  icon: "📋" },
  };
}

// ─── Shared primitives ───────────────────────────────────────────────────────

const Badge = ({ color, bg, children, icon }: { color: string; bg: string; children: React.ReactNode; icon?: string }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 8px", borderRadius: 20, fontSize: 12.5, fontWeight: 600,
    color, background: bg, border: `1px solid ${color}22`, flexShrink: 0,
  }}>
    {icon && <span>{icon}</span>}{children}
  </span>
);

const StatBox = ({ value, label, color, sub }: { value: any; label: string; color: string; sub?: string }) => {
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
};

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  icon, label, onClick, color, bg, disabled = false,
}: {
  icon: string; label: string; onClick: (e: React.MouseEvent) => void;
  color?: string; bg?: string; disabled?: boolean;
}) {
  const { C } = useTheme();
  const accentGlow = `${C.accent}18`;
  const resolvedColor = color ?? C.accent;
  const resolvedBg = bg ?? accentGlow;
  const [flash, setFlash] = useState(false);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onClick(e);
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  };
  return (
    <button
      onClick={handleClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 8, border: `1px solid ${resolvedColor}30`,
        background: flash ? `${resolvedColor}30` : resolvedBg,
        color: disabled ? C.textDim : resolvedColor,
        fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer",
        transition: "all 0.15s", flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span>{icon}</span>{label}
    </button>
  );
}

// ─── Copy citation helper ─────────────────────────────────────────────────────

function formatCitation(paper: MissingPaper): string {
  const authors = paper.authors
    .slice(0, 3)
    .map((a: any) => typeof a === "string" ? a : a.name || "")
    .filter(Boolean)
    .join(", ");
  const et_al = paper.authors.length > 3 ? " et al." : "";
  const year = paper.year ? ` (${paper.year})` : "";
  const venue = paper.venue ? `. ${paper.venue}` : "";
  const doi = paper.doi ? `. https://doi.org/${paper.doi}` : "";
  return `${authors}${et_al}${year}. ${paper.title}${venue}${doi}`;
}

// ─── Uncited Claim Card ───────────────────────────────────────────────────────

function ClaimCard({ claim, index, onCitationSelect }: { claim: UncitedClaim; index: number; onCitationSelect?: (id: string) => void }) {
  const { C } = useTheme();
  const accentGlow = `${C.accent}18`;
  const blue = "#3b82f6"; const blueBg = "rgba(59,130,246,0.12)";
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.yellow}`,
        borderRadius: 12,
        overflow: "hidden",
        animation: "fadeIn 0.3s ease",
      }}
    >
      {/* Claim header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: C.yellow,
              background: C.yellowBg, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${C.yellow}22`,
              textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              ⚠ Uncited Claim
            </span>
            <span style={{
              fontSize: 12, color: C.accent,
              background: accentGlow, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${C.accent}22`,
            }}>
              📍 {claim.section}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{
              fontSize: 12, color: C.textDim,
              background: `${blue}10`, padding: "2px 7px",
              borderRadius: 20,
            }}>
              {claim.suggestions.length} suggestion{claim.suggestions.length !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 14, color: C.textDim, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
          </div>
        </div>

        {/* Claim text */}
        <div style={{
          fontSize: 14, color: C.textMuted, lineHeight: 1.6,
          fontStyle: "italic",
          background: `${C.yellow}06`,
          padding: "8px 10px", borderRadius: 8,
          border: `1px solid ${C.yellow}15`,
        }}>
          "{claim.text.slice(0, 160)}{claim.text.length > 160 ? "..." : ""}"
        </div>
      </div>

      {/* Suggestions — expanded */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Suggested Papers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {claim.suggestions.length === 0 && (
              <div style={{ fontSize: 14, color: C.textDim, textAlign: "center", padding: "12px 0" }}>
                No matching papers found
              </div>
            )}
            {claim.suggestions.map((s, i) => {
              const searchUrl = `https://www.semanticscholar.org/search?q=${encodeURIComponent(s.title)}`;
              const paperUrl = s.doi ? `https://doi.org/${s.doi}` : searchUrl;
              return (
                <div key={i} style={{
                  padding: "10px 12px",
                  background: s.already_in_refs ? C.greenBg : `${C.accent}08`,
                  borderRadius: 10,
                  border: `1px solid ${s.already_in_refs ? C.green : C.accent}25`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <a
                      href={paperUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 14, fontWeight: 600, color: C.text, flex: 1, marginRight: 8, textDecoration: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
                      onMouseLeave={e => (e.currentTarget.style.color = C.text)}
                    >
                      {s.title}
                    </a>
                    {s.already_in_refs ? (
                      <span
                        onClick={e => { e.stopPropagation(); if (s.citation_id) onCitationSelect?.(s.citation_id); }}
                        title="Click to view this citation's analysis"
                        style={{ cursor: onCitationSelect ? "pointer" : "default" }}
                      >
                        <Badge color={C.green} bg={C.greenBg} icon="✓">In refs {s.citation_id} ↗</Badge>
                      </span>
                    ) : (
                      <Badge color={C.red} bg={C.redBg} icon="✗">Missing</Badge>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, color: C.textDim }}>
                      {s.authors.slice(0, 2).join(", ")}{s.authors.length > 2 ? " et al." : ""} · {s.year}
                    </span>
                    {s.venue && (
                      <span style={{ fontSize: 12, color: C.textDim }}>· {s.venue.slice(0, 30)}</span>
                    )}
                    {s.citation_count > 0 && (
                      <span style={{
                        fontSize: 12, color: blue,
                        background: blueBg, padding: "1px 6px", borderRadius: 10,
                      }}>
                        {s.citation_count.toLocaleString()} citations
                      </span>
                    )}
                    <span style={{
                      fontSize: 12, color: C.accent,
                      background: accentGlow, padding: "1px 6px", borderRadius: 10,
                    }}>
                      {Math.round(s.similarity * 100)}% match
                    </span>
                  </div>

                  {/* Action row */}
                  {!s.already_in_refs && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionButton
                        icon="📋"
                        label="Copy Citation"
                        color={C.accent}
                        bg={accentGlow}
                        onClick={() => {
                          const authors = s.authors.slice(0, 3).join(", ") + (s.authors.length > 3 ? " et al." : "");
                          navigator.clipboard.writeText(`${authors} (${s.year}). ${s.title}. ${s.venue}${s.doi ? `. https://doi.org/${s.doi}` : ""}`);
                        }}
                      />
                      <a
                        href={searchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 10px", borderRadius: 8,
                          border: `1px solid ${blue}30`,
                          background: blueBg,
                          color: blue,
                          fontSize: 13, fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        🔍 Find Paper
                      </a>
                    </div>
                  )}

                  {/* Already in refs hint */}
                  {s.already_in_refs && (
                    <div
                      onClick={e => { e.stopPropagation(); if (s.citation_id) onCitationSelect?.(s.citation_id); }}
                      style={{
                        marginTop: 4, fontSize: 13, color: C.green,
                        display: "flex", alignItems: "center", gap: 6,
                        cursor: onCitationSelect ? "pointer" : "default",
                        textDecoration: onCitationSelect ? "underline dotted" : "none",
                      }}
                    >
                      💡 Already in your reference list as {s.citation_id} — click to view its analysis
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Missing Paper Card ──────────────────────────────────────────────────────

function MissingPaperCard({
  paper,
  marked,
  onMark,
}: {
  paper: MissingPaper;
  marked: boolean;
  onMark: () => void;
}) {
  const { C } = useTheme();
  const accentGlow = `${C.accent}18`;
  const blue = "#3b82f6"; const blueBg = "rgba(59,130,246,0.12)";
  const purpleBg = "rgba(167,139,250,0.12)";
  const severityConfig = makeSeverityConfig(C);
  const categoryConfig = makeCategoryConfig(C);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const sev = severityConfig[paper.severity] || severityConfig.medium;
  const cat = categoryConfig[paper.category] || categoryConfig.methodological;

  const searchUrl = `https://www.semanticscholar.org/search?q=${encodeURIComponent(paper.title)}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(formatCitation(paper));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleMark = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMark();
  };

  return (
    <div
      style={{
        background: marked ? `${C.green}08` : C.card,
        border: `1px solid ${marked ? C.green + "40" : C.border}`,
        borderLeft: `3px solid ${marked ? C.green : sev.color}`,
        borderRadius: 12,
        overflow: "hidden",
        animation: "fadeIn 0.3s ease",
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: "14px", cursor: "pointer" }}
      >
        {/* Top row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
            <a
              href={paper.doi ? `https://doi.org/${paper.doi}` : searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4, lineHeight: 1.4, textDecoration: "none", display: "block" }}
              onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
              onMouseLeave={e => (e.currentTarget.style.color = C.text)}
            >
              {paper.title}
            </a>
            <div style={{ fontSize: 13, color: C.textDim }}>
              {paper.authors.slice(0, 2).map((a: any) => typeof a === "string" ? a : a.name || "").join(", ")}
              {paper.authors.length > 2 ? " et al." : ""} · {paper.year}
              {paper.venue ? ` · ${paper.venue}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
            {marked && (
              <span style={{
                fontSize: 12, fontWeight: 700, color: C.green,
                background: C.greenBg, padding: "2px 7px", borderRadius: 20,
                border: `1px solid ${C.green}30`,
              }}>
                ✓ Added
              </span>
            )}
            <span style={{ fontSize: 16, color: C.textDim }}>{expanded ? "▴" : "▾"}</span>
          </div>
        </div>

        {/* Badges row */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Badge color={sev.color} bg={sev.bg} icon={sev.icon}>{sev.label}</Badge>
          <Badge color={cat.color} bg={cat.bg} icon={cat.icon}>{cat.label}</Badge>
          {paper.citation_count > 0 && (
            <span style={{
              fontSize: 12, color: blue,
              background: blueBg, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${blue}22`,
            }}>
              ⭐ {paper.citation_count.toLocaleString()} citations
            </span>
          )}
          <span style={{
            fontSize: 12, color: C.accent,
            background: accentGlow, padding: "2px 7px",
            borderRadius: 20,
          }}>
            📍 {paper.section}
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Why it's needed */}
          <div style={{
            padding: "10px 12px",
            background: `${sev.color}08`,
            borderRadius: 8,
            border: `1px solid ${sev.color}15`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>
              Why It's Needed
            </div>
            <div style={{ fontSize: 14, color: C.textMuted, lineHeight: 1.6 }}>
              {paper.reason}
            </div>
          </div>

          {/* Suggested placement */}
          <div style={{
            padding: "10px 12px",
            background: accentGlow,
            borderRadius: 8,
            border: `1px solid ${C.accent}25`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>📍</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>
                Suggested Placement
              </div>
              <div style={{ fontSize: 14, color: C.accent, fontWeight: 600 }}>
                {paper.section}
              </div>
            </div>
          </div>

          {/* ── Action row ── */}
          <div style={{
            padding: "10px 12px",
            background: `${blue}06`,
            borderRadius: 8,
            border: `1px solid ${blue}18`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
              Actions
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Mark as added */}
              <button
                onClick={handleMark}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 8,
                  border: `1px solid ${marked ? C.green + "50" : C.green + "30"}`,
                  background: marked ? C.greenBg : "transparent",
                  color: marked ? C.green : C.textMuted,
                  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {marked ? "✓ Marked as Added" : "＋ Mark as Added"}
              </button>

              {/* Copy citation */}
              <button
                onClick={handleCopy}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 8,
                  border: `1px solid ${C.accent}30`,
                  background: copied ? accentGlow : "transparent",
                  color: copied ? C.accent : C.textMuted,
                  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {copied ? "✓ Copied!" : "📋 Copy Citation"}
              </button>

              {/* Search Semantic Scholar */}
              <a
                href={searchUrl}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 8,
                  border: `1px solid ${blue}30`,
                  background: "transparent",
                  color: C.textMuted,
                  fontSize: 13.5, fontWeight: 600,
                  textDecoration: "none",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = blue; e.currentTarget.style.background = blueBg; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = "transparent"; }}
              >
                🔍 Find on S2
              </a>

              {/* DOI link */}
              {paper.doi && (
                <a
                  href={`https://doi.org/${paper.doi}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "6px 12px", borderRadius: 8,
                    border: `1px solid ${C.purple}30`,
                    background: "transparent",
                    color: C.textMuted,
                    fontSize: 13.5, fontWeight: 600,
                    textDecoration: "none",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.purple; e.currentTarget.style.background = purpleBg; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = "transparent"; }}
                >
                  🔗 Open DOI
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Action Summary Banner ────────────────────────────────────────────────────

function ActionBanner({ marked, total, onClearAll }: { marked: number; total: number; onClearAll: () => void }) {
  const { C } = useTheme();
  if (marked === 0) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 14px", marginBottom: 12,
      background: C.greenBg, borderRadius: 10,
      border: `1px solid ${C.green}30`,
      animation: "fadeIn 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>✅</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.green }}>
          {marked} of {total} papers marked as added
        </span>
      </div>
      <button
        onClick={onClearAll}
        style={{
          fontSize: 13, color: C.textDim, background: "transparent",
          border: `1px solid ${C.border}`, borderRadius: 6,
          padding: "3px 8px", cursor: "pointer",
        }}
      >
        Clear all
      </button>
    </div>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────────

function LoadingState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 0 24px" }}>
        <div style={{ fontSize: 32 }}>🔍</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textMuted }}>Finding missing citations...</div>
        <div style={{ fontSize: 14, color: C.textDim, textAlign: "center", lineHeight: 1.6, maxWidth: 260 }}>
          Detecting uncited claims, searching Semantic Scholar, and running agent analysis
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

      {/* Skeleton cards */}
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 14, marginBottom: 10, opacity: 0.5 - i * 0.1,
        }}>
          <div style={{ height: 12, borderRadius: 4, background: C.border, marginBottom: 8, width: "40%" }} />
          <div style={{ height: 12, borderRadius: 4, background: C.border, marginBottom: 6 }} />
          <div style={{ height: 12, borderRadius: 4, background: C.border, width: "75%" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Coming soon (no data, no loading) ───────────────────────────────────────

function ComingSoon() {
  const { C } = useTheme();
  const blue = "#3b82f6";
  const cyan = "#06b6d4";
  return (
    <div style={{ padding: "0 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0 28px", textAlign: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: `linear-gradient(135deg, ${C.accent}20, ${C.purple}20)`,
          border: `1px solid ${C.accent}30`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
        }}>🔍</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Missing Citations Detection</div>
          <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
            Upload a PDF to detect uncited claims and find papers that should be referenced.
          </div>
        </div>
      </div>

      {/* Feature preview */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>What this tab detects:</div>
        {[
          { icon: "💬", color: C.yellow, title: "Uncited Claims",      desc: "Sentences making factual assertions with no citation" },
          { icon: "📚", color: C.purple, title: "Foundational Papers", desc: "Seminal works your topic builds on" },
          { icon: "⚔️", color: cyan,     title: "Competing Systems",   desc: "Related work that should be acknowledged" },
          { icon: "🔬", color: blue,     title: "Methodological Refs", desc: "Methods used but not properly attributed" },
        ].map((item, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "8px 0",
            borderBottom: i < 3 ? `1px solid ${C.border}` : "none",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: `${item.color}15`, border: `1px solid ${item.color}25`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
            }}>{item.icon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.title}</div>
              <div style={{ fontSize: 13, color: C.textDim, marginTop: 2 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MissingCitationsTab({
  data,
  loading,
  onCitationSelect,
}: {
  data: MissingCitationsData | null;
  loading: boolean;
  onCitationSelect?: (id: string) => void;
}) {
  const { C } = useTheme();
  const accentGlow = `${C.accent}18`;
  const orange = "#f97316";
  const severityConfig = makeSeverityConfig(C);

  const [view, setView] = useState<"claims" | "missing">("missing");
  const [markedSet, setMarkedSet] = useState<Set<string>>(new Set());
  const [sectionFilter, setSectionFilter] = useState<string>("all");

  const toggleMark = (title: string) => {
    setMarkedSet(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  if (loading) return <LoadingState />;
  if (!data) return <ComingSoon />;

  const criticalCount    = data.missing_papers.filter(p => p.severity === "critical").length;
  const highCount        = data.missing_papers.filter(p => p.severity === "high").length;
  const markedCount      = markedSet.size;
  const actionableClaims = data.claims.filter(c => c.suggestions.length > 0);

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <StatBox value={data.total_missing}       label="Missing"  color={C.red}    sub="Papers" />
        <StatBox value={criticalCount}             label="Critical" color={C.red}    sub="Must add" />
        <StatBox value={highCount}                 label="High"     color={orange}   sub="Should add" />
        <StatBox value={actionableClaims.length}   label="Uncited"  color={C.yellow} sub="Claims" />
      </div>

      {/* View toggle */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 14,
        background: C.surface, borderRadius: 10, padding: 4,
        border: `1px solid ${C.border}`,
      }}>
        {([
          { id: "missing", label: "Missing Papers", icon: "📚", count: data.total_missing },
          { id: "claims",  label: "Uncited Claims", icon: "💬", count: actionableClaims.length },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "7px 10px", borderRadius: 7, border: "none",
              background: view === tab.id ? C.card : "transparent",
              color: view === tab.id ? C.text : C.textDim,
              fontSize: 13.5, fontWeight: view === tab.id ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
              boxShadow: view === tab.id ? `0 1px 4px rgba(0,0,0,0.3)` : "none",
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: view === tab.id ? C.accent : C.textDim,
              background: view === tab.id ? accentGlow : "transparent",
              padding: "0px 5px", borderRadius: 10,
            }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Missing Papers view */}
      {view === "missing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Action progress banner */}
          <ActionBanner
            marked={markedCount}
            total={data.total_missing}
            onClearAll={() => setMarkedSet(new Set())}
          />

          {data.missing_papers.length === 0 && (
            <div style={{ textAlign: "center", color: C.green, padding: "32px 0", fontSize: 15 }}>
              ✓ No significant missing citations detected
            </div>
          )}

          {/* Group by severity */}
          {(["critical", "high", "medium"] as const).map(severity => {
            const papers = data.missing_papers.filter(p => p.severity === severity);
            if (papers.length === 0) return null;
            const sev = severityConfig[severity];
            return (
              <div key={severity}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: 8, paddingLeft: 4,
                }}>
                  <span style={{ fontSize: 15 }}>{sev.icon}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: sev.color }}>{sev.label}</span>
                  <div style={{ flex: 1, height: 1, background: `${sev.color}25` }} />
                  <span style={{ fontSize: 12, color: sev.color }}>{papers.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {papers.map((p, i) => (
                    <MissingPaperCard
                      key={i}
                      paper={p}
                      marked={markedSet.has(p.title)}
                      onMark={() => toggleMark(p.title)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Uncited Claims view */}
      {view === "claims" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actionableClaims.length === 0 && (
            <div style={{ textAlign: "center", color: C.green, padding: "32px 0", fontSize: 15 }}>
              ✓ No significant uncited claims detected
            </div>
          )}

          {/* Section filter pills */}
          {actionableClaims.length > 0 && (() => {
            const sections = Array.from(new Set(actionableClaims.map(c => c.section)));
            if (sections.length <= 1) return null;
            return (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {["all", ...sections].map(sec => {
                  const isActive = sectionFilter === sec;
                  const count = sec === "all" ? actionableClaims.length : actionableClaims.filter(c => c.section === sec).length;
                  return (
                    <button
                      key={sec}
                      onClick={() => setSectionFilter(sec)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "4px 10px", borderRadius: 20,
                        background: isActive ? C.accent : C.surface,
                        color: isActive ? "white" : C.textDim,
                        fontSize: 12.5, fontWeight: isActive ? 600 : 400,
                        cursor: "pointer", transition: "all 0.15s",
                        border: `1px solid ${isActive ? C.accent : C.border}`,
                      } as React.CSSProperties}
                    >
                      {sec === "all" ? "All sections" : sec}
                      <span style={{
                        fontSize: 11.5, fontWeight: 700,
                        color: isActive ? "rgba(255,255,255,0.8)" : C.textDim,
                      }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Group by section */}
          {Object.entries(
            actionableClaims
              .filter(c => sectionFilter === "all" || c.section === sectionFilter)
              .reduce((acc, claim) => {
                if (!acc[claim.section]) acc[claim.section] = [];
                acc[claim.section].push(claim);
                return acc;
              }, {} as Record<string, UncitedClaim[]>)
          ).map(([section, claims]) => (
            <div key={section}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: 8, paddingLeft: 4,
              }}>
                <span style={{ fontSize: 13, color: C.accent }}>📍</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.textMuted }}>{section}</span>
                <div style={{ flex: 1, height: 1, background: `${C.accent}20` }} />
                <span style={{ fontSize: 12, color: C.textDim }}>{claims.length} claim{claims.length > 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {claims.map((claim, i) => <ClaimCard key={i} claim={claim} index={i} onCitationSelect={onCitationSelect} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
