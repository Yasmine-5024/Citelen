"""
Reference Format Consistency Checker
=====================================
Analyses GROBID-parsed citation metadata for formatting inconsistencies.
No AI calls — purely deterministic pattern matching.

Checks:
  1. Missing fields        — year / venue / authors / title absent
  2. ALL-CAPS titles       — likely copy-paste artifact
  3. Title case style mix  — some Title Case, some sentence case
  4. DOI format mix        — https://doi.org/ vs raw 10.xxx vs dx.doi.org
  5. Author name format    — Last, First vs First Last inconsistency
  6. Potential duplicates  — title word-overlap > 80%
  7. Year outliers         — year < 1900 or year > 2025
"""

from collections import Counter
import re


# ── Helpers ───────────────────────────────────────────────────────────────────

_STOP = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "its",
    "this", "that", "into", "via", "vs", "using",
}


def _title_style(title: str) -> str:
    """Return 'allcaps', 'titlecase', 'sentencecase', or 'unknown'."""
    if not title:
        return "unknown"
    letters = [c for c in title if c.isalpha()]
    if not letters:
        return "unknown"
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    if upper_ratio > 0.70:
        return "allcaps"
    words = title.split()
    # Significant words = not stop, not first, length > 1
    sig = [w for w in words[1:] if w.lower().rstrip(".,;:") not in _STOP and len(w) > 1]
    if not sig:
        return "unknown"
    cap_ratio = sum(1 for w in sig if w[0].isupper()) / len(sig)
    return "titlecase" if cap_ratio >= 0.55 else "sentencecase"


def _doi_style(doi: str | None) -> str | None:
    if not doi:
        return None
    d = doi.strip()
    if d.startswith("https://doi.org/"):
        return "https_doi_org"
    if "dx.doi.org" in d:
        return "dx_doi_org"
    if d.lower().startswith("doi:"):
        return "doi_colon"
    if d.startswith("10."):
        return "raw"
    return "other"


def _author_style(authors: list) -> str:
    """Detect 'last_first' (contains comma) or 'first_last' or 'unknown'."""
    for a in (authors or []):
        if isinstance(a, str) and "," in a:
            return "last_first"
    for a in (authors or []):
        if isinstance(a, str):
            parts = a.strip().split()
            if len(parts) >= 2:
                return "first_last"
    return "unknown"


def _stub(c: dict) -> dict:
    return {"citation_id": c.get("id", "?"), "title": (c.get("title") or "")[:80]}


# ── Main ──────────────────────────────────────────────────────────────────────

def check_format_consistency(parsed: dict) -> dict:
    citations = parsed.get("citations", [])
    if not citations:
        return {
            "issues": [],
            "summary": {"total_issues": 0, "errors": 0, "warnings": 0, "info": 0,
                        "score": 100, "by_type": {}, "total_citations": 0},
        }

    issues: list[dict] = []

    def add(severity: str, issue_type: str, c: dict, detail: str):
        issues.append({
            "severity": severity,
            "type": issue_type,
            "detail": detail,
            **_stub(c),
        })

    # ── 1. Missing fields ─────────────────────────────────────────────────────
    for c in citations:
        if not c.get("year"):
            add("warning", "missing_year", c, "No publication year — reviewers may flag this.")
        if not c.get("venue") and not c.get("doi"):
            add("info", "missing_venue", c, "No venue or DOI recorded.")
        if not c.get("authors"):
            add("warning", "missing_authors", c, "No authors listed.")
        if not c.get("title"):
            add("error", "missing_title", c, "Reference has no title.")

    # ── 2. ALL-CAPS titles ────────────────────────────────────────────────────
    for c in citations:
        if _title_style(c.get("title", "")) == "allcaps":
            add("warning", "title_allcaps", c,
                "Title is in ALL CAPS — likely a copy-paste formatting artifact.")

    # ── 3. Title case style inconsistency ─────────────────────────────────────
    titled = [(c, _title_style(c.get("title", ""))) for c in citations if c.get("title")]
    style_counts = Counter(s for _, s in titled if s in ("titlecase", "sentencecase"))
    if style_counts.get("titlecase", 0) >= 3 and style_counts.get("sentencecase", 0) >= 3:
        dominant = "titlecase" if style_counts["titlecase"] >= style_counts["sentencecase"] else "sentencecase"
        minority = "sentencecase" if dominant == "titlecase" else "titlecase"
        minority_label = "sentence case" if minority == "sentencecase" else "Title Case"
        dominant_label = "sentence case" if dominant == "sentencecase" else "Title Case"
        for c, s in titled:
            if s == minority:
                add("info", "title_case_mix", c,
                    f"Uses {minority_label} while most references use {dominant_label}.")

    # ── 4. DOI format inconsistency ───────────────────────────────────────────
    doi_styles = [(c, _doi_style(c.get("doi"))) for c in citations if c.get("doi")]
    doi_counts = Counter(s for _, s in doi_styles if s)
    if len(doi_counts) > 1:
        dominant_doi = doi_counts.most_common(1)[0][0]
        for c, s in doi_styles:
            if s and s != dominant_doi:
                add("info", "doi_format_mix", c,
                    f"DOI format '{c.get('doi', '')[:50]}' differs from the dominant style.")

    # ── 5. Author name format inconsistency ───────────────────────────────────
    author_styles = [(c, _author_style(c.get("authors", [])))
                     for c in citations if c.get("authors")]
    af_counts = Counter(s for _, s in author_styles if s != "unknown")
    if af_counts.get("last_first", 0) >= 2 and af_counts.get("first_last", 0) >= 2:
        dominant_af = af_counts.most_common(1)[0][0]
        for c, s in author_styles:
            if s != dominant_af and s != "unknown":
                label = "First Last" if s == "first_last" else "Last, First"
                dom_label = "First Last" if dominant_af == "first_last" else "Last, First"
                add("info", "author_format_mix", c,
                    f"Author format '{label}' differs from dominant '{dom_label}'.")

    # ── 6. Potential duplicates ───────────────────────────────────────────────
    titled_cits = [
        (c, set(re.sub(r"[^\w\s]", "", c.get("title", "")).lower().split()))
        for c in citations
        if c.get("title") and len(c.get("title", "").split()) > 4
    ]
    seen_dupes: set = set()
    for i in range(len(titled_cits)):
        for j in range(i + 1, len(titled_cits)):
            ca, wa = titled_cits[i]
            cb, wb = titled_cits[j]
            if not wa or not wb:
                continue
            overlap = len(wa & wb) / max(len(wa), len(wb))
            if overlap >= 0.80:
                pair = tuple(sorted([ca.get("id"), cb.get("id")]))
                if pair not in seen_dupes:
                    seen_dupes.add(pair)
                    add("error", "duplicate", ca,
                        f"Possible duplicate of {cb.get('id')} — titles have {round(overlap*100)}% word overlap.")

    # ── 7. Year outliers ──────────────────────────────────────────────────────
    for c in citations:
        year = c.get("year")
        if year and isinstance(year, int):
            if year < 1900:
                add("error", "year_outlier", c,
                    f"Year {year} is implausibly old — possible data entry error.")
            elif year > 2025:
                add("warning", "year_outlier", c,
                    f"Year {year} is in the future — check if this is a preprint or typo.")

    # ── Summary ───────────────────────────────────────────────────────────────
    errors   = sum(1 for i in issues if i["severity"] == "error")
    warnings = sum(1 for i in issues if i["severity"] == "warning")
    info     = sum(1 for i in issues if i["severity"] == "info")
    by_type  = dict(Counter(i["type"] for i in issues))

    # Score: start 100, deduct per severity
    score = max(0, min(100, 100 - errors * 10 - warnings * 4 - info * 1))

    print(f"[format-check] {len(citations)} citations → {len(issues)} issues "
          f"(errors={errors} warnings={warnings} info={info}) score={score}")

    return {
        "issues": issues,
        "summary": {
            "total_issues": len(issues),
            "errors": errors,
            "warnings": warnings,
            "info": info,
            "score": score,
            "by_type": by_type,
            "total_citations": len(citations),
        },
    }
