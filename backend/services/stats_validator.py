"""
Statistical Reporting Validator
================================
Scans the paper for statistical claims and validates reporting completeness:
- p-values without confidence intervals
- missing effect sizes
- claims of significance without proper test statistics
- bare correlations without CIs
- missing sample sizes
"""

from __future__ import annotations

import os
import re
import json
from openai import OpenAI
from services.section_extractor import extract_sections

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

_STAT_SENTENCE_RE = re.compile(
    r"\b(significant(?:ly)?|p\s*[=<>≤≥]\s*[0-9]|correlation|regression|t-test|anova|"
    r"chi.square|chi.squared|mean\s*=|SD\s*=|SE\s*=|F\s*\(|t\s*\(\d+\)|r\s*=\s*[-+]?[0-9\.]|"
    r"β\s*=|OR\s*=|HR\s*=|RR\s*=|cohen|effect\s+size|standardized|"
    r"95%|confidence\s+interval|odds\s+ratio|hazard\s+ratio|risk\s+ratio|"
    r"wilcoxon|mann.whitney|kruskal|spearman|pearson|logistic\s+regression|"
    r"linear\s+regression|mixed.model|repeated.measure)\b",
    re.IGNORECASE,
)
_RESULT_SECTION_RE = re.compile(
    r"\b(result|finding|statistic|analysis|outcome|measure|experiment|evaluation|method)\b",
    re.IGNORECASE,
)


def _collect_stat_sentences(sections: dict, abstract: str) -> list[dict]:
    sents: list[dict] = []

    for heading, items in sections.items():
        if _RESULT_SECTION_RE.search(heading):
            for item in items:
                t = item["text"]
                if len(t) > 20 and _STAT_SENTENCE_RE.search(t):
                    sents.append({"text": t, "section": heading})

    if abstract:
        for sent in re.split(r"(?<=[.!?])\s+", abstract):
            if len(sent) > 20 and _STAT_SENTENCE_RE.search(sent):
                sents.append({"text": sent, "section": "Abstract"})

    return sents[:30]


def _gpt_validate_stats(stat_sents: list[dict]) -> dict:
    if not stat_sents:
        return {"issues": [], "total_found": 0, "properly_reported": 0}

    items_text = "\n".join(
        f'{i+1}. [Section: {s["section"]}] "{s["text"]}"'
        for i, s in enumerate(stat_sents)
    )
    system = (
        "You are a statistician peer reviewer checking statistical reporting in academic papers.\n\n"
        "For each sentence containing statistical claims, assess best-practice compliance:\n"
        "- p-values should be reported with effect sizes AND confidence intervals\n"
        "- Effect sizes (Cohen's d, r, OR, HR) should have 95% CIs\n"
        "- Significance claims need the actual test statistic + df + p-value\n"
        "- Correlations need sample size + CI\n"
        "- Comparisons need test statistic, df, p-value\n\n"
        "Return JSON with exactly these keys:\n"
        '"issues": [{"sentence": "...", "issue_type": '
        '"missing_ci"|"missing_effect_size"|"missing_n"|"bare_p_value"|'
        '"informal_significance"|"missing_test_stat", '
        '"severity": "high"|"medium"|"low", "suggestion": "brief specific fix", "section": "..."}]\n'
        '"total_found": integer (how many statistical claims found)\n'
        '"properly_reported": integer (how many are fully compliant)\n\n'
        "Only flag genuine reporting gaps. Ignore qualitative observations."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": items_text},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw = json.loads(resp.choices[0].message.content)
        return {
            "issues": raw.get("issues", []),
            "total_found": raw.get("total_found", len(stat_sents)),
            "properly_reported": raw.get("properly_reported", 0),
        }
    except Exception as e:
        print(f"[stats_validator] GPT error: {e}")
        return {"issues": [], "total_found": len(stat_sents), "properly_reported": 0}


def validate_statistics(parsed: dict) -> dict:
    raw_xml = parsed.get("raw_xml", "")
    abstract = parsed.get("metadata", {}).get("abstract", "")
    sections = extract_sections(raw_xml) if raw_xml else {}

    stat_sents = _collect_stat_sentences(sections, abstract)

    if not stat_sents:
        return {
            "issues": [],
            "total_stats_found": 0,
            "properly_reported": 0,
            "score": 100,
            "summary": "No statistical claims detected in this paper.",
        }

    result = _gpt_validate_stats(stat_sents)
    issues = result["issues"]
    total = max(result["total_found"], len(stat_sents))
    properly = result["properly_reported"]

    high_issues = sum(1 for i in issues if i.get("severity") == "high")
    med_issues = sum(1 for i in issues if i.get("severity") == "medium")
    deduction = high_issues * 15 + med_issues * 8
    score = max(0, 100 - deduction)

    if len(issues) == 0:
        summary = f"All {total} statistical claims appear properly reported."
    elif len(issues) <= 2:
        summary = f"Minor reporting gaps in {len(issues)} of {total} statistical claims."
    else:
        summary = f"{len(issues)} reporting issues found across {total} statistical claims."

    return {
        "issues": issues,
        "total_stats_found": total,
        "properly_reported": properly,
        "score": score,
        "summary": summary,
    }
