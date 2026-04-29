import requests
from lxml import etree

GROBID_URL = "http://localhost:8070"
NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def extract_with_grobid(pdf_path: str) -> dict:
    """Send PDF to GROBID, get back structured citations + metadata."""

    with open(pdf_path, "rb") as f:
        response = requests.post(
            f"{GROBID_URL}/api/processFulltextDocument",
            files={"input": f},
            data={"consolidateCitations": "1"},  # verifies against Crossref
            timeout=60,
        )

    if response.status_code != 200:
        raise Exception(f"GROBID failed: {response.status_code}")

    return parse_tei(response.text)


def parse_tei(xml_str: str) -> dict:
    root = etree.fromstring(xml_str.encode())

    # --- Paper metadata ---
    title = root.findtext(".//tei:titleStmt/tei:title", namespaces=NS) or "Unknown"

    authors = []
    for author in root.findall(".//tei:fileDesc//tei:author", NS):
        surname = author.findtext(".//tei:surname", namespaces=NS) or ""
        forename = author.findtext(".//tei:forename", namespaces=NS) or ""
        if surname:
            authors.append(f"{forename} {surname}".strip())

    # Source paper abstract (lives in <profileDesc><abstract>)
    abstract_el = root.find(".//tei:profileDesc/tei:abstract", NS)
    source_abstract = ""
    if abstract_el is not None:
        source_abstract = " ".join(abstract_el.itertext()).strip()

    # --- Citations ---
    citations = []
    XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
    # Build grobid_id → num mapping while parsing
    grobid_id_to_num: dict[str, int] = {}
    for i, ref in enumerate(root.findall(".//tei:listBibl/tei:biblStruct", NS)):
        num = i + 1
        grobid_id = ref.get(XML_ID, f"b{i}")
        grobid_id_to_num[grobid_id] = num
        citation = parse_citation(ref, num)
        citations.append(citation)

    # --- In-text citation spans ---
    body = root.find(".//tei:body", NS)
    raw_in_text = extract_in_text_citations(body) if body is not None else {}

    # Remap: grobid xml:id keys → citation num keys so lookup is always f"b{num}"
    in_text: dict[str, list] = {}
    for grobid_key, contexts in raw_in_text.items():
        num = grobid_id_to_num.get(grobid_key)
        if num is not None:
            in_text[f"b{num}"] = contexts

    # --- Duplicate detection ---
    # Compare every pair: DOI match (strong) or normalized title match (fuzzy)
    duplicate_map: dict[str, str] = {}  # citation id → duplicate of id
    for i, c1 in enumerate(citations):
        if c1["id"] in duplicate_map:
            continue
        for c2 in citations[i + 1:]:
            if c2["id"] in duplicate_map:
                continue
            is_dup = False
            # DOI match (ignore case)
            if c1.get("doi") and c2.get("doi"):
                is_dup = c1["doi"].strip().lower() == c2["doi"].strip().lower()
            # Title match: normalize and compare
            if not is_dup and c1.get("title") and c2.get("title"):
                t1 = "".join(c1["title"].lower().split())
                t2 = "".join(c2["title"].lower().split())
                if t1 and t2 and t1 == t2:
                    is_dup = True
            if is_dup:
                duplicate_map[c2["id"]] = c1["id"]

    # Attach duplicate_of to each citation
    for c in citations:
        c["duplicate_of"] = duplicate_map.get(c["id"])

    return {
        "metadata": {"title": title, "authors": authors, "abstract": source_abstract},
        "citations": citations,
        "in_text_map": in_text,  # maps "b{num}" -> list of surrounding contexts
        "total": len(citations),
        "raw_xml": xml_str,     # needed by section_extractor
    }


def parse_citation(ref, index: int) -> dict:
    # GROBID's own xml:id for this biblStruct (e.g. "b0", "b9", "b40")
    # This is the key used in in_text_map, so we store it for reliable lookup.
    XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
    grobid_id = ref.get(XML_ID, f"b{index - 1}")

    # Title (article or monograph)
    title = (
        ref.findtext(".//tei:title[@level='a']", namespaces=NS)
        or ref.findtext(".//tei:title[@level='m']", namespaces=NS)
        or ""
    )

    # Authors
    authors = []
    for author in ref.findall(".//tei:author", NS):
        surname = author.findtext("tei:persName/tei:surname", namespaces=NS) or ""
        forename = author.findtext("tei:persName/tei:forename", namespaces=NS) or ""
        if surname:
            full = f"{forename} {surname}".strip() if forename else surname
            authors.append(full)

    # Year
    date_el = ref.find(".//tei:date[@type='published']", NS)
    year = None
    if date_el is not None:
        when = date_el.get("when", "")
        year = int(when[:4]) if when and when[:4].isdigit() else None

    # DOI
    doi_el = ref.find(".//tei:idno[@type='DOI']", NS)
    doi = doi_el.text.strip() if doi_el is not None and doi_el.text else None

    # Venue
    venue = (
        ref.findtext(".//tei:title[@level='j']", namespaces=NS)
        or ref.findtext(".//tei:title[@level='s']", namespaces=NS)
        or ""
    )

    return {
        "id": f"[{index}]",
        "num": index,
        "grobid_id": grobid_id,
        "title": title,
        "authors": authors,
        "year": year,
        "doi": doi,
        "venue": venue,
    }


def _get_sentence_for_ref(ref) -> str:
    """
    Return the specific sentence containing this ref element.

    Strategy:
      1. If parent tag is <s> (GROBID sentence segment) → use its full text directly.
      2. If parent is <p> → reconstruct text node-by-node, collect the window of text
         around this ref (text before ref in same paragraph + ref text + tail text),
         then expand to a full sentence boundary.
    """
    import re as _re

    parent = ref.getparent()
    if parent is None:
        return ""

    local = parent.tag.split("}")[-1] if "}" in parent.tag else parent.tag

    # ── Case 1: GROBID gave us a proper <s> sentence element ─────────────────
    if local == "s":
        return "".join(parent.itertext()).strip()

    # ── Case 2: ref is inside a <p> — find the sentence around this ref ───────
    # Walk the parent's children to reconstruct text with a marker at the ref pos
    MARKER = "\x00"
    parts = [parent.text or ""]
    for child in parent:
        if child is ref:
            parts.append(MARKER)
        parts.append("".join(child.itertext()))
        parts.append(child.tail or "")
    full = "".join(parts)

    marker_pos = full.find(MARKER)
    if marker_pos == -1:
        # Fallback: return whole paragraph text (no truncation)
        return "".join(parent.itertext()).strip()

    # Remove marker from text for clean output
    clean = full.replace(MARKER, "")
    marker_pos_clean = marker_pos  # marker is 1 char, so positions before it are same

    # Find sentence boundaries around marker position
    # Look backward for sentence start
    start = marker_pos_clean
    for i in range(marker_pos_clean - 1, -1, -1):
        if clean[i] in ".!?" and i + 1 < len(clean) and clean[i + 1] == " ":
            start = i + 2
            break
        if i == 0:
            start = 0

    # Look forward for sentence end
    end = len(clean)
    for i in range(marker_pos_clean, len(clean)):
        if clean[i] in ".!?" and (i + 1 >= len(clean) or clean[i + 1] in " \n"):
            end = i + 1
            break

    sentence = clean[start:end].strip()
    return sentence if sentence else "".join(parent.itertext()).strip()


def extract_in_text_citations(body) -> dict:
    """Extract the specific sentence surrounding each in-text citation reference."""
    in_text = {}

    for ref in body.findall(".//tei:ref[@type='bibr']", NS):
        target = ref.get("target", "").lstrip("#")
        if not target:
            continue

        context = _get_sentence_for_ref(ref)

        if target not in in_text:
            in_text[target] = []
        if context and context not in in_text[target]:
            in_text[target].append(context)

    return in_text
