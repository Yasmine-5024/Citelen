"""
Prepares a test version of the CiteView UIST paper:
  1. Copies the original PDF
  2. Redacts 3 real citations from the reference list (simulates missing citations)
  3. Appends 3 fake citations as a new page (simulates AI hallucinations)
  4. Saves ground truth JSON

Run from project root:
    python evaluation/prepare_citeview_test.py

Output:
    evaluation/test_pdfs/citeview_test.pdf
    evaluation/citeview_ground_truth.json
"""

import json, os, shutil, re, sys
import fitz  # PyMuPDF

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
SRC_PDF     = os.path.join(SCRIPT_DIR, "uist26a-sub1890-i7 (1).pdf")
OUT_PDF     = os.path.join(SCRIPT_DIR, "test_pdfs", "citeview_test.pdf")
GT_PATH     = os.path.join(SCRIPT_DIR, "citeview_ground_truth.json")
os.makedirs(os.path.join(SCRIPT_DIR, "test_pdfs"), exist_ok=True)

# ── Real citations to REDACT (remove from reference list) ─────────────────────
# These are important, directly-cited papers that the paper text explicitly
# discusses. Removing them tests whether RefLens flags them as missing.
CITATIONS_TO_REMOVE = [
    {
        "ref_num": 6,
        "title": "CiteSee: Augmenting Citations in Scientific Papers with Persistent and Personalized Historical Context",
        "search_text": "CiteSee: Augmenting Citations",   # unique substring on reference page
        "reason": "Core related work explicitly discussed in intro and related work sections"
    },
    {
        "ref_num": 11,
        "title": "Augmenting Scientific Papers with Just-in-Time, Position-Sensitive Definitions of Terms and Symbols",
        "search_text": "Just-in-Time,",
        "reason": "Directly cited as foundational augmented reading work"
    },
    {
        "ref_num": 23,
        "title": "CiteRead: Integrating Localized Citation Contexts into Scientific Paper Reading",
        "search_text": "CiteRead: Integrating Localized",
        "reason": "Core related work explicitly discussed in intro"
    },
]

# ── Fake citations to INJECT ───────────────────────────────────────────────────
# Plausible-sounding HCI/citation analysis papers that do NOT exist.
FAKE_CITATIONS = [
    {
        "ref_num": None,  # filled in after counting
        "title": "CitePulse: Adaptive Citation Intent Prediction for Interactive Scholarly Reading",
        "authors": ["Nakamura, T.", "Hashimoto, K.", "Tanaka, R."],
        "year": 2024,
        "venue": "Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems (CHI '24)",
        "doi": None,
        "ground_truth": "FAKE"
    },
    {
        "ref_num": None,
        "title": "ContextRef: Grounding Citation Explanations in Retrieval-Augmented Evidence for Academic Readers",
        "authors": ["Okafor, C.", "Mensah, E.", "Diallo, A."],
        "year": 2025,
        "venue": "Proceedings of the ACM Symposium on User Interface Software and Technology (UIST '25)",
        "doi": None,
        "ground_truth": "FAKE"
    },
    {
        "ref_num": None,
        "title": "ScholarLens: Multi-Granularity Semantic Alignment for Cross-Paper Claim Verification",
        "authors": ["Bergmann, F.", "Richter, M.", "Klein, A."],
        "year": 2024,
        "venue": "Findings of the Association for Computational Linguistics (ACL 2024)",
        "doi": None,
        "ground_truth": "FAKE"
    },
]


def redact_reference(doc: fitz.Document, search_text: str, ref_num: int) -> bool:
    """Find and redact a reference entry across all pages."""
    for page in doc:
        rects = page.search_for(search_text)
        if not rects:
            continue
        # Expand each match rect to cover the full line height with some padding
        for rect in rects:
            # Redact a generous area around the found text
            redact_rect = fitz.Rect(
                page.rect.x0 + 36,   # left margin
                rect.y0 - 2,
                page.rect.x1 - 36,   # right margin
                rect.y1 + 2
            )
            page.add_redact_annot(redact_rect, fill=(1, 1, 1))  # white fill
        page.apply_redactions()
        print(f"  Redacted [{ref_num}] on page {page.number + 1}: '{search_text[:50]}'")
        return True
    print(f"  WARNING: Could not find text for [{ref_num}]: '{search_text[:50]}'")
    return False


def count_references(doc: fitz.Document) -> int:
    """Find the highest [N] reference number in the document."""
    max_ref = 0
    for page in doc:
        for m in re.finditer(r"^\[(\d+)\]", page.get_text(), re.MULTILINE):
            max_ref = max(max_ref, int(m.group(1)))
    return max_ref


def inject_fake_citations(doc: fitz.Document, fake_cits: list, base_ref_num: int) -> list:
    """Append a new page with fake citations."""
    page = doc.new_page(width=595, height=842)
    y = 72
    page.insert_text((72, y), "Additional References (Appended)", fontsize=11, fontname="hebo")
    y += 28

    updated = []
    for i, cit in enumerate(fake_cits):
        cit = dict(cit)
        cit["ref_num"] = base_ref_num + i + 1
        authors = ", ".join(cit["authors"])
        ref_str = f"[{cit['ref_num']}] {authors}. {cit['year']}. {cit['title']}. In {cit['venue']}."
        rect = fitz.Rect(72, y, 523, y + 70)
        excess = page.insert_textbox(rect, ref_str, fontsize=9, fontname="helv", align=0)
        used = max((rect.height - excess) if excess >= 0 else 40, 14)
        y += used + 6
        updated.append(cit)
        print(f"  Injected [{cit['ref_num']}] {cit['title'][:60]}")
    return updated


if __name__ == "__main__":
    print(f"Source: {SRC_PDF}")
    shutil.copy2(SRC_PDF, OUT_PDF)
    print(f"Copied to: {OUT_PDF}")

    doc = fitz.open(OUT_PDF)
    print(f"Pages: {len(doc)}")

    # Step 1: Redact real citations
    print("\n--- Redacting real citations ---")
    redacted = []
    for cit in CITATIONS_TO_REMOVE:
        ok = redact_reference(doc, cit["search_text"], cit["ref_num"])
        redacted.append({**cit, "redacted": ok})

    # Step 2: Count existing refs, then inject fakes
    base = count_references(doc)
    print(f"\n--- Injecting fake citations (base ref count: {base}) ---")
    updated_fakes = inject_fake_citations(doc, FAKE_CITATIONS, base)

    # Step 3: Save modified PDF
    import tempfile
    tmp = OUT_PDF + ".tmp"
    doc.save(tmp, garbage=4, deflate=True)
    doc.close()
    os.replace(tmp, OUT_PDF)
    print(f"\nSaved: {OUT_PDF}")

    # Step 4: Build ground truth
    gt = {
        "filename": "citeview_test.pdf",
        "topic": "In-Situ Citation Analysis for Scholarly Reading (HCI / UIST)",
        "paper_title": "CiteView: In-Situ Multi-Modal Citation Analysis for Scholarly Reading",
        "description": (
            "Real UIST'26 paper. 3 real citations redacted from reference list "
            "(to test missing citations detection). 3 fake citations appended "
            "(to test AI hallucination detection)."
        ),
        "redacted_real_citations": redacted,
        "injected_fake_citations": updated_fakes,
    }
    with open(GT_PATH, "w", encoding="utf-8") as f:
        json.dump(gt, f, indent=2, ensure_ascii=False)
    print(f"Ground truth saved: {GT_PATH}")

    print("\n--- Summary ---")
    print(f"  Redacted {len(CITATIONS_TO_REMOVE)} real citations: "
          + ", ".join(f"[{c['ref_num']}]" for c in CITATIONS_TO_REMOVE))
    print(f"  Injected {len(updated_fakes)} fake citations: "
          + ", ".join(f"[{c['ref_num']}]" for c in updated_fakes))
    print(f"\nNow upload evaluation/test_pdfs/citeview_test.pdf to RefLens.")
