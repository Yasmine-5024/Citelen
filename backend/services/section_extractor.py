"""
Parse a GROBID TEI XML string into a section-by-section view.

Returns:
    {
        "Introduction": [
            {"text": "...", "has_citation": True, "word_count": 28},
            ...
        ],
        ...
    }
"""

import re
from lxml import etree

NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def _split_sentences(text: str) -> list[str]:
    """Naive sentence splitter — splits on '. ', '! ', '? '."""
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 20]


def extract_sections(xml_str: str) -> dict[str, list[dict]]:
    """
    Parse TEI XML body into sections.  Each sentence is tagged with
    whether it contains a citation reference and its word count.
    """
    try:
        root = etree.fromstring(xml_str.encode())
    except Exception:
        return {}

    body = root.find(".//tei:body", NS)
    if body is None:
        return {}

    sections: dict[str, list[dict]] = {}

    # Build a child->parent map so headingless divs can inherit from parent
    parent_map = {child: parent for parent in body.iter() for child in parent}

    for div in body.findall(".//tei:div", NS):
        # Section heading — walk up to nearest ancestor div with a <head> if needed
        head_el = div.find("tei:head", NS)
        heading = head_el.text.strip() if head_el is not None and head_el.text else None

        if not heading:
            ancestor = parent_map.get(div)
            while ancestor is not None:
                anc_head = ancestor.find("tei:head", NS)
                if anc_head is not None and anc_head.text and anc_head.text.strip():
                    heading = anc_head.text.strip()
                    break
                ancestor = parent_map.get(ancestor)

        if not heading:
            heading = "Body"

        sentences: list[dict] = []

        for p in div.findall("tei:p", NS):
            # Check if this paragraph has any citation refs
            has_any_ref = bool(p.findall(".//tei:ref[@type='bibr']", NS))

            # Get full paragraph text
            full_text = "".join(p.itertext()).strip()
            if not full_text:
                continue

            # Split into sentences, keeping citation context per sentence
            for sent in _split_sentences(full_text):
                # Heuristic: a sentence has a citation if it contains [ or ]
                sent_has_cite = bool(re.search(r'\[[\d,\s\-]+\]', sent)) or (
                    has_any_ref and len(_split_sentences(full_text)) == 1
                )
                sentences.append({
                    "text": sent,
                    "has_citation": sent_has_cite,
                    "word_count": len(sent.split()),
                })

        if sentences:
            sections[heading] = sentences

    return sections
