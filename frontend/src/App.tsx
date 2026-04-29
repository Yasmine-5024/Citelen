import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "./theme";
import PDFViewer from "./components/PDFViewer";
import Sidebar from "./components/Sidebar";
import UploadScreen from "./components/UploadScreen";
import ReviewWorkspace, { ReviewWorkspaceTrigger } from "./components/ReviewWorkspace";
import AuthPage from "./pages/AuthPage";
import HistoryPage from "./pages/HistoryPage";
import HeaderBar from "./components/HeaderBar";
import ContextPanel from "./components/ContextPanel";
import BottomDock from "./components/BottomDock";
import { AIResult, MissingCitationsData, ReliabilityData, LimitationsData, StatsData, ReviewTemplateData } from "./types";
import { CitationNetworkData } from "./components/CitationNetworkTab";
import { CitationBiasData } from "./components/CitationBiasTab";
import { FormatCheckData } from "./components/QualityTab";
import { IntegrityData } from "./components/IntegrityTab";
import { AlignmentData } from "./components/AlignmentDrawer";
import { ReproducibilityData } from "./components/ReproducibilityPanel";
import CitationNetworkTab from "./components/CitationNetworkTab";
import CitationBiasTab from "./components/CitationBiasTab";
import QualityTab from "./components/QualityTab";
import IntegrityTab from "./components/IntegrityTab";
import ChatPanel from "./components/ChatPanel";
import DraftPanel from "./components/DraftPanel";

interface AppUser {
  id: number;
  email: string;
  name: string;
  institution: string;
}

export interface StreamingState {
  metadata: { title: string; authors: string[] } | null;
  totalCitations: number;
  citations: AIResult[];
  summary: { ai_likely: number; uncertain: number; human: number; ai_rate: number } | null;
  signals: { signal: string; count: number }[];
  phase: "idle" | "grobid" | "analyzing" | "complete" | "missing" | "error";
  error: string | null;
  missingData: MissingCitationsData | null;
  missingLoading: boolean;
}

const INITIAL_STATE: StreamingState = {
  metadata: null,
  totalCitations: 0,
  citations: [],
  summary: null,
  signals: [],
  phase: "idle",
  error: null,
  missingData: null,
  missingLoading: false,
};

export default function App() {
  const { C } = useTheme();
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<"auth" | "history" | "app">("auth");
  const [pdfHash, setPdfHash] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamingState>(INITIAL_STATE);
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);

  // Check for existing session on load
  useEffect(() => {
    const token = localStorage.getItem("reflens_token");
    if (!token) { setAuthLoading(false); return; }
    fetch("http://localhost:5000/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.user) { setUser(data.user); setView("history"); }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  const handleAuth = (u: AppUser, token: string) => {
    localStorage.setItem("reflens_token", token);
    setUser(u);
    setView("history");
  };

  const handleLogout = () => {
    localStorage.removeItem("reflens_token");
    setUser(null);
    setView("auth");
    setPdfUrl(null);
    setPdfHash(null);
    setStream(INITIAL_STATE);
  };

  const mapReliabilityRaw = (json: any): ReliabilityData => {
    const raw = json.citations as any[];
    const summary = json.summary;
    const citations = raw.map((r) => {
      const noAbstract = r.claim_integrity?.verdict === "no_data" || r.relevance == null;
      return {
        id: r.id,
        title: r.title ?? "",
        venue: r.venue ?? "",
        year: r.year != null ? String(r.year) : "",
        relevance: noAbstract ? null : (r.relevance ?? null),
        verdict: r.claim_integrity?.verdict ?? "no_data",
        flags: [
          ...(r.self_cite_score < 60 ? ["SELF_CITE"] : []),
          ...((r.warnings ?? []).some((w: string) => w.toLowerCase().includes("predatory")) ? ["PREDATORY"] : []),
          ...(noAbstract ? ["NO_ABSTRACT"] : []),
        ],
        claim: r.claim_integrity?.note ?? "",
        warning: (r.warnings ?? []).length > 0 ? r.warnings[0] : null,
        abstractFound: r.abstract_found ?? false,
        citationCount: r.citation_count ?? null,
        contexts: r.contexts ?? [],
        category: r.claim_integrity?.category ?? r.category ?? "Unknown",
      };
    });
    return { citations, summary };
  };

  const handleOpenFromHistory = async (hash: string, title: string) => {
    // Reset all state
    setStream({ ...INITIAL_STATE, phase: "grobid" });
    setReliabilityData(null); setNetworkData(null); setBiasData(null);
    setFormatData(null); setIntegrityData(null); setAlignmentData(null);
    setReproData(null); setLimitationsData(null); setStatsData(null);
    setReviewData(null); setSelectedCitationId(null); setCurrentFile(null);
    setPdfUrl(null);
    setPdfHash(hash);
    setView("app");

    const token = localStorage.getItem("reflens_token");
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    // Try to load the PDF blob so the viewer works
    try {
      const pdfRes = await fetch(`http://localhost:5000/pdf/${hash}`, { headers });
      if (pdfRes.ok) {
        const blob = await pdfRes.blob();
        setPdfUrl(URL.createObjectURL(blob));
      }
    } catch { /* PDF not critical — analysis still shows */ }

    // Load all cached analysis
    try {
      const cacheRes = await fetch(`http://localhost:5000/review-cache/${hash}`, { headers });
      if (!cacheRes.ok) {
        setStream((s) => ({ ...s, phase: "complete" }));
        return;
      }
      const cache = await cacheRes.json();

      // Metadata + citations from AI cache (most complete source)
      if (cache.ai) {
        const ai = cache.ai;
        setStream({
          metadata: ai.metadata ?? (cache.grobid?.metadata ?? null),
          totalCitations: ai.total ?? (cache.grobid?.total_citations ?? 0),
          citations: ai.citations ?? [],
          summary: ai.summary ?? null,
          signals: ai.signals ?? [],
          phase: "complete",
          error: null,
          missingData: cache.missing ?? null,
          missingLoading: false,
        });
      } else if (cache.grobid) {
        setStream((s) => ({
          ...s,
          metadata: cache.grobid.metadata,
          totalCitations: cache.grobid.total_citations,
          phase: "complete",
          missingData: cache.missing ?? null,
        }));
      } else {
        setStream((s) => ({ ...s, phase: "complete" }));
      }

      if (cache.reliability) setReliabilityData(mapReliabilityRaw(cache.reliability));
      if (cache.network) setNetworkData(cache.network as CitationNetworkData);
      if (cache.bias) setBiasData(cache.bias as CitationBiasData);
      if (cache.format_check) setFormatData(cache.format_check as FormatCheckData);
      if (cache.integrity) setIntegrityData(cache.integrity as IntegrityData);
      if (cache.limitations) setLimitationsData(cache.limitations as LimitationsData);
      if (cache.stats) setStatsData(cache.stats as StatsData);
    } catch {
      setStream((s) => ({ ...s, phase: "complete" }));
    }
  };
  const [reliabilityData, setReliabilityData] = useState<ReliabilityData | null>(null);
  const [reliabilityLoading, setReliabilityLoading] = useState(false);
  const [networkData, setNetworkData] = useState<CitationNetworkData | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [biasData, setBiasData] = useState<CitationBiasData | null>(null);
  const [biasLoading, setBiasLoading] = useState(false);
  const [formatData, setFormatData] = useState<FormatCheckData | null>(null);
  const [formatLoading, setFormatLoading] = useState(false);
  const [integrityData, setIntegrityData] = useState<IntegrityData | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [alignmentData, setAlignmentData] = useState<AlignmentData | null>(null);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [reproData, setReproData] = useState<ReproducibilityData | null>(null);
  const [reproLoading, setReproLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reviewWorkspaceOpen, setReviewWorkspaceOpen] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(480);
  const [workspaceWidth, setWorkspaceWidth] = useState(760);
  const [isResizing, setIsResizing] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (sidebarCollapsed && !reviewWorkspaceOpen) return;
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = reviewWorkspaceOpen ? workspaceWidth : sidebarWidth;
    setIsResizing(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCollapsed, reviewWorkspaceOpen, sidebarWidth, workspaceWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      const clamped = Math.max(280, Math.min(window.innerWidth - 300, dragStartWidth.current + delta));
      if (reviewWorkspaceOpen) setWorkspaceWidth(clamped);
      else setSidebarWidth(clamped);
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing, reviewWorkspaceOpen]);
  const [limitationsData, setLimitationsData] = useState<LimitationsData | null>(null);
  const [limitationsLoading, setLimitationsLoading] = useState(false);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewTemplateData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const fetchLimitations = async (file: File) => {
    setLimitationsLoading(true);
    setLimitationsData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/limitations", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setLimitationsData(json.data as LimitationsData);
    } catch (e) {
      console.error("Limitations fetch failed:", e);
    } finally {
      setLimitationsLoading(false);
    }
  };

  const fetchStats = async (file: File) => {
    setStatsLoading(true);
    setStatsData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/stats-check", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setStatsData(json.data as StatsData);
    } catch (e) {
      console.error("Stats fetch failed:", e);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchReview = async (file: File) => {
    setReviewLoading(true);
    setReviewData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/review-template", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setReviewData(json.data as ReviewTemplateData);
    } catch (e) {
      console.error("Review template fetch failed:", e);
    } finally {
      setReviewLoading(false);
    }
  };

  const fetchReliability = async (file: File) => {
    setReliabilityLoading(true);
    setReliabilityData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/reliability", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;

      const { citations: raw, summary } = json.data;

      // Map backend per-citation fields → ReliabilityCitation shape
      const citations = (raw as any[]).map((r) => {
        const noAbstract = r.claim_integrity?.verdict === "no_data" || r.relevance == null;
        return {
          id: r.id,
          title: r.title ?? "",
          venue: r.venue ?? "",
          year: r.year != null ? String(r.year) : "",
          relevance: noAbstract ? null : (r.relevance ?? null),
          verdict: r.claim_integrity?.verdict ?? "no_data",
          flags: [
            ...(r.self_cite_score < 60 ? ["SELF_CITE"] : []),
            ...((r.warnings ?? []).some((w: string) => w.toLowerCase().includes("predatory")) ? ["PREDATORY"] : []),
            ...(noAbstract ? ["NO_ABSTRACT"] : []),
          ],
          claim: r.claim_integrity?.note ?? "",
          warning: (r.warnings ?? []).length > 0 ? r.warnings[0] : null,
          abstractFound: r.abstract_found ?? false,
          citationCount: r.citation_count ?? null,
          contexts: r.contexts ?? [],
          category: r.claim_integrity?.category ?? r.category ?? "Unknown",
        };
      });

      setReliabilityData({ citations, summary });
    } catch (e) {
      console.error("Reliability fetch failed:", e);
    } finally {
      setReliabilityLoading(false);
    }
  };

  const fetchBias = async (file: File) => {
    setBiasLoading(true);
    setBiasData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/bias", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setBiasData(json.data as CitationBiasData);
    } catch (e) {
      console.error("Bias fetch failed:", e);
    } finally {
      setBiasLoading(false);
    }
  };

  const fetchFormatCheck = async (file: File) => {
    setFormatLoading(true);
    setFormatData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/format-check", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setFormatData(json.data as FormatCheckData);
    } catch (e) {
      console.error("Format check failed:", e);
    } finally {
      setFormatLoading(false);
    }
  };

  const fetchAlignment = async (file: File) => {
    setAlignmentLoading(true);
    setAlignmentData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/alignment", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setAlignmentData(json.data as AlignmentData);
    } catch (e) {
      console.error("Alignment fetch failed:", e);
    } finally {
      setAlignmentLoading(false);
    }
  };

  const fetchReproducibility = async (file: File) => {
    setReproLoading(true);
    setReproData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/reproducibility", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setReproData(json.data as ReproducibilityData);
    } catch (e) {
      console.error("Reproducibility fetch failed:", e);
    } finally {
      setReproLoading(false);
    }
  };

  const fetchIntegrity = async (file: File) => {
    setIntegrityLoading(true);
    setIntegrityData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/integrity", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setIntegrityData(json.data as IntegrityData);
    } catch (e) {
      console.error("Integrity fetch failed:", e);
    } finally {
      setIntegrityLoading(false);
    }
  };

  const fetchNetwork = async (file: File) => {
    setNetworkLoading(true);
    setNetworkData(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5000/network", { method: "POST", body: form });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setNetworkData(json.data as CitationNetworkData);
    } catch (e) {
      console.error("Network fetch failed:", e);
    } finally {
      setNetworkLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setPdfUrl(URL.createObjectURL(file));
    setSelectedCitationId(null);
    setStream({ ...INITIAL_STATE, phase: "grobid" });
    setReviewData(null);
    setCurrentFile(file);
    setPdfHash(null);
    setView("app");
    fetchReliability(file);
    fetchNetwork(file);
    fetchBias(file);
    fetchFormatCheck(file);
    fetchIntegrity(file);
    fetchAlignment(file);
    fetchReproducibility(file);
    fetchLimitations(file);
    fetchStats(file);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = localStorage.getItem("reflens_token");
      const response = await fetch("http://localhost:5000/analyze", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        setStream((s) => ({ ...s, phase: "error", error: err.error ?? "Unknown error" }));
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep any incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "metadata") {
              if (event.hash) setPdfHash(event.hash);
              setStream((s) => ({
                ...s,
                metadata: event.data,
                totalCitations: event.total,
                phase: "analyzing",
              }));
            } else if (event.type === "citation") {
              setStream((s) => ({
                ...s,
                citations: [...s.citations, event.data as AIResult],
              }));
            } else if (event.type === "complete") {
              setStream((s) => ({
                ...s,
                summary: event.summary,
                signals: event.signals,
                phase: "complete",
              }));
            } else if (event.type === "missing_start") {
              setStream((s) => ({
                ...s,
                missingLoading: true,
                phase: "missing",
              }));
            } else if (event.type === "missing_complete") {
              setStream((s) => ({
                ...s,
                missingData: event.data as MissingCitationsData,
                missingLoading: false,
                phase: "complete",
              }));
            } else if (event.type === "error") {
              setStream((s) => ({
                ...s,
                phase: "error",
                error: event.message,
              }));
            }
          } catch {
            // malformed JSON line — skip
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setStream((s) => ({ ...s, phase: "error", error: msg }));
    }
  };

  if (authLoading) {
    return (
      <div style={{ height: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.textDim, fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>Loading…</div>
      </div>
    );
  }

  if (view === "auth") {
    return <AuthPage onAuth={handleAuth} />;
  }

  if (view === "history") {
    return (
      <HistoryPage
        user={user!}
        onUpload={handleUpload}
        onOpenFromHistory={handleOpenFromHistory}
        onLogout={handleLogout}
      />
    );
  }

  if (!pdfUrl && !pdfHash) {
    return <UploadScreen onUpload={handleUpload} />;
  }

  // Suppress unused-variable warnings for legacy state kept for compatibility
  void sidebarCollapsed;
  void setSidebarCollapsed;
  void reviewWorkspaceOpen;
  void setReviewWorkspaceOpen;
  void sidebarWidth;
  void setSidebarWidth;
  void workspaceWidth;
  void setWorkspaceWidth;
  void isResizing;
  void handleResizeMouseDown;
  void dragStartX;
  void dragStartWidth;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: C.bg,
      overflow: "hidden",
    }}>
      {/* ── Header Bar ── */}
      <HeaderBar
        paperTitle={stream.metadata?.title ?? null}
        phase={stream.phase}
        aiLikely={stream.summary?.ai_likely ?? 0}
        uncertain={stream.summary?.uncertain ?? 0}
        missingCount={
          stream.missingData?.missing_papers?.filter(
            p => p.severity === "critical" || p.severity === "high"
          ).length ?? 0
        }
        reliabilityScore={
          reliabilityData?.summary?.avg_reliability != null
            ? Math.round(reliabilityData.summary.avg_reliability)
            : null
        }
        actionsCount={
          (stream.summary?.ai_likely ?? 0) + (stream.missingData?.total_missing ?? 0)
        }
        onNewUpload={() => setView("history")}
        userName={user?.name ?? null}
      />

      {/* ── Main content row ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Dock */}
        {stream.phase !== "idle" && stream.phase !== "grobid" && (
          <BottomDock
            activeOverlay={activeOverlay}
            onToggle={(id) => setActiveOverlay(prev => prev === id ? null : id)}
            networkLoading={networkLoading}
            biasLoading={biasLoading}
            formatLoading={formatLoading}
            integrityLoading={integrityLoading}
            phase={stream.phase}
          />
        )}

        {/* PDF Viewer */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative", minWidth: 0 }}>
          {pdfUrl ? (
            <PDFViewer
              pdfUrl={pdfUrl}
              onCitationClick={setSelectedCitationId}
              selectedCitationId={selectedCitationId}
              citations={stream.citations}
              alignmentData={alignmentData}
              alignmentLoading={alignmentLoading}
              reproData={reproData}
              reproLoading={reproLoading}
            />
          ) : (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              background: C.bg, color: C.textDim,
              fontFamily: "'DM Sans', 'Segoe UI', sans-serif", gap: 16,
            }}>
              <div style={{ fontSize: 48 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textMuted }}>PDF not stored on server</div>
              <div style={{ fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
                Your analysis is fully loaded from cache.<br />
                Upload the PDF file again to view it here.
              </div>
              <label style={{
                marginTop: 8, padding: "10px 22px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                border: "none", borderRadius: 10,
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Upload PDF
                <input type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              </label>
            </div>
          )}
        </div>

        {/* Context Panel */}
        {stream.phase !== "idle" && (
          <ContextPanel
            citations={stream.citations}
            summary={stream.summary}
            signals={stream.signals}
            totalCitations={stream.totalCitations}
            analyzing={stream.phase === "analyzing" || stream.phase === "missing"}
            selectedCitationId={selectedCitationId}
            onCitationSelect={setSelectedCitationId}
            onBack={() => setSelectedCitationId(null)}
            missingData={stream.missingData}
            missingLoading={stream.missingLoading}
            reliabilityData={reliabilityData}
            reliabilityLoading={reliabilityLoading}
          />
        )}
      </div>

      {/* ── Overlay drawer ── */}
      {activeOverlay && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "stretch", justifyContent: "flex-start",
          }}
          onClick={() => setActiveOverlay(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 420, height: "100%",
              background: C.bg,
              borderRight: `1px solid ${C.border}`,
              borderRadius: "0 16px 16px 0",
              overflow: "auto",
              animation: "slideInLeft 0.22s ease",
              marginLeft: 56,
            }}
          >
            {activeOverlay === "network" && (
              <CitationNetworkTab data={networkData} loading={networkLoading} />
            )}
            {activeOverlay === "bias" && (
              <CitationBiasTab data={biasData} loading={biasLoading} />
            )}
            {activeOverlay === "quality" && (
              <QualityTab data={formatData} loading={formatLoading} />
            )}
            {activeOverlay === "integrity" && (
              <IntegrityTab data={integrityData} loading={integrityLoading} />
            )}
            {activeOverlay === "chat" && (
              <ChatPanel pdfHash={pdfHash} paperTitle={stream.metadata?.title ?? ""} user={user} />
            )}
            {activeOverlay === "draft" && (
              <DraftPanel pdfHash={pdfHash} paperTitle={stream.metadata?.title ?? ""} user={user} />
            )}
            {activeOverlay === "actions" && (
              <div style={{
                padding: 32, textAlign: "center",
                color: C.textDim, fontSize: 14,
              }}>
                Actions coming soon
              </div>
            )}
            {activeOverlay === "workspace" && (
              <ReviewWorkspace
                onClose={() => setActiveOverlay(null)}
                limitationsData={limitationsData}
                limitationsLoading={limitationsLoading}
                statsData={statsData}
                statsLoading={statsLoading}
                reviewData={reviewData}
                reviewLoading={reviewLoading}
                onGenerateReview={() => { if (currentFile) fetchReview(currentFile); }}
                paperTitle={stream.metadata?.title}
              />
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
