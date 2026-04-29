"""
Citation Reliability Scoring
=============================
Scores each reference on two axes:

  reliability  – how trustworthy/credible the publication is
  relevance    – how well the paper actually supports the claim(s) it is cited for

Reliability sub-scores (all 0-100, higher = better):
  • venue_score     – journal/conference tier proxy (citation-count + retraction check)
  • freshness_score – how recent the paper is relative to the citing paper
  • self_cite_score – penalised if authored by one of the paper's own authors
  • doi_score       – does the DOI resolve?

Relevance sub-score:
  • claim_integrity – GPT-4o-mini rates how well the abstract supports in-text use

Final composite:
  reliability_score = 0.4*venue + 0.3*freshness + 0.2*doi + 0.1*self_cite
  relevance_score   = claim_integrity
  overall           = 0.6*reliability + 0.4*relevance
"""

from __future__ import annotations

import os
import json
import re
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SS_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
SS_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")

OPENALEX_SEARCH_URL = "https://api.openalex.org/works"
CROSSREF_URL = "https://api.crossref.org/works"

# Known predatory / low-quality publisher keywords (very lightweight list)
_PREDATORY_KEYWORDS = [
    "iiste", "omics", "wseas", "scirp", "academic journals",
    "journal of emerging", "international journal of advanced",
    "global journal of", "world journal of", "american journal of",
    "asian journal of", "european journal of science",
]

# Rough top-tier venue keywords for a small boost
_TIER1_KEYWORDS = [
    "nature", "science", "cell", "lancet", "nejm", "new england journal",
    "ieee transactions", "acm transactions", "jmlr", "nips", "neurips",
    "icml", "iclr", "cvpr", "aaai", "emnlp", "acl", "chi", "uist",
    "vldb", "sigmod", "sosp", "osdi", "pldi", "sigcomm",
]


# ── Semantic Scholar helpers ───────────────────────────────────────────────────

def _ss_lookup(title: str) -> dict | None:
    """Search Semantic Scholar for a paper by title; return first hit or None."""
    if not title:
        return None
    # Strip XML/HTML tags that GROBID sometimes leaves in titles (e.g. <scp>...</scp>)
    title = re.sub(r"<[^>]+>", "", title).strip()
    if not title:
        return None
    headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}
    try:
        r = requests.get(
            SS_SEARCH_URL,
            params={
                "query": title[:120],
                "fields": "title,year,abstract,citationCount,venue",
                "limit": 1,
            },
            headers=headers,
            timeout=(4, 8),
        )
        print(f"[SS] status={r.status_code} for '{title[:50]}'")
        if r.status_code == 200:
            data = r.json().get("data", [])
            if data:
                hit = data[0]
                hit_title = (hit.get("title") or "").lower().strip()
                query_title = title.lower().strip()
                q_words = set(query_title.split())
                h_words = set(hit_title.split())
                overlap = len(q_words & h_words) / max(len(q_words), 1)
                has_abstract = bool(hit.get("abstract"))
                print(f"[SS] results={len(data)}  abstract={'YES' if has_abstract else 'NO'}  overlap={overlap:.2f}")
                if overlap >= 0.5:
                    return hit
                else:
                    print(f"[SS] title mismatch — skipping '{hit_title[:50]}'")
        else:
            print(f"[SS] error body: {r.text[:200]}")
    except Exception as e:
        print(f"[reliability] SS lookup error: {e}")
    return None


def _doi_resolves(doi: str | None) -> bool:
    """Quick HEAD request to doi.org to check whether the DOI resolves."""
    if not doi:
        return False
    try:
        r = requests.head(
            f"https://doi.org/{doi.strip()}",
            allow_redirects=True,
            timeout=(3, 6),
        )
        return r.status_code < 400
    except Exception:
        return False


# ── Multi-source abstract fetching ────────────────────────────────────────────

def _decode_inverted_index(inv_index: dict) -> str:
    """
    Reconstruct an abstract from OpenAlex's inverted-index format.
    Format: {"word": [position, ...], ...}  (positions are 0-based)
    """
    if not inv_index:
        return ""
    pairs: list[tuple[int, str]] = []
    for word, positions in inv_index.items():
        for pos in positions:
            pairs.append((pos, word))
    pairs.sort()
    return " ".join(w for _, w in pairs)


def _fetch_from_openalex(title: str, doi: str | None) -> str | None:
    """
    Query OpenAlex for a paper's abstract.
    Tries DOI lookup first (exact), then title search.
    Returns abstract string or None.
    """
    headers = {"User-Agent": "reflens/1.0 (mailto:research@reflens.app)"}
    try:
        # 1. DOI lookup (fast, exact)
        if doi:
            r = requests.get(
                f"{OPENALEX_SEARCH_URL}/https://doi.org/{doi.strip()}",
                headers=headers,
                timeout=(4, 8),
            )
            if r.status_code == 200:
                work = r.json()
                inv = work.get("abstract_inverted_index")
                if inv:
                    abstract = _decode_inverted_index(inv)
                    if abstract:
                        print(f"[OA] abstract via DOI for '{title[:40]}'")
                        return abstract

        # 2. Title search — verify the returned title actually matches
        r = requests.get(
            OPENALEX_SEARCH_URL,
            params={
                "search": title[:120],
                "select": "abstract_inverted_index,title",
                "per-page": 1,
            },
            headers=headers,
            timeout=(4, 8),
        )
        if r.status_code == 200:
            results = r.json().get("results", [])
            if results:
                hit = results[0]
                hit_title = (hit.get("title") or "").lower().strip()
                query_title = title.lower().strip()
                # Require at least 50% word overlap to avoid wrong-paper matches
                q_words = set(query_title.split())
                h_words = set(hit_title.split())
                overlap = len(q_words & h_words) / max(len(q_words), 1)
                if overlap >= 0.5:
                    inv = hit.get("abstract_inverted_index")
                    if inv:
                        abstract = _decode_inverted_index(inv)
                        if abstract:
                            print(f"[OA] abstract via search for '{title[:40]}' (overlap={overlap:.2f})")
                            return abstract
                else:
                    print(f"[OA] title mismatch — skipping '{hit_title[:50]}' for query '{title[:40]}' (overlap={overlap:.2f})")
    except Exception as e:
        print(f"[reliability] OpenAlex error: {e}")
    return None


def _fetch_from_crossref(doi: str | None) -> str | None:
    """
    Query CrossRef for a paper's abstract via DOI.
    Strips JATS XML tags (e.g. <jats:p>).
    Returns abstract string or None.
    """
    if not doi:
        return None
    try:
        r = requests.get(
            f"{CROSSREF_URL}/{doi.strip()}",
            params={"mailto": "research@reflens.app"},
            timeout=(4, 8),
        )
        if r.status_code == 200:
            abstract = r.json().get("message", {}).get("abstract", "")
            if abstract:
                # Strip JATS XML tags
                abstract = re.sub(r"<[^>]+>", "", abstract).strip()
                if abstract:
                    print(f"[CR] abstract via DOI '{doi[:40]}'")
                    return abstract
    except Exception as e:
        print(f"[reliability] CrossRef error: {e}")
    return None


def _fetch_from_doi_scrape(doi: str | None) -> str | None:
    """
    Follow doi.org redirect and scrape common abstract meta tags from the landing page.
    Tries: og:description → meta[name=description] → schema.org JSON-LD → DC.description.
    Only accepts text longer than 60 characters to avoid useless snippets.
    """
    if not doi:
        return None
    try:
        r = requests.get(
            f"https://doi.org/{doi.strip()}",
            headers={"User-Agent": "Mozilla/5.0 (compatible; reflens/1.0)"},
            allow_redirects=True,
            timeout=(5, 10),
        )
        if r.status_code >= 400:
            return None
        soup = BeautifulSoup(r.text, "lxml")

        def _check(text: str | None) -> str | None:
            if text and len(text.strip()) > 60:
                return text.strip()
            return None

        # 1. og:description
        tag = soup.find("meta", property="og:description")
        if tag:
            result = _check(tag.get("content"))
            if result:
                print(f"[DOI-scrape] abstract via og:description for '{doi[:40]}'")
                return result

        # 2. meta[name="description"]
        tag = soup.find("meta", attrs={"name": "description"})
        if tag:
            result = _check(tag.get("content"))
            if result:
                print(f"[DOI-scrape] abstract via meta[name=description] for '{doi[:40]}'")
                return result

        # 3. schema.org JSON-LD
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                ld = json.loads(script.string or "")
                if isinstance(ld, list):
                    ld = ld[0]
                desc = ld.get("description") or ld.get("abstract")
                result = _check(desc)
                if result:
                    print(f"[DOI-scrape] abstract via JSON-LD for '{doi[:40]}'")
                    return result
            except Exception:
                pass

        # 4. DC.description
        tag = soup.find("meta", attrs={"name": "DC.description"})
        if tag:
            result = _check(tag.get("content"))
            if result:
                print(f"[DOI-scrape] abstract via DC.description for '{doi[:40]}'")
                return result

    except Exception as e:
        print(f"[reliability] DOI-scrape error: {e}")
    return None


def _fetch_from_europepmc(title: str, doi: str | None) -> str | None:
    """
    Query Europe PMC for a paper's abstract.
    Uses DOI query if available, otherwise title search with 50% word-overlap validation.
    """
    try:
        if doi:
            query = f"DOI:{doi.strip()}"
        else:
            query = f'TITLE:"{title[:120]}"'
        r = requests.get(
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
            params={"query": query, "format": "json", "resulttype": "core", "pageSize": 1},
            timeout=(4, 8),
        )
        if r.status_code != 200:
            return None
        results = r.json().get("resultList", {}).get("result", [])
        if not results:
            return None
        hit = results[0]
        abstract = hit.get("abstractText", "")
        if not abstract:
            return None
        # Validate title overlap when using title search
        if not doi:
            hit_title = (hit.get("title") or "").lower().strip()
            q_words = set(title.lower().split())
            h_words = set(hit_title.split())
            overlap = len(q_words & h_words) / max(len(q_words), 1)
            if overlap < 0.5:
                print(f"[EuropePMC] title mismatch — skipping '{hit_title[:50]}' (overlap={overlap:.2f})")
                return None
        print(f"[EuropePMC] abstract found for '{title[:40]}'")
        return abstract
    except Exception as e:
        print(f"[reliability] EuropePMC error: {e}")
    return None


def _fetch_from_arxiv(title: str) -> str | None:
    """
    Query arXiv API by title and return the abstract of the first matching entry.
    Validates 50% word overlap before returning.
    """
    if not title:
        return None
    try:
        r = requests.get(
            "http://export.arxiv.org/api/query",
            params={"search_query": f"ti:{title[:120]}", "max_results": 1},
            timeout=(5, 10),
        )
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, "lxml-xml")
        entry = soup.find("entry")
        if not entry:
            return None
        summary_tag = entry.find("summary")
        arxiv_title_tag = entry.find("title")
        if not summary_tag:
            return None
        # Validate title overlap
        if arxiv_title_tag:
            hit_title = arxiv_title_tag.get_text().lower().strip()
            q_words = set(title.lower().split())
            h_words = set(hit_title.split())
            overlap = len(q_words & h_words) / max(len(q_words), 1)
            if overlap < 0.5:
                print(f"[arXiv] title mismatch — skipping '{hit_title[:50]}' (overlap={overlap:.2f})")
                return None
        abstract = summary_tag.get_text().strip()
        if abstract:
            print(f"[arXiv] abstract found for '{title[:40]}'")
            return abstract
    except Exception as e:
        print(f"[reliability] arXiv error: {e}")
    return None


def _fetch_abstract(title: str, doi: str | None, ss_paper: dict | None) -> str | None:
    """
    Fetch abstract using a multi-source chain:
      1. Semantic Scholar (already fetched — reuse ss_paper)
      2. OpenAlex (covers ~85% of academic papers)
      3. CrossRef (DOI-based, good journal coverage)
      4. DOI scrape (landing page meta tags)
      5. Europe PMC (biomedical + preprints)
      6. arXiv (CS / physics / math preprints)
    Returns the first non-empty abstract found, or None.
    """
    # 1. SS (already fetched)
    if ss_paper:
        abstract = ss_paper.get("abstract")
        if abstract:
            return abstract

    # 2. OpenAlex
    abstract = _fetch_from_openalex(title, doi)
    if abstract:
        return abstract

    # 3. CrossRef
    abstract = _fetch_from_crossref(doi)
    if abstract:
        return abstract

    # 4. DOI scrape
    abstract = _fetch_from_doi_scrape(doi)
    if abstract:
        return abstract

    # 5. Europe PMC
    abstract = _fetch_from_europepmc(title, doi)
    if abstract:
        return abstract

    # 6. arXiv
    abstract = _fetch_from_arxiv(title)
    if abstract:
        return abstract

    return None


# ── Sub-scorers ───────────────────────────────────────────────────────────────

def _score_venue(venue: str, ss_paper: dict | None) -> int:
    """Return 0-100 venue quality score."""
    score = 50  # neutral baseline

    if ss_paper:
        # Boost by citation count (log-ish scale)
        cc = ss_paper.get("citationCount") or 0
        if cc >= 1000:
            score += 30
        elif cc >= 100:
            score += 20
        elif cc >= 10:
            score += 10
        elif cc == 0:
            score -= 15

    venue_lower = (venue or "").lower()

    if any(kw in venue_lower for kw in _PREDATORY_KEYWORDS):
        score -= 30

    if any(kw in venue_lower for kw in _TIER1_KEYWORDS):
        score += 20

    return max(0, min(100, score))


def _freshness_score(ref_year: int | None, paper_year: int | None) -> int:
    """
    Score 0-100 for how fresh the citation is.
    Papers ≤5 years old score highest; very old papers (>30 yrs) score lowest
    unless they are likely foundational (reflected in high citation count — handled
    by caller merging the scores).
    """
    if not ref_year:
        return 40  # unknown — mild penalty

    anchor = paper_year or 2024
    age = anchor - ref_year

    if age <= 2:
        return 100
    elif age <= 5:
        return 85
    elif age <= 10:
        return 70
    elif age <= 20:
        return 50
    elif age <= 30:
        return 35
    else:
        return 20


def _is_predatory(venue: str) -> bool:
    venue_lower = (venue or "").lower()
    return any(kw in venue_lower for kw in _PREDATORY_KEYWORDS)


def _self_cite_score(ref_authors: list[str], paper_authors: list[str]) -> int:
    """
    Return 0 (strong self-citation) to 100 (no overlap).
    Checks last-name overlap between the reference's authors and the paper's authors.
    """
    if not ref_authors or not paper_authors:
        return 100  # can't tell — no penalty

    def _last(name: str) -> str:
        return name.strip().split()[-1].lower() if name.strip() else ""

    paper_lasts = {_last(a) for a in paper_authors if a}
    ref_lasts = {_last(a) for a in ref_authors if a}

    overlap = paper_lasts & ref_lasts
    if not overlap:
        return 100  # no self-citation

    ratio = len(overlap) / max(len(ref_lasts), 1)
    if ratio >= 0.5:
        return 20   # majority overlap → heavy self-cite
    return 60       # partial overlap → mild penalty


# ── GPT claim-integrity scorer ────────────────────────────────────────────────

_INTEGRITY_SYSTEM = """You are an academic citation integrity checker.

Given:
1. CLAIM: the EXACT sentence(s) in the source paper where the reference is cited — PRIMARY FOCUS
2. CITED PAPER: the abstract of the paper being cited
3. SOURCE PAPER CONTEXT: title + abstract of the citing paper — use to understand the research domain and appreciate why this citation makes sense, but do NOT use to penalise citations that are "off-topic" relative to the paper's main contribution

Your ONLY job:
- Does the cited paper justify or support the specific CLAIM sentence?
- Use the SOURCE PAPER CONTEXT to understand the domain and methods used — a citation that is standard practice in that domain should be scored favourably even if the source paper's abstract doesn't mention it explicitly.

CRITICAL RULES (apply in priority order):
1. If the CLAIM uses a named scale, questionnaire, or tool (e.g. SUS, NASA-TLX, TAM, UTAUT, Likert, thematic analysis, grounded theory) AND the cited paper introduces, defines, or is the canonical reference for that tool/method → score 85-100, verdict "strong", category "Methodological"
2. If the CLAIM says "we used / we applied / we followed / we conducted [method]" and the cited paper is a well-known reference for that method → score 80-100
3. If the SOURCE PAPER is in a domain (HCI, UX, medicine, psychology, etc.) where this kind of citation is standard practice → lean towards "Methodological" or "Background" rather than "unsupported"
4. If the CLAIM is a background/related-work statement and the cited paper is on that topic → score 70-85
5. If the CLAIM makes a factual assertion and the cited paper provides evidence → score 80-100
6. If the cited paper is completely unrelated to the specific claim sentence → score 0-39
7. DO NOT penalise a citation just because its topic differs from the source paper's main contribution

Reply ONLY with valid JSON (no markdown):
{
  "score": <int 0-100>,
  "verdict": <"strong"|"moderate"|"weak"|"unsupported">,
  "note": "<one sentence explanation focused on the claim sentence>",
  "category": <"Directly Relevant"|"Methodological"|"Background"|"Baseline"|"Inspiration"|"Gap Identification"|"Example">
}

score 80-100 = cited paper clearly supports or is the standard reference for the claim
score 60-79  = cited paper is related to the claim, partial support
score 40-59  = tangentially related to the claim
score 0-39   = cited paper does not support the specific claim sentence

category definitions:
- "Directly Relevant"  : central to the paper's contribution or main claims
- "Methodological"     : cited paper introduces or describes a method/tool/scale used in the claim
- "Background"         : cited to provide general context or motivation
- "Baseline"           : used as a benchmark or comparison system
- "Inspiration"        : motivated the approach but not directly used
- "Gap Identification" : cited to identify what is missing or unsolved
- "Example"            : cited as a concrete instance or use case"""


def _score_claim_integrity(
    contexts: list[str],
    cited_abstract: str | None,
    source_title: str = "",
    source_abstract: str = "",
) -> dict:
    """
    Use GPT-4o-mini to score how well `cited_abstract` supports the in-text use(s),
    given the context of what the source paper is about.
    Returns {"score": int, "verdict": str, "note": str}.
    """
    print(f"[integrity] contexts={len(contexts)}  abstract={'YES' if cited_abstract else 'NO'}")
    for i, ctx in enumerate(contexts[:3]):
        print(f"  [ctx {i+1}] {ctx[:150]!r}")
    if not cited_abstract:
        return {"score": None, "verdict": "no_data", "note": "No abstract found — claim support cannot be assessed.", "category": "Unknown"}
    if not contexts:
        return {"score": None, "verdict": "no_data", "note": "No abstract found — claim support cannot be assessed.", "category": "Unknown"}

    # Use ALL contexts, capped at 2000 chars total so GPT sees full picture
    MAX_CONTEXT_CHARS = 2000
    ctx_parts: list[str] = []
    used = 0
    for c in contexts:
        snippet = c[:400]
        if used + len(snippet) > MAX_CONTEXT_CHARS:
            snippet = c[:MAX_CONTEXT_CHARS - used]
            if snippet:
                ctx_parts.append(snippet)
            break
        ctx_parts.append(snippet)
        used += len(snippet)
    context_str = " | ".join(ctx_parts)

    prompt = (
        f'CLAIM (sentence(s) where this citation appears — PRIMARY FOCUS):\n"{context_str}"\n\n'
        f'CITED PAPER ABSTRACT:\n"{cited_abstract[:800]}"\n\n'
        f'SOURCE PAPER CONTEXT (use to understand research domain and methods — helps judge if this is standard practice):\n'
        f'Title: "{source_title[:150]}"\n'
        f'Abstract: "{source_abstract[:600]}"'
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _INTEGRITY_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            timeout=20,
        )
        result = json.loads(resp.choices[0].message.content or "{}")
        result.setdefault("category", "Unknown")
        print(f"  [integrity result] score={result.get('score')}  verdict={result.get('verdict')}  category={result.get('category')}  note={result.get('note','')[:80]!r}")
        return result
    except Exception as e:
        print(f"[reliability] GPT integrity error: {e}")
        return {"score": None, "verdict": "no_data", "note": "No abstract found — claim support cannot be assessed.", "category": "Unknown"}


# ── Warning builder ───────────────────────────────────────────────────────────

def _build_warnings(
    doi_ok: bool,
    venue: str,
    ss_paper: dict | None,
    self_score: int,
    integrity: dict,
    freshness: int,
) -> list[str]:
    warnings: list[str] = []

    if not doi_ok:
        warnings.append("DOI does not resolve — may be fabricated or incorrect.")

    if _is_predatory(venue):
        warnings.append("Venue matches known predatory/low-quality publisher patterns.")

    if self_score < 50:
        overlap_label = "heavy" if self_score <= 20 else "partial"
        warnings.append(f"Potential self-citation ({overlap_label} author overlap).")

    verdict = integrity.get("verdict")
    if verdict == "unsupported":
        warnings.append("Abstract does not appear to support the in-text claim.")
    elif verdict == "weak":
        warnings.append("Abstract only weakly supports the in-text claim.")
    # "no_data" verdict intentionally produces no warning

    if freshness <= 20:
        warnings.append("Citation is over 30 years old — check if foundational or outdated.")

    return warnings


# ── Public API ────────────────────────────────────────────────────────────────

def score_reference(
    citation: dict,
    contexts: list[str],
    paper_authors: list[str],
    paper_year: int | None = None,
    source_title: str = "",
    source_abstract: str = "",
) -> dict:
    """
    Score a single reference for reliability and relevance.

    Args:
        citation:     dict from grobid.parse_citation() — keys: id, num, title, authors,
                      year, doi, venue
        contexts:     list of in-text usage strings from in_text_map
        paper_authors: author list of the *citing* paper (for self-cite detection)
        paper_year:   publication year of the citing paper (for freshness)

    Returns a dict suitable for direct JSON serialisation to the frontend.
    """
    title = citation.get("title") or ""
    doi = citation.get("doi")
    venue = citation.get("venue") or ""
    ref_year = citation.get("year")
    ref_authors = citation.get("authors") or []

    # ── External lookups ─────────────────────────────────────────────────────
    ss_paper = _ss_lookup(title)
    abstract = _fetch_abstract(title, doi, ss_paper)
    doi_ok = _doi_resolves(doi)

    # ── Sub-scores ───────────────────────────────────────────────────────────
    venue_score = _score_venue(venue, ss_paper)
    freshness = _freshness_score(ref_year, paper_year)
    self_score = _self_cite_score(ref_authors, paper_authors)
    doi_score = 100 if doi_ok else (40 if not doi else 10)

    # GPT claim-integrity (most expensive — last)
    integrity = _score_claim_integrity(
        contexts,
        abstract,
        source_title=source_title,
        source_abstract=source_abstract,
    )
    claim_score = integrity.get("score")  # now None | int

    # ── Composite scores ─────────────────────────────────────────────────────
    reliability = round(
        0.40 * venue_score
        + 0.30 * freshness
        + 0.20 * doi_score
        + 0.10 * self_score
    )
    relevance = claim_score
    if relevance is not None:
        overall = round(0.60 * reliability + 0.40 * relevance)
    else:
        overall = reliability  # reliability-only when abstract missing

    warnings = _build_warnings(doi_ok, venue, ss_paper, self_score, integrity, freshness)

    result = {
        "id": citation["id"],
        "num": citation.get("num"),
        "title": title,
        "authors": ref_authors,
        "year": ref_year,
        "venue": venue,
        "doi": doi,
        # scores (named to match frontend ReliabilityCitation interface)
        "overall_score": overall,
        "reliability": reliability,
        "relevance": relevance,
        # sub-scores
        "venue_score": venue_score,
        "freshness_score": freshness,
        "doi_score": doi_score,
        "self_cite_score": self_score,
        "claim_integrity": integrity,
        # meta
        "citation_count": (ss_paper or {}).get("citationCount"),
        "warnings": warnings,
        "abstract_found": abstract is not None,
        "contexts": contexts,
        "category": integrity.get("category", "Unknown"),
    }

    abstract_src = "SS" if (ss_paper and ss_paper.get("abstract")) else ("OA/CR/etc" if abstract else "NONE")
    relevance_str = f"{relevance:3d}" if relevance is not None else "N/A"
    print(
        f"[reliability] {title[:45]!r:50s} → "
        f"reliability={reliability:3d}  relevance={relevance_str}  "
        f"abstract={abstract_src}  doi_ok={doi_ok}"
    )
    return result


def score_all_references(parsed: dict) -> dict:
    """
    Run score_reference() for every citation in a GROBID-parsed document.

    Args:
        parsed: output of grobid.parse_tei() or from the grobid cache

    Returns:
    {
        "results": [<scored citation>, ...],
        "summary": {
            "total": int,
            "high_reliability": int,   # overall >= 70
            "medium_reliability": int, # 40-69
            "low_reliability": int,    # < 40
            "retracted": int,
            "predatory_venue": int,
            "self_citations": int,
            "weak_relevance": int,
        }
    }
    """
    citations = parsed.get("citations", [])
    in_text_map = parsed.get("in_text_map", {})
    metadata = parsed.get("metadata", {})
    paper_authors = metadata.get("authors", [])
    source_title = metadata.get("title", "")
    source_abstract = metadata.get("abstract", "")
    paper_year = None  # citing paper year not directly stored in parsed metadata

    contexts_found = sum(1 for cit in citations if in_text_map.get(f"b{cit.get('num', '')}"))
    print(f"[DEBUG reliability] citations with contexts: {contexts_found}/{len(citations)}")
    print(f"[DEBUG reliability] in_text_map keys (first 10): {list(in_text_map.keys())[:10]}")
    print(f"[DEBUG reliability] citation nums (first 10): {[cit.get('num') for cit in citations[:10]]}")
    print(f"[DEBUG reliability] source_title='{source_title[:60]}' | source_abstract={'YES' if source_abstract else 'NO'}")

    results: list[dict] = []
    for cit in citations:
        key = f"b{cit['num']}"
        contexts = in_text_map.get(key, [])
        scored = score_reference(
            cit, contexts, paper_authors, paper_year,
            source_title=source_title,
            source_abstract=source_abstract,
        )
        results.append(scored)

    # Summary stats
    total = len(results)
    assessed = [r for r in results if r["relevance"] is not None]
    avg_relevance = round(sum(r["relevance"] for r in assessed) / len(assessed)) if assessed else 0
    summary = {
        "total": total,
        "high_reliability": sum(1 for r in results if r["overall_score"] >= 70),
        "medium_reliability": sum(1 for r in results if 40 <= r["overall_score"] < 70),
        "low_reliability": sum(1 for r in results if r["overall_score"] < 40),
        "retracted": 0,  # isRetracted not exposed via SS search API
        "predatory_venue": sum(1 for r in results if _is_predatory(r.get("venue", ""))),
        "self_citations": sum(1 for r in results if r["self_cite_score"] < 60),
        "weak_relevance": sum(1 for r in assessed if r["relevance"] < 50),
        "no_abstract": total - len(assessed),
    }

    return {"results": results, "summary": summary}
