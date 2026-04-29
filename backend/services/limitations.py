"""
Limitations Section Analyzer
=============================
1. Detect whether a limitations section exists in the paper
2. Extract stated limitations using GPT
3. Identify implicit weaknesses found elsewhere (methods, results, discussion)
4. Cross-reference: flag weaknesses not acknowledged in the limitations section
"""

from __future__ import annotations

import os
import re
import json
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from services.section_extractor import extract_sections

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

_LIMIT_HEADING_RE = re.compile(
    r"\b(limitation|constraint|future\s+work|caveat|shortcoming|scope)\b",
    re.IGNORECASE,
)
_WEAKNESS_SECTION_RE = re.compile(
    r"\b(discussion|result|conclusion|finding|analysis|experiment|evaluation|method)\b",
    re.IGNORECASE,
)
_WEAK_SIGNAL_RE = re.compile(
    r"\b(however|although|despite|limitation|small sample|limited\s+(to|by|dataset)|"
    r"could not|did not|unable to|future work|we\s+(did not|could not|were not)|"
    r"restricted to|only\s+(\d+|one|two|few)|may not generali|cannot guarantee|"
    r"not representative|potential bias|confound|caveat|acknowledge that|"
    r"note that|should be noted|acknowledge|it is possible)\b",
    re.IGNORECASE,
)


def _find_limitations_section(sections: dict) -> tuple[str | None, list[str]]:
    for heading, sents in sections.items():
        if _LIMIT_HEADING_RE.search(heading):
            return heading, [s["text"] for s in sents]
    return None, []


def _extract_stated_limitations(section_text: str) -> list[dict]:
    if not section_text.strip():
        return []
    system = (
        "You are analyzing a limitations section of an academic paper. "
        "Extract each distinct limitation as a structured object.\n\n"
        "Return JSON with key 'limitations', each item:\n"
        '{"text": "one concise sentence", "category": "scope"|"methodology"|"data"|"generalizability"|"other"}\n\n'
        "Return at most 8 limitations. Be concise."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": section_text[:2000]},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=800,
        )
        raw = json.loads(resp.choices[0].message.content)
        return raw.get("limitations", [])
    except Exception as e:
        print(f"[limitations] GPT extract error: {e}")
        return []


def _find_implicit_weaknesses(sections: dict) -> list[dict]:
    weakness_sents: list[dict] = []
    for heading, sents in sections.items():
        if _WEAKNESS_SECTION_RE.search(heading) and not _LIMIT_HEADING_RE.search(heading):
            for s in sents:
                t = s["text"]
                if len(t) > 40 and _WEAK_SIGNAL_RE.search(t):
                    weakness_sents.append({"text": t, "source_section": heading})
    return weakness_sents[:20]


def _gpt_classify_weaknesses(implicit: list[dict], stated_texts: list[str]) -> list[dict]:
    if not implicit:
        return []

    stated_summary = "\n".join(f"- {t}" for t in stated_texts[:10]) or "None stated."
    items_text = "\n".join(
        f'{i+1}. [Section: {w["source_section"]}] "{w["text"]}"'
        for i, w in enumerate(implicit)
    )
    system = (
        "You are a peer reviewer assessing whether implicit weaknesses in an academic paper "
        "are acknowledged in its limitations section.\n\n"
        "For each candidate sentence:\n"
        "1. Is it a genuine weakness/limitation (not just hedging language)?\n"
        "2. If so, is it already covered by the stated limitations?\n"
        "3. How severe is it if undisclosed?\n\n"
        "Return JSON with key 'results', each item:\n"
        '{"is_weakness": true/false, "covered": true/false, '
        '"severity": "high"|"medium"|"low", "text": "concise description of the weakness"}'
    )
    user = f"STATED LIMITATIONS:\n{stated_summary}\n\nCANDIDATE SENTENCES:\n{items_text}"
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=1200,
        )
        raw = json.loads(resp.choices[0].message.content)
        results = raw.get("results", [])
        enriched = []
        for i, item in enumerate(results):
            if not item.get("is_weakness"):
                continue
            original = implicit[i] if i < len(implicit) else {}
            enriched.append({
                "text": item.get("text", original.get("text", "")),
                "source_section": original.get("source_section", ""),
                "severity": item.get("severity", "low"),
                "covered": item.get("covered", True),
            })
        return enriched
    except Exception as e:
        print(f"[limitations] GPT classify error: {e}")
        return []


def analyze_limitations(parsed: dict) -> dict:
    raw_xml = parsed.get("raw_xml", "")
    sections = extract_sections(raw_xml) if raw_xml else {}

    section_name, section_sents = _find_limitations_section(sections)
    section_text = " ".join(section_sents)
    has_section = section_name is not None

    implicit_raw = _find_implicit_weaknesses(sections)

    stated_limitations: list[dict] = []
    classified: list[dict] = []

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_stated = pool.submit(_extract_stated_limitations, section_text) if has_section else None
        f_classified = pool.submit(_gpt_classify_weaknesses, implicit_raw, [])

        if f_stated:
            stated_limitations = f_stated.result()
        classified = f_classified.result()

    # Re-classify using actual stated texts if we have them
    if stated_limitations and implicit_raw:
        stated_texts = [lim["text"] for lim in stated_limitations]
        classified = _gpt_classify_weaknesses(implicit_raw, stated_texts)

    implicit_weaknesses = [w for w in classified if w.get("covered")]
    undisclosed = [w for w in classified if not w.get("covered")]

    score = 100
    if not has_section:
        score -= 40
    high_undisclosed = sum(1 for w in undisclosed if w.get("severity") == "high")
    med_undisclosed = sum(1 for w in undisclosed if w.get("severity") == "medium")
    score -= min(40, high_undisclosed * 15 + med_undisclosed * 8)
    score -= min(20, max(0, 3 - len(stated_limitations)) * 5) if has_section else 0
    score = max(0, score)

    return {
        "has_section": has_section,
        "section_name": section_name,
        "stated_limitations": stated_limitations,
        "implicit_weaknesses": implicit_weaknesses,
        "undisclosed": undisclosed,
        "score": score,
    }
