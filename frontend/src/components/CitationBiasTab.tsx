import { useState } from "react";
import { useTheme } from "../theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BiasAuthor {
  name: string;
  count: number;
}

export interface BiasYearBucket {
  year: string;
  count: number;
}

export interface BiasVenueBucket {
  type: string;
  count: number;
}

export interface BiasCitationStub {
  id: string;
  title: string;
  year: number | null;
}

export interface CitationBiasData {
  most_cited_authors: BiasAuthor[];
  year_distribution: BiasYearBucket[];
  citations_by_year: Record<string, BiasCitationStub[]>;
  total_citations: number;
  median_year: number | null;
  recency_score: number;
  venue_distribution?: BiasVenueBucket[];
  min_year?: number | null;
}

// ─── Semantic colours (stable across themes) ──────────────────────────────────

const _green  = "#10b981";
const _yellow = "#f59e0b";
const _orange = "#f97316";
const _blue   = "#3b82f6";

const VENUE_COLORS: Record<string, string> = {
  Journal:    "#6366f1",
  Conference: "#3b82f6",
  Preprint:   "#f59e0b",
  Workshop:   "#10b981",
  Unknown:    "#64748b",
};

// ─── Stat Box ─────────────────────────────────────────────────────────────────

function StatBox({ value, label, sub, color }: { value: any; label: string; sub?: string; color: string }) {
  const { C } = useTheme();
  return (
    <div style={{
      flex: 1, textAlign: "center", padding: "14px 8px",
      background: `linear-gradient(135deg, ${color}08, ${color}14)`,
      borderRadius: 12, border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Recency Timeline ─────────────────────────────────────────────────────────

function RecencyTimeline({
  minYear, medianYear, recencyScore,
}: {
  minYear: number; medianYear: number | null; recencyScore: number;
}) {
  const { C } = useTheme();
  const maxYear = 2025;
  const recentStart = maxYear - 5;
  const span = maxYear - minYear || 1;
  const medPct = medianYear != null ? ((medianYear - minYear) / span) * 100 : null;
  const recPct = ((recentStart - minYear) / span) * 100;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "14px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>📅</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Citation Age Timeline</span>
        <span style={{
          marginLeft: "auto", fontSize: 11, fontWeight: 700,
          color: recencyScore >= 50 ? _green : recencyScore >= 25 ? _yellow : _orange,
        }}>
          {recencyScore}% in last 5 yrs
        </span>
      </div>

      <div style={{ position: "relative", height: 26, marginBottom: 20 }}>
        <div style={{
          position: "absolute", top: 8, left: 0, right: 0,
          height: 10, background: `${C.accent}18`, borderRadius: 6,
        }} />
        <div style={{
          position: "absolute", top: 8,
          left: `${Math.max(0, recPct)}%`,
          width: `${100 - Math.max(0, recPct)}%`,
          height: 10,
          background: `${_green}35`, borderRadius: "0 6px 6px 0",
          borderLeft: `2px solid ${_green}60`,
        }} />
        {medPct != null && (
          <div style={{
            position: "absolute", left: `${medPct}%`, top: 4,
            width: 3, height: 18, background: _blue,
            borderRadius: 2, transform: "translateX(-50%)",
          }}>
            <div style={{
              position: "absolute", top: -16, left: "50%",
              transform: "translateX(-50%)",
              fontSize: 9, fontWeight: 700, color: _blue,
              whiteSpace: "nowrap", background: C.card, padding: "0 3px",
            }}>
              {medianYear}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim }}>
        <span>{minYear}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 8, height: 3, background: _blue, borderRadius: 2 }} />
            Median year
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, background: `${_green}35`, borderRadius: 2, border: `1px solid ${_green}60` }} />
            Last 5 years
          </span>
        </div>
        <span>{maxYear}</span>
      </div>
    </div>
  );
}

// ─── Venue Distribution ───────────────────────────────────────────────────────

function VenueChart({ venues }: { venues: BiasVenueBucket[] }) {
  const { C } = useTheme();
  if (venues.length === 0) return null;
  const total = venues.reduce((s, v) => s + v.count, 0);
  const max   = Math.max(...venues.map(v => v.count));

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "16px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 15 }}>🏛️</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Venue Distribution</span>
        <span style={{
          fontSize: 10, color: C.textDim,
          background: `${C.textDim}15`, padding: "2px 8px", borderRadius: 10, marginLeft: "auto",
        }}>
          {total} classified
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {venues.map((v, i) => {
          const color  = VENUE_COLORS[v.type] ?? C.textDim;
          const barPct = (v.count / max) * 100;
          const pct    = total > 0 ? Math.round(v.count / total * 100) : 0;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 80, fontSize: 12, color, fontWeight: 600, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.type}
              </span>
              <div style={{ flex: 1, height: 8, background: `${color}18`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{
                  width: `${barPct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${color}, ${color}bb)`,
                  borderRadius: 10, transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
                }} />
              </div>
              <span style={{ fontSize: 11, color, fontWeight: 700, width: 24, textAlign: "right", flexShrink: 0 }}>{v.count}</span>
              <span style={{ fontSize: 10, color: C.textDim, width: 28, textAlign: "right", flexShrink: 0 }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Most Cited Authors ───────────────────────────────────────────────────────

function AuthorsChart({ authors, totalCitations }: { authors: BiasAuthor[]; totalCitations: number }) {
  const { C } = useTheme();
  if (authors.length === 0) return null;

  const maxCount = Math.max(...authors.map(a => a.count));
  const topPct   = totalCitations > 0 ? Math.round((authors[0].count / totalCitations) * 100) : 0;
  const showConcentration = authors.length > 0 && topPct >= 25;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "16px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: showConcentration ? 10 : 14 }}>
        <span style={{ fontSize: 15 }}>👥</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Most Cited Authors</span>
        <span style={{
          fontSize: 10, color: C.textDim,
          background: `${C.textDim}15`, padding: "2px 8px", borderRadius: 10, marginLeft: "auto",
        }}>
          {authors.length} shown
        </span>
      </div>

      {showConcentration && (
        <div style={{
          marginBottom: 12, padding: "7px 10px",
          background: `${_yellow}08`, border: `1px solid ${_yellow}30`,
          borderRadius: 8, fontSize: 11, color: C.textDim, lineHeight: 1.5,
        }}>
          <span style={{ color: _yellow }}>⚠ Concentrated sourcing</span> —{" "}
          <span style={{ color: C.text }}>{authors[0].name}</span> accounts for{" "}
          <span style={{ color: _yellow, fontWeight: 700 }}>{topPct}%</span> of all citations.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {authors.map((author, i) => {
          const barPct = (author.count / maxCount) * 100;
          const scholarUrl = `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(author.name)}"`;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, width: 18, flexShrink: 0, textAlign: "right" }}>
                {i + 1}
              </span>
              <span style={{ width: 160, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <a
                  href={scholarUrl} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 12, color: C.text, textDecoration: "none",
                    borderBottom: `1px dashed ${C.accent}50`,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderBottomStyle = "solid")}
                  onMouseLeave={e => (e.currentTarget.style.borderBottomStyle = "dashed")}
                >
                  {author.name}
                </a>
              </span>
              <div style={{ flex: 1, height: 8, background: `${C.accent}15`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{
                  width: `${barPct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${C.accent}, ${C.accent}bb)`,
                  borderRadius: 10, transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
                }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, width: 24, textAlign: "right", flexShrink: 0 }}>
                {author.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Year Distribution ────────────────────────────────────────────────────────

function YearChart({
  distribution, citationsByYear,
}: {
  distribution: BiasYearBucket[];
  citationsByYear: Record<string, BiasCitationStub[]>;
}) {
  const { C } = useTheme();
  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  if (distribution.length === 0) return null;

  const maxCount     = Math.max(...distribution.map(d => d.count));
  const CHART_HEIGHT = 100;
  const drillCitations = selectedYear ? (citationsByYear[selectedYear] ?? []) : [];

  const pre2010  = distribution.find(d => d.year === "<2010")?.count ?? 0;
  const tens     = distribution.filter(d => !d.year.startsWith("<") && parseInt(d.year) >= 2010 && parseInt(d.year) < 2020).reduce((s, d) => s + d.count, 0);
  const twenties = distribution.filter(d => !d.year.startsWith("<") && parseInt(d.year) >= 2020).reduce((s, d) => s + d.count, 0);
  const decades  = [
    { label: "Pre-2010", count: pre2010,  color: C.textDim },
    { label: "2010s",    count: tens,     color: C.accent   },
    { label: "2020s",    count: twenties, color: _green     },
  ].filter(d => d.count > 0);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "16px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 15 }}>📊</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Publication Year Distribution</span>
        {selectedYear && (
          <button onClick={() => setSelectedYear(null)} style={{
            marginLeft: "auto", fontSize: 10, color: C.accent,
            background: `${C.accent}15`, border: `1px solid ${C.accent}30`,
            borderRadius: 10, padding: "2px 8px", cursor: "pointer",
          }}>
            ✕ clear
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {decades.map((d, i) => (
          <span key={i} style={{
            fontSize: 11, fontWeight: 600, padding: "3px 10px",
            borderRadius: 20, border: `1px solid ${d.color}40`,
            background: `${d.color}12`, color: d.color,
          }}>
            {d.label} · {d.count}
          </span>
        ))}
      </div>

      <div style={{
        display: "flex", alignItems: "flex-end", gap: 4,
        height: CHART_HEIGHT + 24, paddingBottom: 20, position: "relative",
      }}>
        {distribution.map((bucket, i) => {
          const barH = maxCount > 0 ? (bucket.count / maxCount) * CHART_HEIGHT : 0;
          const isRecent   = !bucket.year.startsWith("<") && parseInt(bucket.year) >= 2020;
          const isSelected = selectedYear === bucket.year;
          const barColor   = isSelected ? _green : isRecent ? C.accent : `${C.accent}70`;
          return (
            <div
              key={i}
              onClick={() => setSelectedYear(isSelected ? null : bucket.year)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", cursor: "pointer" }}
            >
              {bucket.count > 0 && (
                <span style={{
                  fontSize: 9, color: isSelected ? _green : C.textDim,
                  position: "absolute", bottom: 20 + barH + 3,
                  fontWeight: isSelected ? 700 : 400,
                }}>
                  {bucket.count}
                </span>
              )}
              <div style={{
                position: "absolute", bottom: 20,
                width: "100%", height: Math.max(barH, bucket.count > 0 ? 3 : 0),
                background: barColor, borderRadius: "3px 3px 0 0",
                transition: "background 0.15s, height 0.6s cubic-bezier(0.22,1,0.36,1)",
                boxShadow: isSelected ? `0 0 8px ${_green}60` : "none",
              }} />
              <span style={{
                position: "absolute", bottom: 0, fontSize: 8.5,
                color: isSelected ? _green : C.textDim,
                fontWeight: isSelected ? 700 : 400,
                whiteSpace: "nowrap",
                transform: distribution.length > 10 ? "rotate(-45deg)" : "none",
                transformOrigin: "center top",
              }}>
                {bucket.year.startsWith("<") ? bucket.year : bucket.year.slice(2)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: C.textDim, textAlign: "center", marginTop: 4 }}>
        {selectedYear
          ? `Showing ${drillCitations.length} citation${drillCitations.length !== 1 ? "s" : ""} from ${selectedYear}`
          : "Click a bar to see citations for that year"}
      </div>

      {selectedYear && drillCitations.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, animation: "fadeIn 0.2s ease" }}>
          {drillCitations.map((cit, i) => {
            const href = `https://scholar.google.com/scholar?q=${encodeURIComponent(cit.title)}`;
            return (
              <a key={i} href={href} target="_blank" rel="noopener noreferrer" style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: `${_green}08`, border: `1px solid ${_green}20`,
                borderLeft: `3px solid ${_green}`,
                borderRadius: 8, textDecoration: "none", transition: "background 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = `${_green}14`)}
                onMouseLeave={e => (e.currentTarget.style.background = `${_green}08`)}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: _green, fontFamily: "monospace", flexShrink: 0 }}>{cit.id}</span>
                <span style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{cit.title}</span>
                <span style={{ fontSize: 10, color: _green, flexShrink: 0, opacity: 0.7 }}>↗</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  const { C } = useTheme();
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 0 24px" }}>
        <div style={{ fontSize: 32 }}>⚖️</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted }}>Analysing citation bias...</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: "50%", background: C.accent,
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>
      {[1, 2].map(i => (
        <div key={i} style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: 18, marginBottom: 12, opacity: 0.5 - i * 0.1,
        }}>
          <div style={{ height: 12, borderRadius: 4, background: C.border, marginBottom: 14, width: "40%" }} />
          {[1, 2, 3, 4].map(j => (
            <div key={j} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ width: 120, height: 10, borderRadius: 4, background: C.border }} />
              <div style={{ flex: 1, height: 8, borderRadius: 10, background: C.border }} />
              <div style={{ width: 20, height: 10, borderRadius: 4, background: C.border }} />
            </div>
          ))}
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
        }}>⚖️</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Bias Analysis</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, maxWidth: 260 }}>
            Upload a PDF to see citation author distribution and publication year timeline.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CitationBiasTab({
  data, loading,
}: {
  data: CitationBiasData | null;
  loading: boolean;
}) {
  const { C } = useTheme();

  if (loading) return <LoadingState />;
  if (!data)   return <EmptyState />;

  const minYear = data.min_year ?? (data.year_distribution.length > 0
    ? Math.min(...data.year_distribution.filter(d => !d.year.startsWith("<")).map(d => parseInt(d.year)))
    : 2000);

  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <style>{`
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>⚖️</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Citation Bias Analysis</span>
        </div>
        <div style={{ fontSize: 12, color: C.textDim }}>
          Author distribution, publication year patterns, and venue breakdown
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <StatBox value={data.median_year ?? "—"} label="Median Year" sub="Publication age" color={_blue} />
        <StatBox
          value={`${data.recency_score}%`} label="Recency" sub="Last 5 years"
          color={data.recency_score >= 50 ? _green : data.recency_score >= 25 ? _yellow : _orange}
        />
        <StatBox value={data.total_citations} label="Total Refs" sub="Analysed" color={C.accent} />
      </div>

      <RecencyTimeline minYear={minYear} medianYear={data.median_year} recencyScore={data.recency_score} />

      <div style={{ animation: "fadeIn 0.4s ease" }}>
        <AuthorsChart authors={data.most_cited_authors} totalCitations={data.total_citations} />
        <YearChart distribution={data.year_distribution} citationsByYear={data.citations_by_year ?? {}} />
        {data.venue_distribution && data.venue_distribution.length > 0 && (
          <VenueChart venues={data.venue_distribution} />
        )}
      </div>
    </div>
  );
}
