"""
Citation Bias Service
=====================
Computes bias metrics purely from GROBID-parsed citation metadata.
No AI calls required.

Returns:
- most_cited_authors: top authors by citation count (with self-cite flag)
- year_distribution: citation counts bucketed by publication year
- self_citation_rate: % of citations where an author overlaps with the paper's authors
- total_citations: total number of citations processed
- median_year: median publication year
- recency_score: % of citations from last 5 years
"""

from collections import Counter
from statistics import median


def _normalize_name(name: str) -> str:
    """Lowercase, strip, collapse spaces."""
    return " ".join(name.lower().split())


def _extract_last_name(name: str) -> str:
    """
    Extract last name for self-cite detection.
      'Smith, J.' → 'smith'
      'John Smith' → 'smith'
    """
    name = name.strip()
    if "," in name:
        return name.split(",")[0].strip().lower()
    parts = name.split()
    return parts[-1].lower() if parts else name.lower()


def _to_display_name(name: str) -> str:
    """
    Convert GROBID author name to a readable 'First Last' format.
      'Smith, John' → 'John Smith'
      'Smith, J.'   → 'J. Smith'
      'John Smith'  → 'John Smith'  (unchanged)
    """
    name = name.strip()
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        last, first = parts[0], parts[1] if len(parts) > 1 else ""
        return f"{first} {last}".strip() if first else last
    return name


def _name_key(name: str) -> str:
    """
    Stable grouping key: normalize to 'last,firstinitial' so
    'Smith, John' and 'Smith, J.' map to the same bucket.
    """
    name = name.strip()
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        last = parts[0].lower()
        first = parts[1].lower() if len(parts) > 1 else ""
    else:
        tokens = name.split()
        last = tokens[-1].lower() if tokens else name.lower()
        first = tokens[0].lower() if len(tokens) > 1 else ""
    first_initial = first[0] if first else ""
    return f"{last},{first_initial}"


CONFERENCE_KEYWORDS = {
    "proc", "conference", "symposium", "acl", "emnlp", "naacl", "iclr", "icml",
    "neurips", "nips", "aaai", "cvpr", "iccv", "eccv", "interspeech", "icassp",
    "coling", "findings", "annual meeting", "workshop",
}
JOURNAL_KEYWORDS = {
    "journal", "transactions", "letters", "review", "science", "nature",
    "magazine", "bulletin", "quarterly",
}
PREPRINT_KEYWORDS = {"arxiv", "preprint", "biorxiv", "medrxiv", "ssrn"}

def _classify_venue(venue: str) -> str:
    if not venue or not venue.strip():
        return "Unknown"
    v = venue.lower()
    if any(k in v for k in PREPRINT_KEYWORDS):
        return "Preprint"
    if any(k in v for k in JOURNAL_KEYWORDS):
        return "Journal"
    if any(k in v for k in CONFERENCE_KEYWORDS):
        return "Conference"
    return "Unknown"


def build_citation_bias(parsed: dict) -> dict:
    """
    Main entry point. Takes GROBID parsed output, returns CitationBiasData.
    """
    citations = parsed.get("citations", [])
    paper_authors = parsed.get("metadata", {}).get("authors", [])

    if not citations:
        return {
            "most_cited_authors": [],
            "year_distribution": [],
            "self_citation_rate": 0.0,
            "total_citations": 0,
            "median_year": None,
            "recency_score": 0.0,
            "venue_distribution": [],
            "min_year": None,
        }

    # Build set of paper's own author last names for self-cite detection
    paper_last_names: set[str] = set()
    for a in paper_authors:
        ln = _extract_last_name(a) if isinstance(a, str) else ""
        if ln:
            paper_last_names.add(ln)

    # ── Most cited authors ────────────────────────────────────────────────────
    # Group by (last, first_initial) key so "Smith, John" and "Smith, J." merge
    author_counts: Counter = Counter()
    # key → best raw name (longest = most complete)
    author_raw: dict[str, str] = {}

    for cit in citations:
        for author in (cit.get("authors") or []):
            if not author or not author.strip():
                continue
            key = _name_key(author)
            if key:
                author_counts[key] += 1
                # Keep the longest raw name (more complete)
                if key not in author_raw or len(author) > len(author_raw[key]):
                    author_raw[key] = author.strip()

    # Top 12 authors
    top_authors = []
    for key, count in author_counts.most_common(12):
        raw = author_raw.get(key, key)
        display = _to_display_name(raw)
        last = _extract_last_name(raw)
        top_authors.append({
            "name": display,
            "count": count,
            "is_self": last in paper_last_names,
        })

    # ── Year distribution ─────────────────────────────────────────────────────
    years = [
        cit["year"] for cit in citations
        if cit.get("year") and isinstance(cit["year"], int) and 1900 < cit["year"] <= 2030
    ]

    year_counter: Counter = Counter(years)

    # Bucket: everything before 2010 grouped, then per-year from 2010+
    CUTOFF = 2010
    pre_count = sum(v for y, v in year_counter.items() if y < CUTOFF)
    year_dist = []

    # Build per-bucket citation lists for drill-down
    citations_by_year: dict[str, list] = {}

    def _cit_stub(c: dict) -> dict:
        return {"id": c.get("id", ""), "title": c.get("title") or "Unknown", "year": c.get("year")}

    if pre_count > 0:
        year_dist.append({"year": f"<{CUTOFF}", "count": pre_count})
        citations_by_year[f"<{CUTOFF}"] = [
            _cit_stub(c) for c in citations
            if isinstance(c.get("year"), int) and 1900 < c["year"] < CUTOFF
        ]

    for y in sorted(y for y in year_counter if y >= CUTOFF):
        year_dist.append({"year": str(y), "count": year_counter[y]})
        citations_by_year[str(y)] = [
            _cit_stub(c) for c in citations
            if c.get("year") == y
        ]

    # ── Self-citation rate ────────────────────────────────────────────────────
    self_cite_count = 0
    for cit in citations:
        for author in (cit.get("authors") or []):
            if not author:
                continue
            if _extract_last_name(author) in paper_last_names:
                self_cite_count += 1
                break  # count each citation once

    total = len(citations)
    self_cite_rate = round(self_cite_count / total * 100, 1) if total else 0.0

    # ── Median year + recency ─────────────────────────────────────────────────
    med_year = int(median(years)) if years else None
    current_year = 2025
    recent_count = sum(1 for y in years if y >= current_year - 5)
    recency_score = round(recent_count / len(years) * 100, 1) if years else 0.0

    # ── Venue distribution ────────────────────────────────────────────────────
    venue_counter: Counter = Counter(
        _classify_venue(cit.get("venue", "")) for cit in citations
    )
    venue_distribution = [
        {"type": vtype, "count": cnt}
        for vtype, cnt in sorted(venue_counter.items(), key=lambda x: -x[1])
        if cnt > 0
    ]
    min_year = int(min(years)) if years else None

    print(f"[bias] {total} citations, {len(top_authors)} top authors, "
          f"self_cite={self_cite_rate}%, recency={recency_score}%")

    return {
        "most_cited_authors": top_authors,
        "year_distribution": year_dist,
        "citations_by_year": citations_by_year,
        "self_citation_rate": self_cite_rate,
        "total_citations": total,
        "median_year": med_year,
        "recency_score": recency_score,
        "venue_distribution": venue_distribution,
        "min_year": min_year,
    }
