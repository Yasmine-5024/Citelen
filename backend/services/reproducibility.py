"""
Reproducibility Checker.

Scans the full paper text for reproducibility items:
code availability, dataset link, random seed, hardware specs, hyperparameters.

Returns status (found / partial / missing) + the relevant text snippet.
No numeric scores.
"""

import re
from lxml import etree

NS = {"tei": "http://www.tei-c.org/ns/1.0"}

CHECKLIST = [
    {
        "id": "code",
        "label": "Code availability",
        "patterns": [
            r"code\s+(?:is\s+)?(?:available|released|open[\s-]source|public)",
            r"github\.com/\S+",
            r"gitlab\.com/\S+",
            r"implementation\s+(?:is\s+)?(?:available|released|public)",
            r"source\s+code\s+(?:is\s+)?(?:available|provided|released)",
        ],
    },
    {
        "id": "dataset",
        "label": "Dataset availability",
        "patterns": [
            r"dataset\s+(?:is\s+)?(?:available|public|released|open)",
            r"data\s+(?:is\s+)?(?:available|public|released)",
            r"https?://[^\s]+(?:dataset|data)[^\s]*",
            r"huggingface\.co/datasets",
            r"zenodo\.org",
            r"figshare\.com",
            r"benchmark\s+(?:dataset|data)",
        ],
    },
    {
        "id": "seed",
        "label": "Random seed",
        "patterns": [
            r"random\s+seed",
            r"seed\s*[=:]\s*\d+",
            r"fixed\s+seed",
            r"reproducibility.*seed",
            r"set\s+(?:the\s+)?seed",
        ],
    },
    {
        "id": "hardware",
        "label": "Hardware / compute",
        "patterns": [
            r"(?:NVIDIA|AMD|A100|V100|RTX|GTX|TPU|GPU|CPU)\s+\w+",
            r"\d+\s*GPU[s]?",
            r"trained\s+on\s+\d+",
            r"compute\s+(?:resource|cluster|node)",
            r"hours?\s+of\s+(?:training|compute|gpu)",
        ],
    },
    {
        "id": "hyperparams",
        "label": "Hyperparameters",
        "patterns": [
            r"learning\s+rate\s*[=:]\s*[\d.e\-]+",
            r"batch\s+size\s*[=:]\s*\d+",
            r"epoch[s]?\s*[=:]\s*\d+",
            r"dropout\s*[=:]\s*[\d.]+",
            r"weight\s+decay\s*[=:]\s*[\d.e\-]+",
            r"hidden\s+(?:size|dim|units?)\s*[=:]\s*\d+",
            r"layer[s]?\s*[=:]\s*\d+",
            r"hyperparameter",
        ],
    },
]


def _extract_full_text(xml_str: str) -> str:
    """Get all body + abstract text from TEI XML."""
    try:
        root = etree.fromstring(xml_str.encode())
        parts = []
        for el in root.findall(".//tei:abstract", NS):
            parts.append(" ".join(el.itertext()))
        for el in root.findall(".//tei:body", NS):
            parts.append(" ".join(el.itertext()))
        return " ".join(parts)
    except Exception:
        return ""


def _find_snippet(text: str, pattern: str, window: int = 120) -> str | None:
    """Return a short context snippet around the first regex match."""
    m = re.search(pattern, text, re.IGNORECASE)
    if not m:
        return None
    start = max(0, m.start() - 40)
    end = min(len(text), m.end() + window)
    snippet = text[start:end].strip()
    # Clean up whitespace
    snippet = re.sub(r'\s+', ' ', snippet)
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet


def _check_item(item: dict, text: str) -> dict:
    """Check a single checklist item against the full text."""
    matched_snippets = []
    for pattern in item["patterns"]:
        snippet = _find_snippet(text, pattern)
        if snippet and snippet not in matched_snippets:
            matched_snippets.append(snippet)

    if not matched_snippets:
        return {
            "id": item["id"],
            "label": item["label"],
            "status": "missing",
            "text": None,
        }

    # If only one pattern matched or match is weak → partial
    status = "found" if len(matched_snippets) >= 2 else "partial"

    return {
        "id": item["id"],
        "label": item["label"],
        "status": status,
        "text": matched_snippets[0],
    }


def run_reproducibility(parsed: dict) -> dict:
    """Main entry point. parsed is the GROBID output dict."""
    raw_xml = parsed.get("raw_xml", "")
    full_text = _extract_full_text(raw_xml)

    if not full_text:
        return {
            "items": [
                {"id": item["id"], "label": item["label"], "status": "missing", "text": None}
                for item in CHECKLIST
            ],
            "found": False,
        }

    results = [_check_item(item, full_text) for item in CHECKLIST]

    return {
        "items": results,
        "found": True,
    }
