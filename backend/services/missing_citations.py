"""
Missing Citations Pipeline
==========================
1. Receive uncited claims from claim_detector
2. For each claim, search Semantic Scholar for supporting papers
3. Score candidates by semantic similarity (sentence-transformers)
4. Enrich top candidates with GPT-4 to build MissingPaper entries

Returns a MissingCitationsData dict matching the frontend schema:
{
  "claims": [{ "section", "text", "suggestions": [...] }],
  "missing_papers": [{ "title", "authors", "year", "venue", "citation_count",
                       "reason", "section", "severity", "category", "doi" }],
  "total_claims": int,
  "total_missing": int,
}
"""

import os
import json
import requests
import numpy as np
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SS_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
SS_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")

_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        except ImportError:
            _embedder = None
    return _embedder


# ── Semantic Scholar search ───────────────────────────────────────────────────

def _search_ss(query: str, limit: int = 5) -> list[dict]:
    headers = {}
    if SS_API_KEY:
        headers["x-api-key"] = SS_API_KEY
    try:
        r = requests.get(
            SS_SEARCH_URL,
            params={
                "query": query,
                "fields": "title,year,abstract,citationCount,authors,venue,externalIds",
                "limit": limit,
            },
            headers=headers,
            timeout=(5, 10),
        )
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception as e:
        print(f"SS search error: {e}")
    return []


def _get_recommendations(paper_ids: list[str], limit: int = 10) -> list[dict]:
    """
    Use Semantic Scholar recommendations endpoint.
    Give it papers we ARE citing → get back related ones we might be missing.
    """
    if not paper_ids:
        return []
    try:
        r = requests.post(
            "https://api.semanticscholar.org/recommendations/v1/papers/",
            json={
                "positivePaperIds": paper_ids[:5],  # max 5 seed papers
            },
            params={
                "fields": "title,year,abstract,citationCount,authors,venue,externalIds",
                "limit": limit,
            },
            headers={"x-api-key": SS_API_KEY} if SS_API_KEY else {},
            timeout=(5, 15),
        )
        if r.status_code == 200:
            return r.json().get("recommendedPapers", [])
    except Exception as e:
        print(f"SS recommendations error: {e}")
    return []


def _get_paper_ids_from_citations(existing_citations: list[dict]) -> list[str]:
    """
    Look up Semantic Scholar paper IDs for existing citations.
    Tries DOI first; falls back to title search for citations without a DOI.
    Returns list of SS paper IDs to use as recommendation seeds.
    """
    headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}
    ids = []
    seen: set[str] = set()

    for c in existing_citations[:20]:  # scan more citations to get enough seeds
        if len(ids) >= 10:
            break
        doi = c.get("doi")
        title = (c.get("title") or "").strip()

        try:
            pid = None
            if doi:
                r = requests.get(
                    f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}",
                    params={"fields": "paperId"},
                    headers=headers,
                    timeout=(3, 8),
                )
                if r.status_code == 200:
                    pid = r.json().get("paperId")
            if not pid and title:
                r = requests.get(
                    SS_SEARCH_URL,
                    params={"query": title, "fields": "paperId,title", "limit": 1},
                    headers=headers,
                    timeout=(3, 8),
                )
                if r.status_code == 200:
                    data = r.json().get("data", [])
                    if data:
                        pid = data[0].get("paperId")
            if pid and pid not in seen:
                seen.add(pid)
                ids.append(pid)
        except Exception:
            continue
    return ids


# ── Junk paper filter ────────────────────────────────────────────────────────

_JUNK_TITLE_PATTERNS = [
    "subject and author index",
    "author index",
    "subject index",
    "index to vol",
    "indexes to vol",
    "table of contents",
    "editorial board",
    "list of reviewers",
    "acknowledgement of reviewers",
    "book review",
    "erratum",
    "corrigendum",
    "retraction",
    "annual index",
    "volume index",
    "cumulative index",
]


def _is_junk_paper(paper: dict) -> bool:
    """Return True if this paper looks like an index, errata, or non-research item."""
    title = (paper.get("title") or "").lower().strip()
    if not title:
        return True
    for pat in _JUNK_TITLE_PATTERNS:
        if pat in title:
            return True
    # No abstract + very low citation count = likely not a real paper
    if not paper.get("abstract") and (paper.get("citationCount") or 0) < 5:
        return True
    return False


# ── Semantic similarity ───────────────────────────────────────────────────────

def _cosine(a, b) -> float:
    a, b = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom else 0.0


def _score_papers(claim: str, papers: list[dict]) -> list[tuple[dict, float]]:
    embedder = _get_embedder()
    if not embedder or not papers:
        return [(p, 0.5) for p in papers]
    texts = [claim] + [p.get("abstract") or p.get("title") or "" for p in papers]
    vecs = embedder.encode(texts, show_progress_bar=False).tolist()
    scored = [(p, _cosine(vecs[0], vecs[i + 1])) for i, p in enumerate(papers)]
    return sorted(scored, key=lambda x: x[1], reverse=True)


# ── GPT-4 enrichment for MissingPaper entries ────────────────────────────────

_MISSING_PAPER_SYSTEM = """You are an academic citation advisor.
Given a claim from a paper and a candidate paper, return JSON:
{
  "reason": "<1-2 sentences why this paper is relevant and should be cited>",
  "severity": <"critical"|"high"|"medium">,
  "category": <"foundational"|"competitor"|"methodological"|"dataset"|"survey">
}
- critical: essential foundational work or direct competitor that MUST be cited
- high: strongly relevant, should be cited
- medium: related, worth considering"""


def _enrich_missing_paper(claim: str, paper: dict) -> dict:
    title = paper.get("title", "")
    abstract = (paper.get("abstract") or "")[:400]
    prompt = f'Claim: "{claim}"\n\nCandidate: Title: {title}\nAbstract: {abstract}'
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _MISSING_PAPER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            timeout=20,
        )
        return json.loads(resp.choices[0].message.content or "{}")
    except Exception:
        return {"reason": "", "severity": "medium", "category": "methodological"}


# ── Public API ────────────────────────────────────────────────────────────────

def find_missing_citations(
    uncited_claims: list[dict],
    existing_titles: set[str],
    existing_citations: list[dict] = [],
    current_paper_title: str = "",
) -> dict:
    """
    Main pipeline.

    Args:
        uncited_claims: output of claim_detector.detect_uncited_claims()
                        Each item: { section, sentence, claim_type, suggested_query }
        existing_titles: set of already-cited paper titles (lowercase, for dedup)
        existing_citations: list of citation dicts with optional "doi" fields,
                            used to seed the SS recommendations endpoint

    Returns dict matching MissingCitationsData frontend interface.
    """
    def _is_self(title: str) -> bool:
        if not current_paper_title or not title:
            return False
        t1, t2 = title.lower().strip(), current_paper_title.lower().strip()
        return t1 in t2 or t2 in t1 or t1[:60] == t2[:60]

    claims_out: list[dict] = []
    all_missing: dict[str, dict] = {}  # title_key -> MissingPaper dict

    # Get recommendations based on papers already cited
    paper_ids = _get_paper_ids_from_citations(existing_citations)
    recommended = _get_recommendations(paper_ids)

    # Add recommended papers to missing if not already cited
    for paper in recommended:
        if _is_junk_paper(paper):
            continue
        title = (paper.get("title") or "").strip()
        if not title:
            continue
        already = any(
            title.lower() in t.lower() or t.lower() in title.lower()
            for t in existing_titles if t
        )
        if not already and not _is_self(title):
            key = title.lower()[:80]
            if key not in all_missing:
                enrichment = _enrich_missing_paper("Related to your cited papers", paper)
                doi = (paper.get("externalIds") or {}).get("DOI")
                all_missing[key] = {
                    "title": title,
                    "authors": [a.get("name", "") for a in paper.get("authors", [])],
                    "year": paper.get("year"),
                    "venue": paper.get("venue") or "",
                    "citation_count": paper.get("citationCount") or 0,
                    "reason": enrichment.get("reason", "Recommended based on your existing citations"),
                    "section": "Related Work",
                    "severity": enrichment.get("severity", "medium"),
                    "category": enrichment.get("category", "methodological"),
                    "doi": doi,
                    "_sim": 0.5,
                }

    for claim_obj in uncited_claims[:15]:
        query = claim_obj.get("suggested_query") or claim_obj.get("sentence", "")[:120]
        section = claim_obj.get("section", "Unknown")
        sentence = claim_obj.get("sentence", "")

        raw_papers = _search_ss(query, limit=6)
        scored = _score_papers(sentence, raw_papers)

        suggestions: list[dict] = []
        for paper, sim in scored[:5]:
            if _is_junk_paper(paper):
                continue
            title = (paper.get("title") or "").strip()
            if not title:
                continue

            authors = [a.get("name", "") for a in paper.get("authors", [])]
            doi = (paper.get("externalIds") or {}).get("DOI")
            venue = paper.get("venue") or ""
            year = paper.get("year")
            citation_count = paper.get("citationCount") or 0

            # Check if already in refs
            already = any(
                title.lower() in t.lower() or t.lower() in title.lower()
                for t in existing_titles if t
            )
            citation_id = None  # we don't track back to ref id here

            suggestions.append({
                "title": title,
                "authors": authors,
                "year": year,
                "venue": venue,
                "citation_count": citation_count,
                "already_in_refs": already,
                "citation_id": citation_id,
                "similarity": round(sim, 3),
                "doi": doi,
            })

            # Candidate for the missing_papers list if not already cited
            if not already and not _is_self(title):
                key = title.lower()[:80]
                if key not in all_missing:
                    enrichment = _enrich_missing_paper(sentence, paper)
                    all_missing[key] = {
                        "title": title,
                        "authors": authors,
                        "year": year,
                        "venue": venue,
                        "citation_count": citation_count,
                        "reason": enrichment.get("reason", ""),
                        "section": section,
                        "severity": enrichment.get("severity", "medium"),
                        "category": enrichment.get("category", "methodological"),
                        "doi": doi,
                        "_sim": sim,  # for sorting, stripped before output
                    }

        claims_out.append({
            "section": section,
            "text": sentence,
            "suggestions": suggestions,
        })

    # Sort missing papers: critical first, then by similarity
    severity_order = {"critical": 0, "high": 1, "medium": 2}
    missing_papers = sorted(
        all_missing.values(),
        key=lambda p: (severity_order.get(p["severity"], 3), -p.get("_sim", 0)),
    )[:20]

    # Strip internal sort key
    for p in missing_papers:
        p.pop("_sim", None)

    return {
        "claims": claims_out,
        "missing_papers": missing_papers,
        "total_claims": len(claims_out),
        "total_missing": len(missing_papers),
    }
