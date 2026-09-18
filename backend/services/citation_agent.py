"""
LangChain agent that verifies each citation against multiple academic APIs,
then scores it for AI generation likelihood.

Pre-fetches from CrossRef, Semantic Scholar, OpenAlex, DBLP, and CORE before
passing enriched data to the LLM, so GPT doesn't have to use tools for lookup.
"""

from langchain_openai import ChatOpenAI
from langchain.tools import tool
from langgraph.prebuilt import create_react_agent  # pyright: ignore[reportDeprecated]
from dotenv import load_dotenv
from difflib import SequenceMatcher
import requests
import time
import os
import re
import json
import concurrent.futures

AGENT_TIMEOUT = 120  # seconds — kill any citation that hangs longer than this

load_dotenv()

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

CROSSREF_URL = "https://api.crossref.org/works"
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
OPENALEX_URL = "https://api.openalex.org/works"
DBLP_URL = "https://dblp.org/search/publ/api"
CORE_URL = "https://api.core.ac.uk/v3/search/works"
ARXIV_URL = "https://export.arxiv.org/api/query"
SS_API_KEY   = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
CORE_API_KEY = os.getenv("CORE_API_KEY", "")

_HEADERS = {"User-Agent": "RefLens/1.0 (mailto:research@example.com)"}


# ── Pre-fetch helpers (deterministic, run before agent) ───────────────────────

def _fetch_crossref(doi: str | None, title: str) -> dict:
    """Look up via CrossRef. DOI first, then title search fallback."""
    result = {"source": "CrossRef", "found": False}
    try:
        if doi:
            r = requests.get(
                f"{CROSSREF_URL}/{doi.strip()}",
                timeout=(5, 10),
                headers=_HEADERS,
            )
            if r.status_code == 200:
                data = r.json().get("message", {})
                result["found"] = True
                result["title"] = (data.get("title") or [""])[0]
                result["year"] = (data.get("published", {}).get("date-parts") or [[None]])[0][0]
                result["doi_valid"] = True
                result["publisher"] = data.get("publisher", "")
                result["type"] = data.get("type", "")
                return result
            # DOI not in CrossRef — fall through to title search
            # Track that the original DOI failed regardless of what title search finds
            if doi:
                result["original_doi_failed"] = True

        # Title search fallback
        if title:
            r = requests.get(
                CROSSREF_URL,
                params={"query.title": title, "rows": 1, "select": "title,published,DOI,publisher,type"},
                timeout=(5, 10),
                headers=_HEADERS,
            )
            if r.status_code == 200:
                items = r.json().get("message", {}).get("items", [])
                if items:
                    d = items[0]
                    returned_title = (d.get("title") or [""])[0]
                    found_doi = d.get("DOI", "")
                    # Validate the returned DOI resolves — if it's dead, CrossRef found
                    # the wrong paper via fuzzy match. Treat as not found in that case.
                    doi_ok = True
                    if found_doi:
                        try:
                            check = requests.head(
                                f"https://doi.org/{found_doi}",
                                timeout=(3, 5),
                                headers=_HEADERS,
                                allow_redirects=True,
                            )
                            doi_ok = check.status_code < 400
                        except Exception:
                            doi_ok = False
                    if doi_ok:
                        result["found"] = True
                        result["title"] = returned_title
                        result["year"] = (d.get("published", {}).get("date-parts") or [[None]])[0][0]
                        result["doi_found"] = found_doi
                        result["publisher"] = d.get("publisher", "")
                    else:
                        result["dead_doi_skipped"] = found_doi  # log it but don't trust the match
        # If DOI lookup failed AND title search didn't recover the paper, mark DOI invalid
        if doi and not result.get("found"):
            result["doi_valid"] = False
    except Exception as e:
        result["error"] = str(e)
    return result


def _ss_get(url: str, params: dict, headers: dict, max_retries: int = 3) -> requests.Response | None:
    """GET with exponential backoff retry on Semantic Scholar 429 rate limit."""
    for attempt in range(max_retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=(5, 10))
            if r.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            return r
        except Exception:
            if attempt == max_retries - 1:
                raise
    return None


def _fetch_semantic_scholar(doi: str | None, title: str) -> dict:
    """Look up via Semantic Scholar. DOI first, then title search. Retries on rate limit."""
    result = {"source": "Semantic Scholar", "found": False}
    headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}
    try:
        if doi:
            r = _ss_get(
                f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi.strip()}",
                params={"fields": "title,year,abstract,citationCount,authors,venue,isOpenAccess"},
                headers=headers,
            )
            if r and r.status_code == 200:
                p = r.json()
                result["found"] = True
                result["title"] = p.get("title", "")
                result["year"] = p.get("year")
                result["abstract"] = (p.get("abstract") or "")[:500]
                result["citation_count"] = p.get("citationCount", 0)
                result["authors"] = [a.get("name", "") for a in p.get("authors", [])][:4]
                result["venue"] = p.get("venue", "")
                return result

        if title:
            r = _ss_get(
                SEMANTIC_SCHOLAR_URL,
                params={"query": title, "fields": "title,year,abstract,citationCount,authors,venue", "limit": 3},
                headers=headers,
            )
            if r and r.status_code == 200:
                data = r.json().get("data", [])
                if data:
                    # Pick the result with highest title similarity (not blindly data[0])
                    query_norm = title.lower().strip()
                    best = max(
                        data,
                        key=lambda p: SequenceMatcher(None, query_norm, (p.get("title") or "").lower().strip()).ratio(),
                    )
                    p = best
                    result["found"] = True
                    result["title"] = p.get("title", "")
                    result["year"] = p.get("year")
                    result["abstract"] = (p.get("abstract") or "")[:500]
                    result["citation_count"] = p.get("citationCount", 0)
                    result["authors"] = [a.get("name", "") for a in p.get("authors", [])][:4]
                    result["venue"] = p.get("venue", "")
    except Exception as e:
        result["error"] = str(e)
    return result


def _decode_inverted_index(inv: dict) -> str:
    """Reconstruct abstract text from OpenAlex inverted index format."""
    pairs = []
    for word, positions in inv.items():
        for pos in positions:
            pairs.append((pos, word))
    return " ".join(w for _, w in sorted(pairs))


def _fetch_openalex(doi: str | None, title: str) -> dict:
    """Look up via OpenAlex. DOI first, then title search."""
    result = {"source": "OpenAlex", "found": False}
    try:
        if doi:
            r = requests.get(
                f"{OPENALEX_URL}/https://doi.org/{doi.strip()}",
                timeout=(5, 10),
                headers=_HEADERS,
            )
            if r.status_code == 200:
                d = r.json()
                abstract = ""
                inv = d.get("abstract_inverted_index")
                if inv:
                    abstract = _decode_inverted_index(inv)[:500]
                result["found"] = True
                result["title"] = d.get("display_name", "")
                result["year"] = d.get("publication_year")
                result["abstract"] = abstract
                result["citation_count"] = d.get("cited_by_count", 0)
                result["open_access"] = d.get("open_access", {}).get("is_oa", False)
                result["type"] = d.get("type", "")
                venue = (d.get("primary_location") or {}).get("source") or {}
                result["venue"] = venue.get("display_name", "")
                return result

        if title:
            r = requests.get(
                OPENALEX_URL,
                params={"search": title, "per-page": 1, "select": "display_name,publication_year,abstract_inverted_index,cited_by_count,type,primary_location"},
                timeout=(5, 10),
                headers=_HEADERS,
            )
            if r.status_code == 200:
                results = r.json().get("results", [])
                if results:
                    d = results[0]
                    abstract = ""
                    inv = d.get("abstract_inverted_index")
                    if inv:
                        abstract = _decode_inverted_index(inv)[:500]
                    result["found"] = True
                    result["title"] = d.get("display_name", "")
                    result["year"] = d.get("publication_year")
                    result["abstract"] = abstract
                    result["citation_count"] = d.get("cited_by_count", 0)
                    result["type"] = d.get("type", "")
    except Exception as e:
        result["error"] = str(e)
    return result


def _fetch_dblp(doi: str | None, title: str) -> dict:
    """Look up via DBLP — the CS-specific bibliography database."""
    result = {"source": "DBLP", "found": False}
    try:
        query = title if title else doi
        if not query:
            return result
        r = requests.get(
            DBLP_URL,
            params={"q": query, "format": "json", "h": 1},
            timeout=(5, 10),
            headers=_HEADERS,
        )
        if r.status_code != 200:
            return result
        hits = r.json().get("result", {}).get("hits", {}).get("hit", [])
        if not hits:
            return result
        info = hits[0].get("info", {})
        authors_raw = info.get("authors", {}).get("author", [])
        if isinstance(authors_raw, (str, dict)):
            authors_raw = [authors_raw]
        result["found"] = True
        result["title"] = info.get("title", "").rstrip(".")
        result["year"] = int(info.get("year", 0)) or None
        result["authors"] = [
            (a.get("text", "") if isinstance(a, dict) else a) for a in authors_raw
        ][:4]
        result["venue"] = info.get("venue", "")
        result["url"] = info.get("url", "")
    except Exception as e:
        result["error"] = str(e)
    return result


def _fetch_core(doi: str | None, title: str) -> dict:
    """Look up via CORE — indexes 200M+ open access papers including arXiv."""
    result = {"source": "CORE", "found": False}
    try:
        headers = {}
        if CORE_API_KEY:
            headers["Authorization"] = f"Bearer {CORE_API_KEY}"
        query = f"doi:{doi}" if doi else f'title:"{title}"'
        r = requests.get(
            CORE_URL,
            params={"q": query, "limit": 1},
            headers={**_HEADERS, **headers},
            timeout=(5, 10),
        )
        if r.status_code != 200:
            return result
        results = r.json().get("results", [])
        if not results:
            return result
        p = results[0]
        result["found"] = True
        result["title"] = p.get("title", "")
        result["year"] = p.get("yearPublished")
        result["abstract"] = (p.get("abstract") or "")[:500]
        authors_raw = p.get("authors", [])
        result["authors"] = [a.get("name", "") for a in authors_raw][:4]
        result["doi"] = p.get("doi", "")
    except Exception as e:
        result["error"] = str(e)
    return result


def _fetch_arxiv(title: str) -> dict:
    """Look up via arXiv — covers virtually all CS and physics preprints."""
    result = {"source": "arXiv", "found": False}
    try:
        if not title:
            return result
        import xml.etree.ElementTree as ET
        clean = re.sub(r"[^\w\s]", " ", title).strip()
        r = requests.get(
            ARXIV_URL,
            params={"search_query": f"ti:{clean}", "max_results": 1, "sortBy": "relevance"},
            timeout=(3, 6),
            headers=_HEADERS,
        )
        if r.status_code != 200:
            return result
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(r.text)
        entries = root.findall("a:entry", ns)
        if not entries:
            return result
        entry = entries[0]
        result["found"] = True
        result["title"] = (entry.findtext("a:title", "", ns) or "").strip().replace("\n", " ")
        published = entry.findtext("a:published", "", ns)
        result["year"] = int(published[:4]) if published else None
        result["abstract"] = (entry.findtext("a:summary", "", ns) or "").strip()[:500]
        result["authors"] = [
            a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)
        ][:4]
        result["arxiv_id"] = entry.findtext("a:id", "", ns)
    except Exception as e:
        result["error"] = str(e)
    return result


def prefetch_citation_data(citation: dict) -> dict:
    """
    Hit all 4 APIs in parallel and return a combined evidence dict.
    This runs BEFORE the agent so GPT gets pre-gathered facts.
    """
    doi = citation.get("doi")
    title = citation.get("title", "")

    def _safe_result(future, source_name):
        try:
            return future.result(timeout=15)
        except Exception as e:
            print(f"  [{source_name}] prefetch timeout/error: {e}")
            return {"source": source_name, "found": False, "error": str(e)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        f_cr    = pool.submit(_fetch_crossref, doi, title)
        f_ss    = pool.submit(_fetch_semantic_scholar, doi, title)
        f_oa    = pool.submit(_fetch_openalex, doi, title)
        f_dblp  = pool.submit(_fetch_dblp, doi, title)
        f_core  = pool.submit(_fetch_core, doi, title)
        crossref = _safe_result(f_cr,   "CrossRef")
        ss       = _safe_result(f_ss,   "Semantic Scholar")
        openalex = _safe_result(f_oa,   "OpenAlex")
        dblp     = _safe_result(f_dblp, "DBLP")
        core     = _safe_result(f_core, "CORE")

    # arXiv is a fallback — only called when no other DB found the paper.
    # This avoids adding arXiv latency (~3–6s) for the common case.
    primary_found = any(s.get("found") for s in [crossref, ss, openalex, dblp, core])
    arxiv = _fetch_arxiv(title) if not primary_found else {"source": "arXiv", "found": False}

    all_sources = [crossref, ss, openalex, dblp, core, arxiv]

    # Consolidate: pick best abstract (prefer longest non-empty)
    abstracts = [s.get("abstract", "") for s in all_sources if s.get("abstract")]
    best_abstract = max(abstracts, key=len) if abstracts else ""

    found_in     = [s["source"] for s in all_sources if s.get("found")]
    not_found_in = [s["source"] for s in all_sources if not s.get("found") and not s.get("error")]

    # DOI discovered via title search (not present in the source PDF)
    discovered_doi = crossref.get("doi_found") or ss.get("externalIds", {}).get("DOI") if not crossref.get("doi_valid") else None

    # If GROBID extracted a bad title (empty or venue-like) but the DOI resolved
    # successfully, use the CrossRef/SS title as the authoritative title for scoring.
    # CrossRef is the publisher's own metadata — its title is ground truth.
    effective_title = title
    if crossref.get("doi_valid") and crossref.get("title") and (not title or len(title) < 10):
        effective_title = crossref["title"]
    elif ss.get("found") and ss.get("title") and (not title or len(title) < 10):
        effective_title = ss["title"]

    # Pre-compute title similarity for each DB result (deterministic, removes GPT guesswork)
    def _sim(db_title: str) -> float:
        if not effective_title or not db_title:
            return 0.0
        return round(SequenceMatcher(None, effective_title.lower().strip(), db_title.lower().strip()).ratio(), 2)

    title_similarities = {
        "CrossRef":         _sim(crossref.get("title", "")),
        "Semantic Scholar": _sim(ss.get("title", "")),
        "OpenAlex":         _sim(openalex.get("title", "")),
        "DBLP":             _sim(dblp.get("title", "")),
        "CORE":             _sim(core.get("title", "")),
        "arXiv":            _sim(arxiv.get("title", "")),
    }

    # Max citation count — only from DBs where title similarity >= 0.7 confirms it's the same paper.
    # Without this filter, fake titles can fuzzy-match to unrelated highly-cited real papers,
    # causing the citation count cap to fire on fabricated citations (false negatives).
    max_citation_count = max(
        (s.get("citation_count", 0) for s in [ss, openalex]
         if s.get("found") and title_similarities.get(s["source"], 0) >= 0.7),
        default=0,
    )
    # Best similarity across any DB that actually found something
    best_similarity = max(
        (title_similarities[s["source"]] for s in all_sources if s.get("found")),
        default=0.0,
    )

    # Author mismatch check: compare cited authors against what databases returned.
    # If the title matches well (sim >= 0.6) but authors don't overlap at all → strong fake signal.
    cited_authors_norm = {a.lower().split()[-1] for a in citation.get("authors", []) if a.strip()}
    author_mismatch = False
    author_mismatch_details = []
    for src in [ss, openalex, dblp]:
        sim = title_similarities.get(src.get("source", ""), 0)
        db_authors = src.get("authors", [])
        if src.get("found") and sim >= 0.85 and db_authors and cited_authors_norm:
            db_surnames = {a.lower().split()[-1] for a in db_authors if a.strip()}
            overlap = cited_authors_norm & db_surnames
            if not overlap:
                author_mismatch = True
                author_mismatch_details.append(
                    f"{src['source']}: cited authors {list(cited_authors_norm)[:3]} "
                    f"vs DB authors {list(db_surnames)[:3]}"
                )

    return {
        "crossref": crossref,
        "semantic_scholar": ss,
        "openalex": openalex,
        "dblp": dblp,
        "core": core,
        "arxiv": arxiv,
        "found_in": found_in,
        "not_found_in": not_found_in,
        "best_abstract": best_abstract,
        "doi_valid": crossref.get("doi_valid"),
        "effective_title": effective_title,
        "discovered_doi": discovered_doi,
        "title_similarities": title_similarities,
        "best_similarity": best_similarity,
        "max_citation_count": max_citation_count,
        "author_mismatch": author_mismatch,
        "author_mismatch_details": author_mismatch_details,
    }


def _format_prefetch_summary(evidence: dict) -> str:
    """Format pre-fetched API evidence into a readable block for the prompt."""
    lines = []

    found = evidence.get("found_in", [])
    not_found = evidence.get("not_found_in", [])
    lines.append(f"DATABASE LOOKUP RESULTS:")
    lines.append(f"  Found in: {', '.join(found) if found else 'NONE — not found in any database'}")
    if not_found:
        lines.append(f"  Not found in: {', '.join(not_found)}")

    if evidence.get("doi_valid") is False:
        lines.append(f"  DOI CHECK: INVALID — DOI does not exist in CrossRef")
    elif evidence.get("crossref", {}).get("original_doi_failed"):
        lines.append(f"  ⚠ DOI CHECK: The DOI in the citation does NOT resolve in CrossRef (paper found via title search only). Suspicious if title match is only partial.")
    elif evidence.get("doi_valid") is True:
        cr_sim = evidence.get("title_similarities", {}).get("CrossRef", 0.0)
        if cr_sim < 0.4:
            # Only flag as DOI mismatch (fabrication signal) if other databases ALSO
            # couldn't find the paper. If SS/OpenAlex/DBLP found it with high similarity,
            # the DOI was just mis-extracted by GROBID — the paper is real.
            other_best = max(
                (evidence.get("title_similarities", {}).get(src, 0.0)
                 for src in ["Semantic Scholar", "OpenAlex", "DBLP", "CORE", "arXiv"]),
                default=0.0,
            )
            if other_best >= 0.7:
                lines.append(f"  DOI CHECK: GROBID extracted incorrect DOI (CrossRef sim={cr_sim:.2f}), but paper confirmed real by other databases (best sim={other_best:.2f})")
            else:
                lines.append(f"  ⚠ DOI MISMATCH — DOI resolves in CrossRef but to a DIFFERENT paper (CrossRef sim={cr_sim:.2f}, other DBs best sim={other_best:.2f}). Strong hallucination signal: fabricated citation may have borrowed a real DOI.")
        else:
            lines.append(f"  DOI CHECK: VALID")

    if evidence.get("author_mismatch"):
        lines.append(f"  ⚠ AUTHOR MISMATCH DETECTED — cited authors do not appear in database records for this title:")
        for d in evidence.get("author_mismatch_details", []):
            lines.append(f"    {d}")

    sims = evidence.get("title_similarities", {})
    best_sim = evidence.get("best_similarity", 0.0)
    effective_title = evidence.get("effective_title", "")
    if effective_title and effective_title != evidence.get("crossref", {}).get("title", ""):
        lines.append(f"  EFFECTIVE TITLE (DOI-corrected): '{effective_title}'")
    lines.append(f"  Best title similarity to citation: {best_sim:.2f} ({'HIGH MATCH' if best_sim >= 0.7 else 'PARTIAL MATCH' if best_sim >= 0.4 else 'LOW MATCH / DIFFERENT PAPER'})")

    max_cc = evidence.get("max_citation_count", 0)
    if max_cc >= 100:
        lines.append(f"  CITATION COUNT: {max_cc} — HIGHLY CITED (hard cap: aiScore <= 30)")
    elif max_cc > 0:
        lines.append(f"  CITATION COUNT: {max_cc}")

    cr = evidence.get("crossref", {})
    if cr.get("found"):
        lines.append(f"\nCrossRef: title='{cr.get('title')}', year={cr.get('year')}, publisher='{cr.get('publisher')}' [similarity={sims.get('CrossRef', 0):.2f}]")

    ss = evidence.get("semantic_scholar", {})
    if ss.get("found"):
        lines.append(f"Semantic Scholar: title='{ss.get('title')}', year={ss.get('year')}, citations={ss.get('citation_count', 0)}, venue='{ss.get('venue')}' [similarity={sims.get('Semantic Scholar', 0):.2f}]")
        if ss.get("authors"):
            lines.append(f"  Authors: {', '.join(ss['authors'])}")

    oa = evidence.get("openalex", {})
    if oa.get("found"):
        lines.append(f"OpenAlex: title='{oa.get('title')}', year={oa.get('year')}, citations={oa.get('citation_count', 0)}, type='{oa.get('type')}' [similarity={sims.get('OpenAlex', 0):.2f}]")

    db = evidence.get("dblp", {})
    if db.get("found"):
        lines.append(f"DBLP: title='{db.get('title')}', year={db.get('year')}, venue='{db.get('venue')}' [similarity={sims.get('DBLP', 0):.2f}]")
        if db.get("authors"):
            lines.append(f"  Authors: {', '.join(db['authors'])}")

    co = evidence.get("core", {})
    if co.get("found"):
        lines.append(f"CORE: title='{co.get('title')}', year={co.get('year')}, doi='{co.get('doi', '')}' [similarity={sims.get('CORE', 0):.2f}]")
        if co.get("authors"):
            lines.append(f"  Authors: {', '.join(co['authors'])}")

    ax = evidence.get("arxiv", {})
    if ax.get("found"):
        lines.append(f"arXiv: title='{ax.get('title')}', year={ax.get('year')} [similarity={sims.get('arXiv', 0):.2f}]")
        if ax.get("authors"):
            lines.append(f"  Authors: {', '.join(ax['authors'])}")

    abstract = evidence.get("best_abstract", "")
    if abstract:
        lines.append(f"\nBEST ABSTRACT FOUND:\n{abstract[:400]}")
    else:
        lines.append(f"\nABSTRACT: Not available in any database")

    return "\n".join(lines)


# ── Tools (kept for agent fallback use) ───────────────────────────────────────

@tool
def verify_doi(doi: str) -> str:
    """Verify if a DOI actually exists in CrossRef. Returns existence status and paper metadata if found."""
    try:
        r = requests.get(
            f"{CROSSREF_URL}/{doi.strip()}",
            timeout=(5, 8),
            headers=_HEADERS,
        )
        if r.status_code == 200:
            data = r.json().get("message", {})
            title = data.get("title", ["Unknown"])[0]
            year = data.get("published", {}).get("date-parts", [[None]])[0][0]
            return f"EXISTS: Title='{title}', Year={year}"
        return "NOT FOUND: DOI does not exist in CrossRef"
    except Exception as e:
        return f"ERROR: Could not verify DOI - {str(e)}"


@tool
def search_paper(title: str) -> str:
    """Search for a paper by title in Semantic Scholar. Returns abstract, year, and citation count if found."""
    try:
        headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}
        r = requests.get(
            SEMANTIC_SCHOLAR_URL,
            params={"query": title, "fields": "title,year,abstract,citationCount,authors", "limit": 1},
            headers=headers,
            timeout=(5, 8),
        )
        if r.status_code == 200:
            data = r.json().get("data", [])
            if data:
                p = data[0]
                abstract = p.get("abstract") or "No abstract available"
                if len(abstract) > 300:
                    abstract = abstract[:300] + "..."
                authors = [a.get("name", "") for a in p.get("authors", [])][:3]
                return (
                    f"FOUND: Title='{p.get('title')}'\n"
                    f"Year={p.get('year')}\n"
                    f"Authors={', '.join(authors)}\n"
                    f"Citations={p.get('citationCount', 0)}\n"
                    f"Abstract: {abstract}"
                )
        return "NOT FOUND: Paper not in Semantic Scholar"
    except Exception as e:
        return f"ERROR: {str(e)}"


@tool
def analyze_relevance(context: str, abstract: str) -> str:
    """
    Format a citation's in-text context alongside a paper's abstract so the agent
    can assess whether the paper actually supports the claim it's cited for.
    """
    if not abstract or abstract == "No abstract available":
        return "Cannot assess relevance — no abstract available"
    return (
        f"Citation context: '{context}'\n"
        f"Paper abstract: '{abstract}'\n"
        f"Question: Does this abstract match what the citation is being used to support?"
    )


# ── Agent ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a citation integrity analyst for academic papers.
Your job is to determine if a citation is genuine or potentially AI-generated/hallucinated.

You will receive:
- The citation as it appears in the PDF (title, authors, year, venue, DOI)
- How it is used in the paper (in-text context)
- The best abstract found across all databases
- Pre-fetched lookup results from CrossRef, Semantic Scholar, OpenAlex, DBLP, CORE, arXiv

STEP 1 — REASON ABOUT THE CITATION ITSELF (do this before looking at database counts):
Ask yourself:
a) Does the title sound like a plausible, specific academic paper? Or is it suspiciously generic,
   keyword-stuffed, or reads like a made-up name (e.g. "CitePulse: Adaptive Citation Intent Prediction
   for Interactive Scholarly Reading" with no real authors)?
b) Do the author names look like real researchers in this field? AI often generates ethnically
   inconsistent name combinations or names that don't appear anywhere in the literature.
c) Is the venue real and appropriate? (e.g. a CHI paper about HCI is plausible; "ACM Symposium on
   Citation Intelligence 2024" that doesn't exist is suspicious)
d) Does the in-text context match what the cited paper's abstract actually says?
   A real citation is used specifically; a hallucinated one is used vaguely or incorrectly.
e) Is the DOI format valid? (should start with 10. followed by registrant prefix)

STEP 2 — WEIGH DATABASE EVIDENCE:
Each database result includes a pre-computed title similarity score (0.0–1.0).
Use these scores — do not re-judge similarity yourself.

STEP 3 — SYNTHESIZE and output JSON:
{
  "aiScore": <0-100>,
  "status": <"ai_likely"|"uncertain"|"human">,
  "flags": [<list of specific issues found>],
  "reasoning": <one sentence explanation>
}

SCORING RULES — apply the FIRST rule that matches:

0. CITATION COUNT OVERRIDE: If the evidence shows CITATION COUNT >= 100, this paper
   has been cited by hundreds of real researchers and almost certainly exists.
   Apply a HARD CAP of aiScore <= 30 regardless of database count, DOI, or similarity.
   A hallucinated paper cannot have accumulated 100+ real-world citations.

1. Found in 2+ databases with best_similarity >= 0.7 (HIGH MATCH) → aiScore 0-25. Strong legitimacy signal.
   Missing DOI, minor year differences, or casing differences do NOT raise this score.
   Low citation count on a post-2021 paper does NOT raise this score.

2. Found in 2+ databases with best_similarity 0.4–0.69 (PARTIAL MATCH) → aiScore 20-40.
   Paper likely exists but GROBID may have slightly garbled the title.

3. Found in 2+ databases with best_similarity < 0.4 (LOW MATCH) → databases returned a different paper.
   Treat as suspicious. aiScore 55-70.

4. Found in DBLP, CORE, or arXiv with similarity >= 0.7 (even if only 1 database total) → aiScore 0-30 (human).
   DBLP is a curated CS-only bibliography; CORE indexes 200M+ open access papers; arXiv covers virtually
   all CS and physics preprints. A high-similarity match in any of these is strong proof of legitimacy.
   HARD CAP: never exceed 30 in this case regardless of DOI or abstract availability.

5. Found in 1 database (non-DBLP/CORE/arXiv) with best_similarity >= 0.7 (HIGH MATCH) → aiScore 30-50 (uncertain).
   HARD CAP: never exceed 50 in this case. The paper exists; only 1 DB indexed it.

6. Found in 1 database with best_similarity < 0.4 (LOW MATCH) → database returned different paper.
   aiScore 60-75.

7. Found in 0 databases → aiScore 70-90. Strong hallucination signal.
   But if STEP 1 reasoning finds the title/authors/venue look completely authentic, lower toward 70.
   If STEP 1 finds multiple red flags (generic title, unverifiable authors, fake venue), raise toward 90.

DOI RULES:
- Missing or unresolvable DOI is common for arXiv preprints, OECD reports, and CS conference papers.
  Do NOT penalize if found in 1+ databases with similarity >= 0.7.
- DOI absent from CrossRef index ≠ fake paper. CrossRef does not index everything.
- Invalid DOI + found in 0 databases → raise score by 15.

CITATION COUNT RULES:
- Papers published in 2022 or later WILL have low citation counts — this is expected and normal.
  Do NOT penalize recent papers for having <50 citations.
- Only penalize 0 citation count if the paper claims to be a classic/foundational pre-2020 work.

OTHER SIGNALS (apply on top of base score):
- DOI does not resolve (original_doi_failed) AND title match is only partial (< 0.7) → +20.
  A real paper would have a working DOI. A partial title match + dead DOI strongly suggests fabrication.
- AUTHOR MISMATCH DETECTED in evidence → +25. This is the strongest hallucination signal after
  database absence. If the title matches a real paper but the authors are completely different,
  the citation is almost certainly fabricated (AI copied a real title but invented the authors).
- DOI MISMATCH in evidence (DOI resolves to a different paper AND other databases also failed
  to find it) → +30. Strong hallucination signal: fabricated citation borrowed a real DOI.
  NOTE: if the evidence says "GROBID extracted incorrect DOI but paper confirmed real by other
  databases", this is NOT a hallucination signal — ignore it and score based on other DB results.
- Abstract is clearly about a completely different topic than how the paper is cited → +15.
- Year mismatch > 3 years AND low similarity → +10.
- 0 citation count for a pre-2020 paper described as widely-cited and foundational → +10.
- Always end with the JSON block"""

tools = [verify_doi, search_paper, analyze_relevance]
agent = create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)  # pyright: ignore[reportDeprecated]


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_citation_with_agent(citation: dict, contexts: list) -> dict:
    """Pre-fetch from all APIs, then run the LangChain agent with enriched context."""
    context_str = " | ".join(contexts[:2]) if contexts else "No in-text context available"

    # Deterministic pre-fetch from all 4 sources
    print(f"  [{citation['id']}] Pre-fetching from CrossRef / SS / OpenAlex / DBLP / CORE / arXiv...")
    evidence = prefetch_citation_data(citation)
    evidence_summary = _format_prefetch_summary(evidence)
    print(f"  [{citation['id']}] Found in: {evidence['found_in'] or 'NONE'}")

    best_abstract = evidence.get("best_abstract", "") or "Not available"
    if len(best_abstract) > 600:
        best_abstract = best_abstract[:600] + "..."

    input_text = f"""Analyze this citation for AI generation or hallucination.

=== CITATION METADATA (from source PDF) ===
Citation ID: {citation['id']}
Title: {citation.get('title', 'Unknown')}
Authors: {', '.join(citation.get('authors', [])) or 'Unknown'}
Year: {citation.get('year', 'Unknown')}
Venue: {citation.get('venue', 'Unknown') or 'Not specified'}
DOI: {citation.get('doi', 'None')}

=== HOW IT IS CITED IN THE PAPER ===
"{context_str}"

=== BEST ABSTRACT FOUND (from databases) ===
{best_abstract}

=== PRE-FETCHED DATABASE EVIDENCE ===
{evidence_summary}

First reason about the citation itself (title authenticity, author plausibility, venue validity,
context coherence with the abstract). Then apply the scoring rules. Give your final JSON assessment."""

    # ── DEBUG: print full prompt so you can verify what's sent to GPT ────────
    sep = "=" * 70
    print(f"\n{sep}\n[PROMPT → GPT] {citation['id']}\n{sep}")
    print(input_text)
    print(sep + "\n")

    def _run_agent():
        result = agent.invoke({"messages": [{"role": "user", "content": input_text}]})
        messages = result.get("messages", [])
        return messages[-1].content if messages else ""

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_run_agent)
            try:
                output = future.result(timeout=AGENT_TIMEOUT)
                print(f"  [{citation['id']}] Agent output: {output[:120]}...")
                return _parse_agent_output(output, citation, evidence)
            except concurrent.futures.TimeoutError:
                future.cancel()
                print(f"  [{citation['id']}] TIMEOUT after {AGENT_TIMEOUT}s — skipping")
                return _fallback_result(citation, timed_out=True)
    except Exception as e:
        print(f"Agent error for {citation['id']}: {e}")
        return _fallback_result(citation)


def _parse_agent_output(output: str, citation: dict, evidence: dict | None = None) -> dict:
    """Extract the JSON assessment block from agent output."""
    match = re.search(r'\{[^{}]*"aiScore"[^{}]*\}', output, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return {
                "id": citation["id"],
                "title": citation.get("title", ""),
                "source": _format_source(citation),
                "aiScore": max(0, min(100, int(data.get("aiScore", 50)))),
                "status": data.get("status", "uncertain"),
                "flags": data.get("flags", []),
                "reasoning": data.get("reasoning", ""),
                "doi": citation.get("doi"),
                "year": citation.get("year"),
                "agent_analyzed": True,
                "found_in": evidence.get("found_in", []) if evidence else [],
                "discovered_doi": evidence.get("discovered_doi") if evidence else None,
            }
        except Exception:
            pass

    return _fallback_result(citation)


def _fallback_result(citation: dict, timed_out: bool = False) -> dict:
    return {
        "id": citation["id"],
        "title": citation.get("title", ""),
        "source": _format_source(citation),
        "aiScore": 50,
        "status": "uncertain",
        "flags": ["Analysis timed out" if timed_out else "Agent analysis failed"],
        "reasoning": "Request timed out — could not complete analysis" if timed_out else "Could not complete analysis",
        "doi": citation.get("doi"),
        "year": citation.get("year"),
        "agent_analyzed": False,
        "found_in": [],
        "discovered_doi": None,
    }


def _format_source(c: dict) -> str:
    authors = c.get("authors", [])
    year = c.get("year", "?")
    if authors:
        suffix = " et al." if len(authors) > 1 else ""
        return f"{authors[0]}{suffix}, {year}"
    return f"Unknown, {year}"
