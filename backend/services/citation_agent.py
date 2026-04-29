"""
LangChain agent that verifies each citation against multiple academic APIs,
then scores it for AI generation likelihood.

Pre-fetches from CrossRef, Semantic Scholar, OpenAlex, and PubMed before
passing enriched data to the LLM, so GPT doesn't have to use tools for lookup.
"""

from langchain_openai import ChatOpenAI
from langchain.tools import tool
from langgraph.prebuilt import create_react_agent
from dotenv import load_dotenv
import requests
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
PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
SS_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")

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
            result["doi_valid"] = False

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
                    result["found"] = True
                    result["title"] = (d.get("title") or [""])[0]
                    result["year"] = (d.get("published", {}).get("date-parts") or [[None]])[0][0]
                    result["doi_found"] = d.get("DOI", "")
                    result["publisher"] = d.get("publisher", "")
    except Exception as e:
        result["error"] = str(e)
    return result


def _fetch_semantic_scholar(doi: str | None, title: str) -> dict:
    """Look up via Semantic Scholar. DOI first, then title search."""
    result = {"source": "Semantic Scholar", "found": False}
    headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}
    try:
        # Try DOI lookup directly
        if doi:
            r = requests.get(
                f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi.strip()}",
                params={"fields": "title,year,abstract,citationCount,authors,venue,isOpenAccess"},
                headers=headers,
                timeout=(5, 10),
            )
            if r.status_code == 200:
                p = r.json()
                result["found"] = True
                result["title"] = p.get("title", "")
                result["year"] = p.get("year")
                result["abstract"] = (p.get("abstract") or "")[:500]
                result["citation_count"] = p.get("citationCount", 0)
                result["authors"] = [a.get("name", "") for a in p.get("authors", [])][:4]
                result["venue"] = p.get("venue", "")
                return result

        # Title search fallback
        if title:
            r = requests.get(
                SEMANTIC_SCHOLAR_URL,
                params={
                    "query": title,
                    "fields": "title,year,abstract,citationCount,authors,venue",
                    "limit": 1,
                },
                headers=headers,
                timeout=(5, 10),
            )
            if r.status_code == 200:
                data = r.json().get("data", [])
                if data:
                    p = data[0]
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


def _fetch_pubmed(doi: str | None, title: str) -> dict:
    """Look up via PubMed (NCBI E-utilities). DOI first, then title search."""
    result = {"source": "PubMed", "found": False}
    try:
        query = f"{doi}[doi]" if doi else f"{title}[title]"
        r = requests.get(
            PUBMED_SEARCH_URL,
            params={"db": "pubmed", "term": query, "retmax": 1, "retmode": "json"},
            timeout=(5, 10),
            headers=_HEADERS,
        )
        if r.status_code != 200:
            return result
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return result

        pmid = ids[0]
        r2 = requests.get(
            PUBMED_FETCH_URL,
            params={"db": "pubmed", "id": pmid, "retmode": "xml", "rettype": "abstract"},
            timeout=(5, 10),
            headers=_HEADERS,
        )
        if r2.status_code == 200:
            xml = r2.text
            # Simple regex extractions — avoid lxml dependency here
            art_title = re.search(r"<ArticleTitle>(.*?)</ArticleTitle>", xml, re.DOTALL)
            abstract = re.search(r"<AbstractText.*?>(.*?)</AbstractText>", xml, re.DOTALL)
            year = re.search(r"<PubDate>.*?<Year>(\d{4})</Year>", xml, re.DOTALL)
            result["found"] = True
            result["pmid"] = pmid
            result["title"] = art_title.group(1).strip() if art_title else ""
            result["abstract"] = (abstract.group(1).strip() if abstract else "")[:500]
            result["year"] = int(year.group(1)) if year else None
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

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        f_cr  = pool.submit(_fetch_crossref, doi, title)
        f_ss  = pool.submit(_fetch_semantic_scholar, doi, title)
        f_oa  = pool.submit(_fetch_openalex, doi, title)
        f_pm  = pool.submit(_fetch_pubmed, doi, title)
        crossref = f_cr.result(timeout=15)
        ss       = f_ss.result(timeout=15)
        openalex = f_oa.result(timeout=15)
        pubmed   = f_pm.result(timeout=15)

    # Consolidate: pick best abstract (prefer longest non-empty)
    abstracts = [
        s.get("abstract", "") for s in [ss, openalex, pubmed] if s.get("abstract")
    ]
    best_abstract = max(abstracts, key=len) if abstracts else ""

    found_in = [s["source"] for s in [crossref, ss, openalex, pubmed] if s.get("found")]
    not_found_in = [s["source"] for s in [crossref, ss, openalex, pubmed] if not s.get("found") and not s.get("error")]

    # DOI discovered via title search (not present in the source PDF)
    discovered_doi = crossref.get("doi_found") or ss.get("externalIds", {}).get("DOI") if not crossref.get("doi_valid") else None

    return {
        "crossref": crossref,
        "semantic_scholar": ss,
        "openalex": openalex,
        "pubmed": pubmed,
        "found_in": found_in,
        "not_found_in": not_found_in,
        "best_abstract": best_abstract,
        "doi_valid": crossref.get("doi_valid"),  # None = no DOI to check
        "discovered_doi": discovered_doi,  # DOI found via lookup but absent from source PDF
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
    elif evidence.get("doi_valid") is True:
        lines.append(f"  DOI CHECK: VALID")

    cr = evidence.get("crossref", {})
    if cr.get("found"):
        lines.append(f"\nCrossRef: title='{cr.get('title')}', year={cr.get('year')}, publisher='{cr.get('publisher')}'")

    ss = evidence.get("semantic_scholar", {})
    if ss.get("found"):
        lines.append(f"Semantic Scholar: title='{ss.get('title')}', year={ss.get('year')}, citations={ss.get('citation_count', 0)}, venue='{ss.get('venue')}'")
        if ss.get("authors"):
            lines.append(f"  Authors: {', '.join(ss['authors'])}")

    oa = evidence.get("openalex", {})
    if oa.get("found"):
        lines.append(f"OpenAlex: title='{oa.get('title')}', year={oa.get('year')}, citations={oa.get('citation_count', 0)}, type='{oa.get('type')}'")

    pm = evidence.get("pubmed", {})
    if pm.get("found"):
        lines.append(f"PubMed: title='{pm.get('title')}', year={pm.get('year')}, PMID={pm.get('pmid')}")

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

You will be given PRE-FETCHED results from CrossRef, Semantic Scholar, OpenAlex, and PubMed.
Use these facts directly. Only use verify_doi or search_paper if the pre-fetched data is missing or unclear.

Assess the citation based on:
1. Whether it exists in any of the 4 databases
2. Whether the DOI is valid (if provided)
3. Whether author names and year match across sources
4. Whether the abstract supports how it's being cited in the paper

Then provide your final assessment as JSON:
{
  "aiScore": <0-100>,
  "status": <"ai_likely"|"uncertain"|"human">,
  "flags": [<list of specific issues found>],
  "reasoning": <one sentence explanation>
}

Rules:
- aiScore 70-100 = AI likely (not found in any DB, DOI fake, completely irrelevant)
- aiScore 40-69 = Uncertain (found in 1 DB only, weak relevance, minor mismatches)
- aiScore 0-39 = Human (found in multiple DBs, DOI valid, relevant abstract)
- Found in 3-4 databases with matching metadata = strong signal of legitimacy
- Not found in ANY database = strong signal of hallucination
- A paper with 0 citations that is claimed to be foundational = suspicious
- Always end with the JSON block"""

tools = [verify_doi, search_paper, analyze_relevance]
agent = create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_citation_with_agent(citation: dict, contexts: list) -> dict:
    """Pre-fetch from all APIs, then run the LangChain agent with enriched context."""
    context_str = " | ".join(contexts[:2]) if contexts else "No in-text context available"

    # Deterministic pre-fetch from all 4 sources
    print(f"  [{citation['id']}] Pre-fetching from CrossRef / SS / OpenAlex / PubMed...")
    evidence = prefetch_citation_data(citation)
    evidence_summary = _format_prefetch_summary(evidence)
    print(f"  [{citation['id']}] Found in: {evidence['found_in'] or 'NONE'}")

    input_text = f"""Analyze this citation for AI generation or hallucination.

=== CITATION METADATA (from source PDF) ===
Citation ID: {citation['id']}
Title: {citation.get('title', 'Unknown')}
Authors: {', '.join(citation.get('authors', [])) or 'Unknown'}
Year: {citation.get('year', 'Unknown')}
Venue: {citation.get('venue', 'Unknown')}
DOI: {citation.get('doi', 'None')}

=== HOW IT IS CITED IN THE PAPER ===
"{context_str}"

=== PRE-FETCHED DATABASE EVIDENCE ===
{evidence_summary}

Based on all the above evidence, give your final JSON assessment."""

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
