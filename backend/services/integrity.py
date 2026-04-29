"""
Integrity Auditor
=================
Two tools combined into one endpoint (run in parallel):

A. Related Work Fairness Auditor
   – Identifies which citations appear in the related work section
   – Fetches each cited paper's abstract via Semantic Scholar / OpenAlex
   – GPT-4o-mini compares how the paper characterises prior work vs. what
     those papers say about themselves
   – Flags: strawman framing, omitted capabilities, underselling

B. Overclaim & Exaggeration Detector
   – Extracts strong-claim sentences from abstract / intro / conclusion
   – Extracts experimental scope (datasets, languages, benchmarks)
   – GPT-4o-mini flags sentences where claim strength exceeds the evidence
"""

from __future__ import annotations

import os
import re
import json
import requests
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI

from services.section_extractor import extract_sections

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SS_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
SS_API_KEY    = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")

# ── Section-heading patterns ───────────────────────────────────────────────────

_RW_RE = re.compile(
    r"\b(related|prior|previous|background|literature|survey|review|existing)\b",
    re.IGNORECASE,
)
_CLAIM_RE = re.compile(
    r"\b(abstract|introduction|conclusion|discussion|summary|contribution|impact)\b",
    re.IGNORECASE,
)
_EXP_RE = re.compile(
    r"\b(experiment|evaluation|result|dataset|setup|implementat|method|approach|"
    r"model|system|training|benchmark)\b",
    re.IGNORECASE,
)

# ── Strong-claim language ──────────────────────────────────────────────────────

_STRONG_RE = re.compile(
    r"\b(first\s+(?:to|paper|work|model|method|approach)|novel(?:ly)?|unique|unprecedented|"
    r"significantly\s+(?:outperform|improv|better|reduc)|substantially|dramatically|"
    r"state.of.the.art|generaliz\w+|universal\w*|"
    r"(?:all|any)\s+(?:tasks?|datasets?|domains?|languages?)|"
    r"robust\s+(?:across|to)|always|never|"
    r"comprehensive\s+(?:study|evaluation|framework|analysis)|"
    r"conclusive|definitive|prove that)\b",
    re.IGNORECASE,
)

_EXP_KW_RE = re.compile(
    r"\b(dataset|benchmark|corpus|evaluation|experiment|task|language|domain|"
    r"setting|baseline|metric|test\s+set|train(?:ing)?\s+(?:set|data))\b",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Shared helper: abstract fetcher (SS → OA)
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_abstract(title: str, doi: str | None) -> str | None:
    title_clean = re.sub(r"<[^>]+>", "", title or "").strip()
    if not title_clean:
        return None

    ss_headers = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}

    # 1. SS by DOI
    if doi:
        try:
            r = requests.get(
                f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi.strip()}",
                params={"fields": "title,abstract"},
                headers=ss_headers,
                timeout=(4, 8),
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("abstract"):
                    return data["abstract"]
        except Exception:
            pass

    # 2. SS by title
    try:
        r = requests.get(
            SS_SEARCH_URL,
            params={"query": title_clean[:120], "fields": "title,abstract", "limit": 1},
            headers=ss_headers,
            timeout=(4, 8),
        )
        if r.status_code == 200:
            items = r.json().get("data", [])
            if items and items[0].get("abstract"):
                hit = (items[0].get("title") or "").lower()
                q   = set(title_clean.lower().split())
                h   = set(hit.split())
                if len(q & h) / max(len(q), 1) >= 0.5:
                    return items[0]["abstract"]
    except Exception:
        pass

    # 3. OpenAlex by DOI
    if doi:
        try:
            oa_headers = {"User-Agent": "reflens/1.0 (mailto:research@reflens.app)"}
            r = requests.get(
                f"https://api.openalex.org/works/https://doi.org/{doi.strip()}",
                headers=oa_headers,
                timeout=(4, 8),
            )
            if r.status_code == 200:
                inv = r.json().get("abstract_inverted_index")
                if inv:
                    pairs = [(pos, word) for word, positions in inv.items() for pos in positions]
                    pairs.sort()
                    abstract = " ".join(w for _, w in pairs)
                    if abstract:
                        return abstract
        except Exception:
            pass

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Part A: Related Work Fairness Auditor
# ─────────────────────────────────────────────────────────────────────────────

def _rw_descriptions(
    sections: dict,
    in_text_map: dict,
    citations: list[dict],
) -> dict[str, list[str]]:
    """
    For each citation that appears in a related-work section, collect the
    sentences that describe it there.
    Returns {citation_id: [sentence, ...]}
    """
    # Collect all sentences from related-work headings
    rw_texts: list[str] = []
    for heading, sents in sections.items():
        if _RW_RE.search(heading):
            rw_texts.extend(s["text"] for s in sents)

    if not rw_texts:
        return {}

    rw_set   = set(rw_texts)
    rw_lower = [s.lower() for s in rw_texts]

    result: dict[str, list[str]] = {}
    for cit in citations:
        key      = f"b{cit['num']}"
        contexts = in_text_map.get(key, [])

        matched = []
        for ctx in contexts:
            ctx_l = ctx.lower().strip()
            if ctx in rw_set:
                matched.append(ctx)
                continue
            if len(ctx_l) > 30:
                for rws in rw_lower:
                    if ctx_l in rws or rws in ctx_l:
                        matched.append(ctx)
                        break
        if matched:
            result[cit["id"]] = matched

    return result


def _gpt_fairness_batch(batch: list[dict]) -> list[dict]:
    items_text = ""
    for i, item in enumerate(batch, 1):
        desc     = " | ".join(item["description"][:3])
        abstract = (item["abstract"] or "Not available")[:600]
        items_text += (
            f"\n---\nItem {i}:\n"
            f"Citation ID: {item['citation_id']}\n"
            f"Paper title: {item['title']}\n"
            f'How described in related work: "{desc}"\n'
            f'Paper\'s own abstract: "{abstract}"\n'
        )

    system = (
        "You are a rigorous academic peer reviewer assessing whether a paper's related work "
        "section fairly characterises prior work.\n\n"
        "For each item assess:\n"
        "1. Does the description accurately represent what the cited paper does?\n"
        "2. Are significant capabilities, contributions, or results omitted or downplayed?\n"
        "3. Is the prior work framed as a 'strawman' to make the current paper look better?\n\n"
        "Return a JSON object with key 'results' containing an array. Each element:\n"
        '{"citation_id":"...","verdict":"fair"|"understated"|"misrepresented"|"strawman",'
        '"severity":"low"|"medium"|"high",'
        '"issue":"one sentence, or null if fair",'
        '"omitted":"specific omitted capability or null"}\n\n'
        "Only flag genuine problems — do not flag brevity alone. "
        "If abstract is unavailable, return verdict 'fair'."
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": items_text.strip()},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=1500,
        )
        raw = json.loads(resp.choices[0].message.content)
        if isinstance(raw, list):
            return raw
        for val in raw.values():
            if isinstance(val, list):
                return val
    except Exception as e:
        print(f"[integrity] GPT fairness batch error: {e}")
    return []


def audit_related_work_fairness(
    sections: dict,
    in_text_map: dict,
    citations: list[dict],
) -> tuple[list[dict], int]:
    """
    Returns (flagged_verdicts, total_rw_citations_checked).
    """
    rw_desc = _rw_descriptions(sections, in_text_map, citations)
    if not rw_desc:
        return [], 0

    cit_lookup = {c["id"]: c for c in citations}
    rw_cids    = list(rw_desc.keys())[:20]

    # Fetch abstracts in parallel
    def _fetch(cid: str) -> tuple[str, str | None]:
        c = cit_lookup.get(cid, {})
        return cid, _fetch_abstract(c.get("title", ""), c.get("doi"))

    abstracts: dict[str, str | None] = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for cid, ab in pool.map(_fetch, rw_cids):
            abstracts[cid] = ab

    # Build batch items
    batch_items = [
        {
            "citation_id": cid,
            "title":       cit_lookup.get(cid, {}).get("title", ""),
            "description": rw_desc[cid],
            "abstract":    abstracts.get(cid),
        }
        for cid in rw_cids
    ]

    # GPT in batches of 6
    all_verdicts: list[dict] = []
    for i in range(0, len(batch_items), 6):
        all_verdicts.extend(_gpt_fairness_batch(batch_items[i : i + 6]))

    verdict_lookup = {v["citation_id"]: v for v in all_verdicts}

    results = []
    for item in batch_items:
        cid     = item["citation_id"]
        cit     = cit_lookup.get(cid, {})
        verdict = verdict_lookup.get(cid, {})
        results.append({
            "citation_id":     cid,
            "title":           cit.get("title", ""),
            "year":            cit.get("year"),
            "authors":         cit.get("authors", []),
            "description":     item["description"],
            "abstract_snippet": (item["abstract"] or "")[:400] or None,
            "verdict":         verdict.get("verdict", "fair"),
            "severity":        verdict.get("severity", "low"),
            "issue":           verdict.get("issue"),
            "omitted":         verdict.get("omitted"),
        })

    flagged = [r for r in results if r["verdict"] != "fair"]
    return flagged, len(rw_cids)


# ─────────────────────────────────────────────────────────────────────────────
# Part B: Overclaim & Exaggeration Detector
# ─────────────────────────────────────────────────────────────────────────────

def _claim_sentences(sections: dict, source_abstract: str) -> list[str]:
    sents: list[str] = []

    if source_abstract:
        for s in re.split(r"(?<=[.!?])\s+", source_abstract.strip()):
            if len(s.strip()) > 30 and _STRONG_RE.search(s):
                sents.append(s.strip())

    for heading, items in sections.items():
        if _CLAIM_RE.search(heading):
            for item in items:
                t = item["text"]
                if len(t) > 30 and _STRONG_RE.search(t):
                    sents.append(t)

    seen: set[str] = set()
    unique: list[str] = []
    for s in sents:
        key = s.lower()[:80]
        if key not in seen:
            seen.add(key)
            unique.append(s)

    return unique[:30]


def _experimental_scope(sections: dict) -> str:
    scope_sents: list[str] = []
    for heading, items in sections.items():
        if _EXP_RE.search(heading):
            for item in items:
                t = item["text"]
                if _EXP_KW_RE.search(t) and len(t) > 20:
                    scope_sents.append(t)

    scope_text = " ".join(scope_sents)

    # Pull out dataset/benchmark proper-noun mentions
    datasets = re.findall(
        r"\b([A-Z][A-Za-z0-9\-]+(?:\s+[A-Z][A-Za-z0-9\-]+)*)\b"
        r"(?=\s+(?:dataset|benchmark|corpus|test\s+set|evaluation\s+set))",
        scope_text,
    )
    datasets = list(set(datasets[:15]))

    summary = scope_text[:1500]
    if datasets:
        summary += f"\n\nDatasets/benchmarks mentioned: {', '.join(datasets)}"
    return summary or "No experimental section found."


def _gpt_overclaim(claim_sents: list[str], scope: str) -> list[dict]:
    claims_text = "\n".join(f'{i+1}. "{s}"' for i, s in enumerate(claim_sents))

    system = (
        "You are a rigorous peer reviewer identifying overclaims and exaggerations in academic papers.\n\n"
        "I will give you:\n"
        "1. Sentences from the abstract/introduction/conclusion with strong claim language\n"
        "2. The paper's experimental scope (datasets, languages, benchmarks actually tested)\n\n"
        "For each claim sentence, assess whether the claim strength is justified by the evidence.\n\n"
        "Common overclaim patterns:\n"
        "- Claiming generalizability across all domains/tasks/languages when tested on 1-2 datasets\n"
        "- Claiming to be 'first' without a comprehensive literature review\n"
        "- Using 'significantly' without statistical significance tests\n"
        "- Claiming 'state-of-the-art' on a limited benchmark subset\n"
        "- Claiming 'robust' without adversarial or out-of-distribution testing\n"
        "- Claiming universality while only evaluating on one language/modality\n\n"
        "Return JSON object with key 'overclaims' containing an array. Each item:\n"
        '{"sentence":"...","is_overclaim":true/false,'
        '"claim_type":"generalizability"|"novelty"|"performance"|"scope"|"universality"|"significance",'
        '"issue":"specific explanation or null",'
        '"severity":"high"|"medium"|"low",'
        '"suggestion":"more accurate rephrasing or null"}\n\n'
        "Only flag genuine overclaims. Do not penalise appropriate hedging language."
    )

    user = f"CLAIM SENTENCES:\n{claims_text}\n\nEXPERIMENTAL SCOPE:\n{scope[:1200]}"

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw   = json.loads(resp.choices[0].message.content)
        items = raw.get("overclaims", raw.get("results", []))
        return [item for item in items if item.get("is_overclaim")]
    except Exception as e:
        print(f"[integrity] GPT overclaim error: {e}")
        return []


def detect_overclaims(sections: dict, source_abstract: str) -> list[dict]:
    sents = _claim_sentences(sections, source_abstract)
    if not sents:
        return []
    scope = _experimental_scope(sections)
    return _gpt_overclaim(sents, scope)


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def run_integrity_audit(parsed: dict) -> dict:
    citations      = parsed.get("citations", [])
    in_text_map    = parsed.get("in_text_map", {})
    raw_xml        = parsed.get("raw_xml", "")
    source_abstract = parsed.get("metadata", {}).get("abstract", "")

    sections = extract_sections(raw_xml) if raw_xml else {}

    fairness_results: list[dict] = []
    overclaim_results: list[dict] = []
    rw_checked = 0

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_future = pool.submit(audit_related_work_fairness, sections, in_text_map, citations)
        o_future = pool.submit(detect_overclaims, sections, source_abstract)

        fairness_results, rw_checked = f_future.result()
        overclaim_results = o_future.result()

    high = sum(
        1 for r in fairness_results + overclaim_results
        if r.get("severity") == "high"
    )

    return {
        "fairness":   fairness_results,
        "overclaims": overclaim_results,
        "summary": {
            "fairness_issues":            len(fairness_results),
            "overclaim_issues":           len(overclaim_results),
            "total_issues":               len(fairness_results) + len(overclaim_results),
            "high_severity":              high,
            "related_work_checked":       rw_checked,
        },
    }
