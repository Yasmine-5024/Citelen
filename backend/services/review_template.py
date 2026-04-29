"""
Auto-Generate Review Template
==============================
Uses the paper's sections (+ optional cached analysis enrichment) to generate
a pre-filled peer review template: summary, strengths, weaknesses, questions,
and an initial recommendation.
"""

from __future__ import annotations

import os
import json
from openai import OpenAI
from services.section_extractor import extract_sections

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _build_enrichment_block(enrichment: dict) -> str:
    parts = []

    lim = enrichment.get("limitations")
    if lim:
        has = lim.get("has_section", False)
        stated = lim.get("stated_limitations", [])
        undisclosed = lim.get("undisclosed", [])
        parts.append(
            f"LIMITATIONS ANALYSIS:\n"
            f"- Has dedicated section: {'Yes' if has else 'No'}\n"
            f"- Stated limitations: {len(stated)}\n"
            f"- Undisclosed weaknesses found: {len(undisclosed)}"
        )
        if undisclosed:
            for w in undisclosed[:3]:
                parts[-1] += f"\n  * [{w.get('severity','low').upper()}] {w.get('text','')}"

    stats = enrichment.get("stats")
    if stats:
        score = stats.get("score", 100)
        issues = stats.get("issues", [])
        parts.append(
            f"STATISTICAL REPORTING:\n"
            f"- Quality score: {score}/100\n"
            f"- Issues found: {len(issues)}"
        )
        if issues:
            high = [i for i in issues if i.get("severity") == "high"]
            if high:
                parts[-1] += f"\n  * High-severity: {len(high)} issues"

    integrity = enrichment.get("integrity")
    if integrity:
        summary = integrity.get("summary", {})
        oc = summary.get("overclaim_issues", 0)
        fw = summary.get("fairness_issues", 0)
        if oc or fw:
            parts.append(
                f"INTEGRITY:\n"
                f"- Overclaim issues: {oc}\n"
                f"- Related work fairness issues: {fw}"
            )

    return "\n\n".join(parts)


def generate_review_template(parsed: dict, enrichment: dict | None = None) -> dict:
    metadata = parsed.get("metadata", {})
    title = metadata.get("title", "Untitled Paper")
    authors = metadata.get("authors", [])
    abstract = metadata.get("abstract", "")
    raw_xml = parsed.get("raw_xml", "")

    sections = extract_sections(raw_xml) if raw_xml else {}

    intro_text = methods_text = results_text = conclusion_text = ""
    for heading, items in sections.items():
        h = heading.lower()
        text = " ".join(s["text"] for s in items[:6])
        if any(k in h for k in ("introduction", "intro", "background")):
            intro_text += text + " "
        elif any(k in h for k in ("method", "approach", "framework", "model", "proposed")):
            methods_text += text + " "
        elif any(k in h for k in ("result", "experiment", "evaluation", "finding", "performance")):
            results_text += text + " "
        elif any(k in h for k in ("conclusion", "summary", "discussion")):
            conclusion_text += text + " "

    paper_context = (
        f"TITLE: {title}\n"
        f"AUTHORS: {', '.join(authors[:5]) if authors else 'Unknown'}\n"
        f"ABSTRACT: {abstract[:800]}\n"
        f"INTRODUCTION (excerpt): {intro_text[:500]}\n"
        f"METHODS (excerpt): {methods_text[:500]}\n"
        f"RESULTS (excerpt): {results_text[:500]}\n"
        f"CONCLUSION (excerpt): {conclusion_text[:500]}"
    )

    enrichment_block = _build_enrichment_block(enrichment or {})
    if enrichment_block:
        paper_context += f"\n\nANALYSIS CONTEXT (from automated tools):\n{enrichment_block}"

    system = (
        "You are an expert academic peer reviewer. Generate a structured, constructive "
        "review template for the given paper. Be specific and evidence-based — reference "
        "concrete details from the paper, not generic phrases.\n\n"
        "If analysis context is provided, use it to inform weaknesses and questions.\n\n"
        "Return JSON with exactly these keys:\n"
        '"paper_summary": string (2-3 sentences: what the paper does, its main claim, approach)\n'
        '"strengths": array of 3-5 strings (specific strengths with evidence)\n'
        '"weaknesses": array of 3-5 strings (specific concerns, avoid vague criticism)\n'
        '"questions": array of 3-4 strings (direct questions to authors)\n'
        '"recommendation": "accept"|"minor_revision"|"major_revision"|"reject"\n'
        '"recommendation_note": string (one sentence justifying the recommendation)'
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": paper_context},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=1500,
        )
        raw = json.loads(resp.choices[0].message.content)  # type: ignore[arg-type]
        return {
            "paper_summary": raw.get("paper_summary", ""),
            "strengths": raw.get("strengths", []),
            "weaknesses": raw.get("weaknesses", []),
            "questions": raw.get("questions", []),
            "recommendation": raw.get("recommendation", "major_revision"),
            "recommendation_note": raw.get("recommendation_note", ""),
        }
    except Exception as e:
        print(f"[review_template] GPT error: {e}")
        return {
            "paper_summary": "",
            "strengths": [],
            "weaknesses": [],
            "questions": [],
            "recommendation": "major_revision",
            "recommendation_note": "Review generation failed — please retry.",
        }
