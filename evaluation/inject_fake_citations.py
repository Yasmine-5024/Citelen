"""
Downloads real arXiv PDFs and appends fake citations to their reference lists.
This creates more realistic test cases than purely synthetic PDFs.

Each downloaded paper already has real citations. We inject 5 fake ones at the end
of the reference list and record the ground truth (all originals = REAL, injected = FAKE).

Run from the project root:
    cd backend && source venv/Scripts/activate
    cd .. && python evaluation/inject_fake_citations.py

Output:
    evaluation/test_pdfs/real_paper_1.pdf  (real paper + injected fakes)
    evaluation/test_pdfs/real_paper_2.pdf
    evaluation/test_pdfs/real_paper_3.pdf
    evaluation/ground_truth_real_papers.json
"""

import json
import os
import time
import requests
import fitz  # PyMuPDF

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR    = os.path.join(SCRIPT_DIR, "test_pdfs")
GT_PATH    = os.path.join(SCRIPT_DIR, "ground_truth_real_papers.json")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Real arXiv papers to download ─────────────────────────────────────────────
# These are well-known survey/review papers with large reference lists.
# We download the PDF, read how many references GROBID will find, then
# append 5 fake citations so RefLens has a mixed set to evaluate.

REAL_PAPERS = [
    {
        "filename": "real_paper_1.pdf",
        "topic": "Transformer Architectures Survey",
        "paper_title": "A Survey on Vision Transformer",
        "arxiv_id": "2012.12556",   # Han et al. 2022 — IEEE TPAMI
        "fake_citations": [
            {
                "ref_num": None,  # will be filled in after download
                "title": "Deformable Sparse Attention for High-Resolution Image Synthesis",
                "authors": ["Zhao, W.", "Lin, T.", "Chen, H."],
                "year": 2022,
                "venue": "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Token Routing Networks for Efficient Multi-Task Visual Learning",
                "authors": ["Dupont, E.", "Goyal, A.", "Eslami, S."],
                "year": 2023,
                "venue": "International Conference on Learning Representations (ICLR)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Unified Vision-Language Alignment via Asymmetric Contrastive Distillation",
                "authors": ["Cho, J.", "Yoon, S.", "Kim, B."],
                "year": 2022,
                "venue": "Advances in Neural Information Processing Systems (NeurIPS)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Hierarchical Patch Merging with Learned Spatial Priors for Dense Prediction",
                "authors": ["Muller, K.", "Becker, J.", "Hartmann, R."],
                "year": 2023,
                "venue": "International Conference on Computer Vision (ICCV)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Stochastic Depth Scheduling for Adaptive Inference in Vision Transformers",
                "authors": ["Nakashima, Y.", "Inoue, H.", "Yamada, K."],
                "year": 2022,
                "venue": "European Conference on Computer Vision (ECCV)",
                "doi": None,
                "ground_truth": "FAKE"
            }
        ]
    },
    {
        "filename": "real_paper_2.pdf",
        "topic": "Federated Learning Survey",
        "paper_title": "Advances and Open Problems in Federated Learning",
        "arxiv_id": "1912.04977",   # Kairouz et al. 2021
        "fake_citations": [
            {
                "ref_num": None,
                "title": "Momentum-Based Variance Reduction for Non-IID Federated Optimization",
                "authors": ["Bergmann, C.", "Roth, S.", "Klein, T."],
                "year": 2022,
                "venue": "International Conference on Learning Representations (ICLR)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Federated Domain Adaptation via Prototype Alignment and Entropy Minimization",
                "authors": ["Diallo, M.", "Traore, A.", "Coulibaly, B."],
                "year": 2023,
                "venue": "International Conference on Machine Learning (ICML)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Cross-Silo Federated Learning with Heterogeneous Label Distributions",
                "authors": ["Osei, K.", "Mensah, E.", "Asante, J."],
                "year": 2022,
                "venue": "Advances in Neural Information Processing Systems (NeurIPS)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Communication Compression for Federated Learning via Learned Quantization Codebooks",
                "authors": ["Vasquez, R.", "Herrera, C.", "Medina, F."],
                "year": 2021,
                "venue": "International Conference on Learning Representations (ICLR)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Incentive-Aware Client Selection for Fair Federated Learning",
                "authors": ["Popescu, I.", "Ionescu, C.", "Dumitru, A."],
                "year": 2023,
                "venue": "AAAI Conference on Artificial Intelligence",
                "doi": None,
                "ground_truth": "FAKE"
            }
        ]
    },
    {
        "filename": "real_paper_3.pdf",
        "topic": "Graph Neural Networks Survey",
        "paper_title": "A Comprehensive Study of Graph Neural Networks",
        "arxiv_id": "1901.00596",   # Wu et al. 2019
        "fake_citations": [
            {
                "ref_num": None,
                "title": "Temporal Graph Attention Networks for Event-Driven Forecasting",
                "authors": ["Joergensen, M.", "Andersen, R.", "Nielsen, C."],
                "year": 2022,
                "venue": "International Conference on Learning Representations (ICLR)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Adaptive Edge Dropping for Robust Graph Representation Learning",
                "authors": ["Sato, K.", "Suzuki, T.", "Kobayashi, M."],
                "year": 2021,
                "venue": "Advances in Neural Information Processing Systems (NeurIPS)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Graph Transformer Networks with Positional Edge Encodings",
                "authors": ["Ferreira, J.", "Santos, P.", "Carvalho, R."],
                "year": 2022,
                "venue": "International Conference on Machine Learning (ICML)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Scalable Subgraph Sampling via Spectral Sparsification",
                "authors": ["Andersson, L.", "Karlsson, M.", "Gustafsson, P."],
                "year": 2023,
                "venue": "Advances in Neural Information Processing Systems (NeurIPS)",
                "doi": None,
                "ground_truth": "FAKE"
            },
            {
                "ref_num": None,
                "title": "Few-Shot Node Classification with Label Propagation and Meta-Learning",
                "authors": ["Papadopoulos, N.", "Stavrou, K.", "Georgiou, A."],
                "year": 2022,
                "venue": "International Conference on Learning Representations (ICLR)",
                "doi": None,
                "ground_truth": "FAKE"
            }
        ]
    }
]

ARXIV_PDF_URL = "https://arxiv.org/pdf/{arxiv_id}.pdf"


# ── Download PDF from arXiv ───────────────────────────────────────────────────

def download_arxiv_pdf(arxiv_id: str, out_path: str) -> bool:
    url = ARXIV_PDF_URL.format(arxiv_id=arxiv_id)
    print(f"  Downloading arXiv:{arxiv_id} ...")
    try:
        resp = requests.get(
            url, timeout=60,
            headers={"User-Agent": "RefLens-Evaluation/1.0"},
            allow_redirects=True
        )
        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            return False
        if resp.content[:4] != b"%PDF":
            print(f"  ERROR: Response is not a PDF (got HTML/redirect page)")
            return False
        with open(out_path, "wb") as f:
            f.write(resp.content)
        size = os.path.getsize(out_path)
        print(f"  Downloaded: {size} bytes -> {out_path}")
        return True
    except Exception as e:
        msg = str(e).encode("ascii", errors="replace").decode("ascii")
        print(f"  ERROR downloading: {msg}")
        return False


# ── Count existing references in a PDF via text search ───────────────────────

def count_references(pdf_path: str) -> int:
    """Estimate the highest reference number in the PDF's reference list."""
    doc = fitz.open(pdf_path)
    max_ref = 0
    for page in doc:
        text = page.get_text()
        # Look for patterns like [123] at the start of lines
        import re
        for m in re.finditer(r"^\[(\d+)\]", text, re.MULTILINE):
            num = int(m.group(1))
            if num > max_ref:
                max_ref = num
    doc.close()
    return max_ref


# ── Append fake citations to an existing PDF ─────────────────────────────────

def format_fake_ref(ref_num: int, cit: dict) -> str:
    authors = ", ".join(cit["authors"])
    return f"[{ref_num}] {authors}. {cit['title']}. In {cit['venue']}, {cit['year']}."


def inject_fake_citations(pdf_path: str, fake_cits: list) -> list:
    """
    Appends a new page to the PDF with injected fake references.
    Returns the updated fake_cits list with ref_num filled in.
    """
    doc   = fitz.open(pdf_path)
    base  = count_references(pdf_path)
    page  = doc.new_page(width=595, height=842)
    y     = 72
    tw    = 595 - 144

    # Section header
    page.insert_text((72, y), "Additional References (Appended)", fontsize=11, fontname="hebo")
    y += 24

    updated = []
    for i, cit in enumerate(fake_cits):
        ref_num = base + i + 1
        cit     = dict(cit)
        cit["ref_num"] = ref_num
        ref_str = format_fake_ref(ref_num, cit)

        rect    = fitz.Rect(72, y, 72 + tw, y + 80)
        excess  = page.insert_textbox(rect, ref_str, fontsize=9, fontname="helv", align=0)
        used    = (rect.height - excess) if excess >= 0 else 40
        y      += used + 4
        updated.append(cit)

    # Save to temp file then replace original (fitz cannot overwrite in-place)
    import tempfile, shutil
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(tmp_fd)
    doc.save(tmp_path)
    doc.close()
    shutil.move(tmp_path, pdf_path)

    print(f"  Injected {len(fake_cits)} fake citations (refs [{base+1}]-[{base+len(fake_cits)}])")
    return updated


# ── Build ground truth entry for a real paper ────────────────────────────────

def build_gt_entry(paper: dict, fake_cits_with_nums: list, real_ref_count: int) -> dict:
    """
    For real papers we don't enumerate every original citation individually —
    instead we mark the entire original reference list as REAL in bulk,
    and list the injected fakes explicitly.
    """
    real_citations = [
        {
            "ref_num": i + 1,
            "title": f"[Original reference {i+1} from arXiv:{paper['arxiv_id']}]",
            "authors": [],
            "year": None,
            "venue": None,
            "doi": None,
            "ground_truth": "REAL"
        }
        for i in range(real_ref_count)
    ]
    return {
        "filename":   paper["filename"],
        "topic":      paper["topic"],
        "paper_title": paper["paper_title"],
        "arxiv_id":   paper["arxiv_id"],
        "note": (
            "Real paper downloaded from arXiv. Original citations labeled REAL in bulk. "
            "Fake citations injected at end of reference list."
        ),
        "citations": real_citations + fake_cits_with_nums
    }


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    gt_papers = []

    for paper in REAL_PAPERS:
        print(f"\n{'='*60}")
        print(f"  Paper : {paper['paper_title']}")
        print(f"  arXiv : {paper['arxiv_id']}")

        out_path = os.path.join(OUT_DIR, paper["filename"])

        # 1. Download
        ok = download_arxiv_pdf(paper["arxiv_id"], out_path)
        if not ok:
            print(f"  SKIPPING - download failed.")
            continue

        # Be polite to arXiv
        time.sleep(2)

        # 2. Count existing refs
        real_count = count_references(out_path)
        print(f"  Detected {real_count} existing reference(s) in PDF")

        # 3. Inject fakes
        updated_fakes = inject_fake_citations(out_path, paper["fake_citations"])

        # 4. Build GT entry
        gt_entry = build_gt_entry(paper, updated_fakes, real_count)
        gt_papers.append(gt_entry)

    # Save ground truth for real papers
    gt = {
        "description": (
            "Ground truth for real arXiv papers with injected fake citations. "
            "Original references are labeled REAL (bulk), injected fakes are labeled FAKE."
        ),
        "test_papers": gt_papers
    }
    with open(GT_PATH, "w") as f:
        json.dump(gt, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Ground truth saved to: {GT_PATH}")
    print(f"\nNext step:")
    print(f"  python evaluation/run_evaluation_real.py")
