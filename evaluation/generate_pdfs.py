"""
Step 2 — Generate test PDFs for the AI Detection evaluation.

Each PDF looks like a short academic paper with:
  - Title, authors, abstract
  - Body sections with in-text citations like [1], [2], ...
  - A numbered References section

Run from the project root:
    cd backend && source venv/Scripts/activate
    cd ../evaluation && python generate_pdfs.py
"""

import json
import os
import fitz  # PyMuPDF

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GT_PATH    = os.path.join(SCRIPT_DIR, "ground_truth.json")
OUT_DIR    = os.path.join(SCRIPT_DIR, "test_pdfs")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Page layout constants ─────────────────────────────────────────────────────
PW, PH   = 595, 842          # A4 points
MARGIN   = 72
TW       = PW - 2 * MARGIN   # usable text width = 451 pt
LH_BODY  = 14                # line height for 10pt body text
LH_REF   = 13                # line height for 9pt reference entries


# ── Paper body templates (intro + related work sections with [N] citations) ──

BODIES = {
    "test_paper_1.pdf": """\
1. Introduction

Deep learning has transformed the field of artificial intelligence over the past decade.
Convolutional neural networks were first applied to large-scale image classification by
Krizhevsky et al. [5], achieving unprecedented accuracy on the ImageNet benchmark.
The introduction of residual connections by He et al. [2] allowed training of networks with
hundreds of layers, overcoming the vanishing gradient problem. More recently, attention
mechanisms [1] have replaced recurrence as the dominant sequence modelling paradigm.

2. Related Work

Generative modelling has progressed rapidly since the introduction of adversarial training [3].
Optimization advances such as adaptive gradient methods [4] have become standard practice.
Graph-based attention approaches have been extended to multi-modal settings [6], while sparse
attention variants have been explored in recurrent frameworks [7]. Neural architecture search
methods based on probabilistic models [8] aim to automate model design. Self-supervised
pretraining for dense prediction tasks [9] reduces the need for labelled data, and token
reduction strategies [10] improve inference efficiency of transformer models.
""",

    "test_paper_2.pdf": """\
1. Introduction

Pre-trained language models have become the foundation of modern natural language processing.
LSTM-based recurrent architectures [3] dominated sequence modelling until transformer-based
models emerged. BERT [1] introduced masked language model pre-training, producing contextual
representations that generalized across tasks. GPT-3 [2] demonstrated that scaling language
models to hundreds of billions of parameters enables few-shot generalization without fine-tuning.
Dropout regularization [5] remains widely used to prevent overfitting during pre-training.

2. Related Work

Vision-language models such as CLIP [4] align visual and textual representations using
contrastive objectives over large web-crawled datasets. Hierarchical transformer designs
have been proposed to handle long documents [6], while mixture-of-experts architectures
offer scalable generation [7]. Quantum-inspired formulations have been applied to attention [8].
Pruning methods based on gradient analysis reduce model size [9], and curriculum strategies
improve low-resource translation quality [10].
""",

    "test_paper_4.pdf": """\
1. Introduction

Graph-structured data is ubiquitous in real-world applications. Early work on graph neural
networks introduced the notion of node-level state propagation [5]. Graph convolutional
networks [1] extended spectral methods to efficient spatial convolutions, enabling scalable
semi-supervised node classification. Graph attention networks [2] introduced learnable
per-edge weights, improving expressivity. For large-scale inductive settings, neighbourhood
sampling approaches [3] allow generalization to unseen nodes at inference time.

2. Related Work

The expressiveness of GNNs has been formally analyzed in relation to the Weisfeiler-Leman
graph isomorphism test [4]. Spectral graph convolutions using adaptive filters have been
extended to dynamic networks [6], while hyperbolic embedding spaces have been applied
to knowledge graph completion [7]. Differentiable pooling methods [8] enable hierarchical
graph representations. Contrastive objectives have been applied to molecular graphs [9],
and symmetry-equivariant architectures have been proposed for physical systems [10].
""",

    "test_paper_5.pdf": """\
1. Introduction

Federated learning enables training across decentralized data without sharing raw samples.
The seminal FedAvg algorithm [1] demonstrated communication-efficient optimization by
aggregating local model updates. Machine learning models are vulnerable to adversarial
perturbations [2], and adversarial training [3] has become a standard defence. Differential
privacy techniques [4] provide formal guarantees against privacy leakage during training.

2. Related Work

Membership inference attacks [5] reveal that model outputs can leak information about
training data, motivating privacy-preserving training methods. Asynchronous federated
protocols have been proposed for heterogeneous client availability [6], while differentially
private gradient methods have been adapted to tree-based models for healthcare [7].
Secure aggregation protocols [8] protect individual updates from the server. Byzantine
robustness has been addressed via gradient clipping strategies [9], and machine unlearning
in federated settings [10] allows clients to retract their data contributions.
""",

    "test_paper_3.pdf": """\
1. Introduction

Convolutional neural networks were first applied to document and image recognition by
LeCun et al. [3], establishing the blueprint for modern deep vision systems. VGGNet [2]
demonstrated that depth is a critical factor in visual representation quality. The U-Net
architecture [1] introduced skip connections specifically for biomedical segmentation,
becoming the dominant approach in medical imaging. Vision Transformers [4] have since
extended the transformer paradigm to image recognition with strong results.

2. Related Work

Reinforcement learning frameworks [5] have been applied to treatment planning and
clinical decision support. Cross-modal contrastive learning has been extended to medical
imaging tasks [6], and zero-shot transfer methods [7] reduce annotation requirements.
Causal representation learning provides robustness against distribution shift [8].
Federated approaches [9] address data privacy constraints across clinical sites, while
visual question answering systems [10] assist radiologists in interpreting scan findings.
"""
}


# ── PDF writer helper ────────────────────────────────────────────────────────

class Writer:
    """Simple multi-page PDF writer using PyMuPDF."""

    def __init__(self):
        self.doc  = fitz.open()
        self.page = None
        self.y    = MARGIN
        self._new_page()

    def _new_page(self):
        self.page = self.doc.new_page(width=PW, height=PH)
        self.y    = MARGIN

    def _check(self, need: float):
        if self.y + need > PH - MARGIN:
            self._new_page()

    def heading(self, text: str, size: float = 13):
        self._check(size * 2.5)
        self.page.insert_text((MARGIN, self.y), text,
                              fontsize=size, fontname="hebo")
        self.y += size * 2.2

    def subheading(self, text: str, size: float = 11):
        self._check(size * 2)
        self.y += 4
        self.page.insert_text((MARGIN, self.y), text,
                              fontsize=size, fontname="hebo")
        self.y += size * 1.8

    def paragraph(self, text: str, size: float = 10):
        """Insert wrapped paragraph; returns after last line."""
        rect = fitz.Rect(MARGIN, self.y, MARGIN + TW, self.y + 2000)
        excess = self.page.insert_textbox(
            rect, text.strip(), fontsize=size,
            fontname="helv", align=0
        )
        # excess >= 0 means how much rect height was left unused
        if excess >= 0:
            used = rect.height - excess
        else:
            used = rect.height  # overflow; page break not handled, acceptable for tests
        self.y += used + size * 0.6

    def hline(self):
        self._check(10)
        self.page.draw_line(
            fitz.Point(MARGIN, self.y),
            fitz.Point(MARGIN + TW, self.y)
        )
        self.y += 8

    def reference_line(self, text: str, size: float = 9):
        """Insert a single reference entry (may wrap)."""
        self._check(size * 3)
        rect = fitz.Rect(MARGIN + 14, self.y, MARGIN + TW, self.y + 200)
        excess = self.page.insert_textbox(
            rect, text.strip(), fontsize=size,
            fontname="helv", align=0
        )
        if excess >= 0:
            used = rect.height - excess
        else:
            used = 30
        self.y += used + 3

    def save(self, path: str):
        self.doc.save(path)
        self.doc.close()
        print(f"  Saved: {path}")


# ── Reference string builder ─────────────────────────────────────────────────

def format_ref(citation: dict) -> str:
    """Format a citation dict into a numbered reference string."""
    num     = citation["ref_num"]
    authors = ", ".join(citation["authors"])
    title   = citation["title"]
    year    = citation["year"]
    venue   = citation["venue"]
    doi     = citation.get("doi") or ""

    ref = f"[{num}] {authors}. {title}. In {venue}, {year}."
    if doi:
        ref += f" doi:{doi}"
    return ref


# ── Main generation loop ─────────────────────────────────────────────────────

def generate_pdf(paper: dict):
    filename = paper["filename"]
    title    = paper["paper_title"]
    body     = BODIES.get(filename, "")
    citations = paper["citations"]

    w = Writer()

    # ── Title block ───────────────────────────────────────────────────────────
    w.heading(title, size=14)
    w.paragraph("Anonymous Author(s)\nAnonymous Institution", size=10)
    w.y += 8

    # ── Abstract ─────────────────────────────────────────────────────────────
    w.subheading("Abstract")
    w.paragraph(
        "This paper presents a survey of recent advances in the field. "
        "We review key contributions, discuss methodological trends, and "
        "identify open challenges. Our analysis covers both foundational "
        "work and recent developments, highlighting directions for future research.",
        size=10
    )
    w.hline()
    w.y += 6

    # ── Body ──────────────────────────────────────────────────────────────────
    for block in body.strip().split("\n\n"):
        lines = block.strip().split("\n")
        if lines[0].startswith(("1.", "2.", "3.")):
            w.subheading(lines[0])
            rest = " ".join(lines[1:]).strip()
            if rest:
                w.paragraph(rest)
        else:
            w.paragraph(block)

    w.y += 10
    w.hline()

    # ── References ────────────────────────────────────────────────────────────
    w.subheading("References")
    for cit in citations:
        w.reference_line(format_ref(cit))

    out_path = os.path.join(OUT_DIR, filename)
    w.save(out_path)
    return out_path


if __name__ == "__main__":
    with open(GT_PATH) as f:
        gt = json.load(f)

    print(f"Generating {len(gt['test_papers'])} test PDFs into {OUT_DIR}/\n")
    for paper in gt["test_papers"]:
        generate_pdf(paper)

    print("\nDone. Verify the PDFs look correct before running the evaluation.")
