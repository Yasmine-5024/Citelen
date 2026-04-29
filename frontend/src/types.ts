export interface Citation {
  id: string;
  num: number;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  venue: string;
}

export interface AIResult {
  id: string;
  title: string;
  source: string;
  aiScore: number;
  flags: string[];
  status: "ai_likely" | "uncertain" | "human";
  doi: string | null;
  year: number | null;
  reasoning?: string;
  agent_analyzed?: boolean;
  found_in?: string[];
  discovered_doi?: string | null;
  citation_count?: number;
  duplicate_of?: string | null;
}

export interface AnalysisData {
  metadata: { title: string; authors: string[] };
  total_citations: number;
  ai_detection: {
    citations: AIResult[];
    signals: { signal: string; count: number }[];
    summary: {
      ai_likely: number;
      uncertain: number;
      human: number;
      ai_rate: number;
    };
  };
}

// Aliases used by the new Sidebar
export type CitationResult = AIResult & { contexts?: string[] };
export interface Metadata { title: string; authors: string[] }
export interface Summary { ai_likely: number; uncertain: number; human: number; ai_rate: number }
export interface Signal { signal: string; count: number }

// Missing Citations feature
export interface ClaimSuggestion {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  citation_count: number;
  already_in_refs: boolean;
  citation_id: string | null;
  similarity: number;
  doi: string | null;
}

export interface UncitedClaim {
  section: string;
  text: string;
  suggestions: ClaimSuggestion[];
}

export interface MissingPaper {
  title: string;
  authors: any[];
  year: number | null;
  venue: string;
  citation_count: number;
  reason: string;
  section: string;
  severity: "critical" | "high" | "medium";
  category: "foundational" | "competitor" | "methodological" | "dataset" | "survey";
  doi: string | null;
}

export interface MissingCitationsData {
  claims: UncitedClaim[];
  missing_papers: MissingPaper[];
  total_claims: number;
  total_missing: number;
}

// Limitations Section Analyzer
export interface StatedLimitation {
  text: string;
  category: "scope" | "methodology" | "data" | "generalizability" | "other";
}

export interface ImplicitWeakness {
  text: string;
  source_section: string;
  severity: "high" | "medium" | "low";
  covered: boolean;
}

export interface LimitationsData {
  has_section: boolean;
  section_name: string | null;
  stated_limitations: StatedLimitation[];
  implicit_weaknesses: ImplicitWeakness[];
  undisclosed: ImplicitWeakness[];
  score: number;
}

// Statistical Reporting Validator
export interface StatIssue {
  sentence: string;
  issue_type: "missing_ci" | "missing_effect_size" | "missing_n" | "bare_p_value" | "informal_significance" | "missing_test_stat";
  severity: "high" | "medium" | "low";
  suggestion: string;
  section: string;
}

export interface StatsData {
  issues: StatIssue[];
  total_stats_found: number;
  properly_reported: number;
  score: number;
  summary: string;
}

// Review Template
export interface ReviewTemplateData {
  paper_summary: string;
  strengths: string[];
  weaknesses: string[];
  questions: string[];
  recommendation: "accept" | "minor_revision" | "major_revision" | "reject";
  recommendation_note: string;
}

// Reliability feature — matches ReliabilityTab.tsx's expected shape
export interface ReliabilityCitation {
  id: string;
  title: string;
  venue: string;
  year: string;
  relevance: number | null;
  verdict: string;           // strong | moderate | weak | unsupported | no_data
  flags: string[];
  claim: string;
  warning: string | null;
  abstractFound?: boolean;
  citationCount?: number;
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
