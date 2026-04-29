import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { AIResult } from "../types";
import AlignmentDrawer, { AlignmentData } from "./AlignmentDrawer";
import ReproducibilityPanel, { ReproducibilityData } from "./ReproducibilityPanel";
import { useTheme } from "../theme";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const PAGE_WIDTH = 620;
const PAGE_GAP   = 16;

const STATUS = {
  human:     { color: "#10b981", bg: "rgba(16,185,129,0.25)", border: "rgba(16,185,129,0.7)", icon: "✓",  label: "Verified Human" },
  uncertain: { color: "#f59e0b", bg: "rgba(245,158,11,0.25)", border: "rgba(245,158,11,0.7)", icon: "?",  label: "Uncertain"      },
  ai_likely: { color: "#ef4444", bg: "rgba(239,68,68,0.25)",  border: "rgba(239,68,68,0.7)",  icon: "🤖", label: "AI-Likely"      },
  default:   { color: "#6366f1", bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.4)", icon: "·",  label: "Analyzing…"     },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawPosition {
  id: string;
  allIds: string[];
  left: number;
  top: number;
  width: number;
  height: number;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function CitationTooltip({ citation, x, y }: { citation: AIResult; x: number; y: number }) {
  const { C } = useTheme();
  const s = STATUS[citation.status as keyof typeof STATUS] ?? STATUS.default;
  const score = citation.status === "human" ? 100 : citation.aiScore;
  const scoreLabel = citation.status === "human" ? "Human confidence" : "AI score";

  return (
    <div style={{
      position: "fixed", left: x + 14, top: y - 8, zIndex: 9999,
      background: C.surface, border: `1px solid ${s.border}`,
      borderRadius: 10, padding: "10px 13px", width: 260,
      boxShadow: `0 8px 32px rgba(0,0,0,0.25), 0 0 0 1px ${s.border}`,
      pointerEvents: "none", fontFamily: "'DM Sans','Segoe UI',sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
        <span style={{
          background: s.bg, color: s.color, border: `1px solid ${s.border}`,
          borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <span>{s.icon}</span> {s.label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.textDim }}>
          {citation.id}
        </span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4, marginBottom: 6 }}>
        {citation.title || "Untitled"}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 7, flexWrap: "wrap" }}>
        {citation.year && (
          <span style={{ fontSize: 10, color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 6px" }}>
            📅 {citation.year}
          </span>
        )}
        {citation.source && (
          <span style={{ fontSize: 10, color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 6px" }}>
            📚 {citation.source.length > 30 ? citation.source.slice(0, 28) + "…" : citation.source}
          </span>
        )}
        {citation.citation_count != null && citation.citation_count > 0 && (
          <span style={{ fontSize: 10, color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 6px" }}>
            🔗 cited {citation.citation_count}×
          </span>
        )}
      </div>
      <div style={{ marginBottom: citation.flags?.length ? 7 : 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 10, color: C.textDim }}>{scoreLabel}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: s.color }}>{score}%</span>
        </div>
        <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${score}%`, background: s.color, borderRadius: 2 }} />
        </div>
      </div>
      {citation.flags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
          {citation.flags.slice(0, 3).map(f => (
            <span key={f} style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 4,
              background: "rgba(239,68,68,0.15)", color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.3)",
            }}>⚠ {f.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 10, color: C.textDim, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
        Click to view full analysis →
      </div>
    </div>
  );
}

// ── Citation extraction for a single page ────────────────────────────────────

async function extractPagePositions(
  doc: any,
  pageNum: number,
): Promise<RawPosition[]> {
  const page     = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scale    = PAGE_WIDTH / viewport.width;
  const pageH    = viewport.height;
  const content  = await page.getTextContent();

  type ItemInfo = { str: string; x: number; y: number; w: number; h: number };
  const lineMap = new Map<number, ItemInfo[]>();

  for (const raw of content.items as any[]) {
    const str: string = raw.str ?? "";
    if (!str) continue;
    const tf: number[] = raw.transform;
    if (!tf || tf.length < 6) continue;
    const h: number = raw.height ?? 0;
    if (h === 0) continue;

    const yKey = Math.round(tf[5] / 2) * 2;
    if (!lineMap.has(yKey)) lineMap.set(yKey, []);
    lineMap.get(yKey)!.push({ str, x: tf[4], y: tf[5], w: raw.width ?? 0, h });
  }

  const CITATION_RE = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;
  const results: RawPosition[] = [];

  for (const items of lineMap.values()) {
    items.sort((a, b) => a.x - b.x);

    let combined = "";
    const charPositions: Array<{ x: number; y: number; h: number }> = [];

    for (const item of items) {
      const charW = item.str.length > 0 ? item.w / item.str.length : 0;
      for (let i = 0; i < item.str.length; i++) {
        charPositions.push({ x: item.x + i * charW, y: item.y, h: item.h });
        combined += item.str[i];
      }
    }

    CITATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITATION_RE.exec(combined)) !== null) {
      const innerContent = m[1];
      const numRe = /\d+/g;
      let nm: RegExpExecArray | null;

      while ((nm = numRe.exec(innerContent)) !== null) {
        const numStart = m.index + 1 + nm.index;
        const numEnd   = numStart + nm[0].length - 1;
        const first = charPositions[numStart];
        const last  = charPositions[numEnd];
        if (!first || !last) continue;

        const citId = `[${nm[0]}]`;
        results.push({
          id:     citId,
          allIds: [citId],
          left:   first.x * scale,
          top:    Math.max(0, (pageH - first.y) * scale - first.h * scale),
          width:  Math.max((last.x - first.x + last.h * 0.5) * scale, 10),
          height: Math.max(first.h * scale, 12),
        });
      }
    }
  }

  return results;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PDFViewer({
  pdfUrl, onCitationClick, citations = [],
  alignmentData, alignmentLoading,
  reproData, reproLoading,
}: {
  pdfUrl: string;
  onCitationClick: (id: string) => void;
  selectedCitationId?: string | null;
  citations?: AIResult[];
  alignmentData?: AlignmentData | null;
  alignmentLoading?: boolean;
  reproData?: ReproducibilityData | null;
  reproLoading?: boolean;
}) {
  const { C, theme } = useTheme();
  const [numPages, setNumPages]   = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [pagePositions, setPagePositions] = useState<Map<number, RawPosition[]>>(new Map());
  const [tooltip, setTooltip]     = useState<{ citation: AIResult; x: number; y: number } | null>(null);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [reproOpen, setReproOpen] = useState(false);

  const cbRef = useRef(onCitationClick);
  cbRef.current = onCitationClick;
  const citationsRef = useRef(citations);
  citationsRef.current = citations;

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs  = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Filtered overlays per page ─────────────────────────────────────────────
  const filteredPagePositions = useMemo(() => {
    const validIds = new Set(citations.map(c => c.id));
    const result = new Map<number, RawPosition[]>();
    pagePositions.forEach((positions, pageNum) => {
      result.set(
        pageNum,
        validIds.size === 0
          ? positions
          : positions.filter(p => p.allIds.some(id => validIds.has(id))),
      );
    });
    return result;
  }, [pagePositions, citations]);

  // ── Extract citations for every page ──────────────────────────────────────
  useEffect(() => {
    if (!numPages) return;
    let cancelled = false;

    const run = async () => {
      const doc = await pdfjs.getDocument(pdfUrl).promise;
      if (cancelled) return;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (cancelled) return;
        const positions = await extractPagePositions(doc, pageNum);
        if (cancelled) return;
        setPagePositions(prev => new Map(prev).set(pageNum, positions));
      }
    };

    setPagePositions(new Map());
    run().catch(console.error);
    return () => { cancelled = true; };
  }, [pdfUrl, numPages]);

  // ── Scroll → update visible page indicator ────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const containerMid = scrollRef.current.scrollTop + scrollRef.current.clientHeight / 2;
    let closest = 1;
    let minDist  = Infinity;
    pageRefs.current.forEach((el, pageNum) => {
      const elTop    = el.offsetTop;
      const elMid    = elTop + el.offsetHeight / 2;
      const dist     = Math.abs(elMid - containerMid);
      if (dist < minDist) { minDist = dist; closest = pageNum; }
    });
    setVisiblePage(closest);
  }, []);

  const handleLoadSuccess = useCallback((doc: any) => {
    setNumPages(doc.numPages);
  }, []);

  // ── Overlay renderer (shared across pages) ────────────────────────────────
  const renderOverlays = (overlays: RawPosition[]) =>
    overlays.map((o, i) => {
      const cit = citationsRef.current.find(c => c.id === o.id);
      const s   = STATUS[cit?.status as keyof typeof STATUS ?? "default"] ?? STATUS.default;

      return (
        <div
          key={`${o.id}-${i}`}
          style={{
            position: "absolute",
            left:         o.left,
            top:          o.top,
            width:        o.width,
            height:       o.height,
            background:   s.bg,
            border:       `1px solid ${s.border}`,
            borderRadius: 3,
            cursor:       "pointer",
            zIndex:       10,
            boxSizing:    "border-box",
            transition:   "background 0.1s, border-color 0.1s, box-shadow 0.1s",
          }}
          onMouseEnter={(e) => {
            if (cit) setTooltip({ citation: cit, x: e.clientX, y: e.clientY });
            const el = e.currentTarget as HTMLDivElement;
            el.style.background  = s.bg.replace(/[\d.]+\)$/, "0.55)");
            el.style.borderColor = s.color;
            el.style.boxShadow   = `0 0 0 1px ${s.color}`;
          }}
          onMouseMove={(e) => {
            if (cit) setTooltip(prev =>
              prev?.citation.id === cit.id
                ? { ...prev, x: e.clientX, y: e.clientY }
                : { citation: cit, x: e.clientX, y: e.clientY }
            );
          }}
          onMouseLeave={(e) => {
            setTooltip(null);
            const el = e.currentTarget as HTMLDivElement;
            el.style.background  = s.bg;
            el.style.borderColor = s.border;
            el.style.boxShadow   = "";
          }}
          onClick={() => {
            cbRef.current(o.id);
            setTooltip(null);
          }}
        />
      );
    });

  // ── Floating button style helper ──────────────────────────────────────────
  const floatBtn = (active: boolean, activeColor: string, activeBorder: string) => ({
    display: "flex", alignItems: "center", gap: 7,
    background: active
      ? (theme === "dark" ? `rgba(${hexToRgb(activeColor)},0.2)` : `${activeColor}18`)
      : C.card,
    border: `1px solid ${active ? activeBorder : C.border}`,
    borderRadius: 10,
    color: active ? activeColor : C.textMuted,
    fontSize: 12, fontWeight: 600,
    padding: "7px 13px",
    cursor: "pointer",
    boxShadow: theme === "dark" ? "0 4px 16px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.1)",
    transition: "all 0.15s ease",
    fontFamily: "'DM Sans','Segoe UI',sans-serif",
  } as React.CSSProperties);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, position: "relative" }}>
      {tooltip && <CitationTooltip {...tooltip} />}

      {/* Toolbar */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, color: C.textDim }}>
          Page {visiblePage} of {numPages || "—"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          {([
            { key: "human",     label: "Human"     },
            { key: "uncertain", label: "Uncertain" },
            { key: "ai_likely", label: "AI-Likely" },
          ] as const).map(({ key, label }) => {
            const s = STATUS[key];
            return (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  background: s.bg, border: `1px solid ${s.border}`,
                }} />
                <span style={{ color: s.color }}>{label}</span>
              </span>
            );
          })}
          <span style={{ fontSize: 11, color: C.textDim, marginLeft: 4 }}>— click to inspect</span>
        </div>
      </div>

      {/* PDF area (position:relative so panels anchor inside it) */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* Scrollable PDF */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            justifyContent: "center",
            padding: "20px 20px",
            paddingBottom: alignmentOpen ? 320 + 20 : 20,
            transition: "padding-bottom 0.25s ease",
            background: theme === "light" ? "#e2e8f0" : C.bg,
          }}
        >
          <Document
            file={pdfUrl}
            onLoadSuccess={handleLoadSuccess}
            loading={<div style={{ color: C.textDim, padding: 40 }}>Loading PDF…</div>}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: PAGE_GAP }}>
              {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                <div
                  key={pageNum}
                  ref={el => { if (el) pageRefs.current.set(pageNum, el); else pageRefs.current.delete(pageNum); }}
                  style={{
                    position: "relative", width: PAGE_WIDTH,
                    boxShadow: theme === "light"
                      ? "0 2px 16px rgba(0,0,0,0.15)"
                      : "0 4px 24px rgba(0,0,0,0.4)",
                  }}
                >
                  <Page
                    pageNumber={pageNum}
                    width={PAGE_WIDTH}
                    renderTextLayer={true}
                    renderAnnotationLayer={false}
                  />
                  {renderOverlays(filteredPagePositions.get(pageNum) ?? [])}
                </div>
              ))}
            </div>
          </Document>
        </div>

        {/* Floating review toolbar — bottom-left */}
        <div style={{
          position: "absolute",
          bottom: alignmentOpen ? 328 : 16,
          left: 16,
          display: "flex",
          gap: 8,
          zIndex: 200,
          transition: "bottom 0.25s ease",
        }}>
          <button
            onClick={() => { setAlignmentOpen(v => !v); }}
            title="Abstract ↔ Conclusion Alignment"
            style={floatBtn(alignmentOpen, "#818cf8", "rgba(99,102,241,0.7)")}
          >
            <span style={{ fontSize: 14 }}>⇌</span>
            Alignment
            {alignmentLoading && <span style={{ fontSize: 10, color: "#6366f1" }}>●</span>}
          </button>

          <button
            onClick={() => setReproOpen(v => !v)}
            title="Reproducibility Checklist"
            style={floatBtn(reproOpen, "#34d399", "rgba(16,185,129,0.6)")}
          >
            <span style={{ fontSize: 14 }}>🔬</span>
            Reproducibility
            {reproLoading && <span style={{ fontSize: 10, color: "#10b981" }}>●</span>}
          </button>
        </div>

        {/* Alignment drawer — slides up from bottom */}
        <AlignmentDrawer
          data={alignmentData ?? null}
          loading={alignmentLoading ?? false}
          open={alignmentOpen}
          onClose={() => setAlignmentOpen(false)}
        />

        {/* Reproducibility panel — slides in from right */}
        <ReproducibilityPanel
          data={reproData ?? null}
          loading={reproLoading ?? false}
          open={reproOpen}
          onClose={() => setReproOpen(false)}
        />
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
