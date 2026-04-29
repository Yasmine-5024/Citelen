"""
Heuristic AI-citation detector.

Scores each GROBID citation 0–100 for likelihood of being AI-generated,
based on signals known to correlate with hallucinated references.
"""

from __future__ import annotations
import re
from datetime import datetime
from typing import TypedDict


CURRENT_YEAR = datetime.now().year

# Patterns common in AI-hallucinated titles
VAGUE_TITLE_PATTERNS = [
    re.compile(r"^(a|an|the) (survey|review|study|analysis|overview|introduction|comprehensive|novel|new|improved|efficient|deep|advanced) ", re.I),
    re.compile(r"\b(deep learning|machine learning|neural network|artificial intelligence)\b.*\b(survey|review|overview)\b", re.I),
]

# Journal/conference names that AI models commonly invent
SUSPICIOUS_VENUES = {
    "international journal of advanced research",
    "journal of advanced research",
    "international journal of computer science",
    "global journal",
    "american journal of",
    "world journal of",
    "asian journal of",
    "european journal of advanced",
}


class Signal(TypedDict):
    signal: str
    count: int


class AIResult(TypedDict):
    id: str
    title: str
    source: str
    aiScore: int
    flags: list[str]
    status: str
    doi: str | None
    year: int | None


def score_citation(citation: dict) -> AIResult:
    """Return an AIResult dict for a single GROBID citation."""
    flags: list[str] = []
    score = 0

    title: str = citation.get("title") or ""
    authors: list[str] = citation.get("authors") or []
    year: int | None = citation.get("year")
    doi: str | None = citation.get("doi")
    venue: str = citation.get("venue") or ""

    # --- Title signals ---
    if not title.strip():
        flags.append("no title")
        score += 35
    else:
        if len(title) < 10:
            flags.append("suspiciously short title")
            score += 20
        for pat in VAGUE_TITLE_PATTERNS:
            if pat.search(title):
                flags.append("generic AI-style title")
                score += 15
                break
        # All caps / title case words that look machine-generated
        if title == title.upper() and len(title) > 5:
            flags.append("all-caps title")
            score += 10

    # --- Author signals ---
    if not authors:
        flags.append("no authors")
        score += 25
    elif len(authors) == 1 and len(authors[0]) < 4:
        flags.append("single very short author name")
        score += 15

    # --- Year signals ---
    if year is None:
        flags.append("no year")
        score += 20
    elif year > CURRENT_YEAR:
        flags.append(f"future year ({year})")
        score += 40
    elif year < 1900:
        flags.append(f"implausible year ({year})")
        score += 30
    elif year > CURRENT_YEAR - 1:
        # Very recent — not suspicious on its own, but worth noting
        pass

    # --- DOI signals ---
    if not doi:
        flags.append("no DOI")
        score += 10
    else:
        # DOI should start with 10.
        if not doi.startswith("10."):
            flags.append("malformed DOI")
            score += 25
        # Suspiciously short DOIs
        if len(doi) < 8:
            flags.append("suspicious DOI length")
            score += 20

    # --- Venue signals ---
    if venue:
        venue_lower = venue.lower().strip()
        for sv in SUSPICIOUS_VENUES:
            if sv in venue_lower:
                flags.append("suspicious venue name")
                score += 20
                break
        if len(venue_lower) < 4:
            flags.append("very short venue")
            score += 10

    # Cap at 100
    score = min(score, 100)

    if score >= 60:
        status = "ai_likely"
    elif score >= 30:
        status = "uncertain"
    else:
        status = "human"

    # Build a readable source line
    author_str = ", ".join(authors[:2]) + (" et al." if len(authors) > 2 else "") if authors else "Unknown"
    year_str = str(year) if year else "n.d."
    source = f"{author_str} ({year_str})"

    return AIResult(
        id=citation["id"],
        title=title or "(no title)",
        source=source,
        aiScore=score,
        flags=flags,
        status=status,
        doi=doi,
        year=year,
    )


def detect(citations: list[dict]) -> dict:
    """Run AI detection over all citations and return a structured report."""
    results: list[AIResult] = [score_citation(c) for c in citations]

    ai_likely = sum(1 for r in results if r["status"] == "ai_likely")
    uncertain = sum(1 for r in results if r["status"] == "uncertain")
    human = sum(1 for r in results if r["status"] == "human")
    total = len(results)
    ai_rate = round((ai_likely / total * 100)) if total else 0

    # Aggregate signals
    signal_counts: dict[str, int] = {}
    for r in results:
        for f in r["flags"]:
            signal_counts[f] = signal_counts.get(f, 0) + 1

    signals = [
        {"signal": s, "count": c}
        for s, c in sorted(signal_counts.items(), key=lambda x: -x[1])
        if c >= 2  # only show signals that appear multiple times
    ]

    return {
        "citations": results,
        "signals": signals,
        "summary": {
            "ai_likely": ai_likely,
            "uncertain": uncertain,
            "human": human,
            "ai_rate": ai_rate,
        },
    }
