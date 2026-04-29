"""
Abstract ↔ Conclusion Alignment Checker.

Extracts the abstract and conclusion from GROBID output, then uses
GPT-4o-mini to identify key claims in each and match them.
"""

import json
import os
from lxml import etree

NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def _extract_abstract(xml_str: str) -> str:
    """Pull abstract text from TEI profileDesc."""
    try:
        root = etree.fromstring(xml_str.encode())
        abstract_el = root.find(".//tei:profileDesc//tei:abstract", NS)
        if abstract_el is None:
            return ""
        return " ".join(abstract_el.itertext()).strip()
    except Exception:
        return ""


def _extract_conclusion(xml_str: str) -> str:
    """Pull conclusion section text from TEI body."""
    try:
        root = etree.fromstring(xml_str.encode())
        body = root.find(".//tei:body", NS)
        if body is None:
            return ""

        conclusion_text = []
        for div in body.findall(".//tei:div", NS):
            head_el = div.find("tei:head", NS)
            heading = (head_el.text or "").strip().lower() if head_el is not None else ""
            if any(kw in heading for kw in ["conclusion", "summary", "discussion"]):
                for p in div.findall(".//tei:p", NS):
                    text = " ".join(p.itertext()).strip()
                    if text:
                        conclusion_text.append(text)

        return " ".join(conclusion_text)
    except Exception:
        return ""


def _match_claims_with_llm(abstract: str, conclusion: str) -> dict:
    """Use GPT-4o-mini to extract and match claims between abstract and conclusion."""
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    prompt = f"""You are a scientific paper reviewer.

Given an abstract and a conclusion section of a paper, extract the key claims/contributions from each
and identify which ones match (are reflected in both sections) and which are only in one.

Abstract:
{abstract[:3000]}

Conclusion:
{conclusion[:3000]}

Return a JSON object with this exact structure:
{{
  "abstract_claims": [
    {{"text": "short phrase summarizing the claim", "has_match": true, "match_index": 0}},
    {{"text": "...", "has_match": false, "match_index": null}}
  ],
  "conclusion_claims": [
    {{"text": "short phrase summarizing the claim", "has_match": true, "match_index": 0}},
    {{"text": "...", "has_match": false, "match_index": null}}
  ]
}}

Rules:
- Extract 3-6 key claims per section (short, ≤15 words each)
- "match_index" is the index into the OTHER section's array that this claim matches
- Claims with "has_match": true must have a valid "match_index"
- Claims with "has_match": false must have "match_index": null
- Only return the JSON, no extra text
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content or "{}"
    return json.loads(content)


def run_alignment(parsed: dict) -> dict:
    """Main entry point. parsed is the GROBID output dict."""
    raw_xml = parsed.get("raw_xml", "")

    abstract = _extract_abstract(raw_xml)
    conclusion = _extract_conclusion(raw_xml)

    # Fallback: use metadata abstract if XML extraction failed
    if not abstract:
        abstract = parsed.get("metadata", {}).get("abstract", "")

    if not abstract and not conclusion:
        return {
            "abstract_text": "",
            "conclusion_text": "",
            "abstract_claims": [],
            "conclusion_claims": [],
            "found": False,
        }

    try:
        matched = _match_claims_with_llm(abstract, conclusion)
    except Exception as e:
        print(f"[alignment] LLM call failed: {e}")
        matched = {"abstract_claims": [], "conclusion_claims": []}

    return {
        "abstract_text": abstract[:1500],
        "conclusion_text": conclusion[:1500],
        "abstract_claims": matched.get("abstract_claims", []),
        "conclusion_claims": matched.get("conclusion_claims", []),
        "found": bool(abstract and conclusion),
    }
