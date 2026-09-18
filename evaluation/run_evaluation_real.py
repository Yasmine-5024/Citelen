"""
Step 3b — Run the real-paper evaluation (papers downloaded from arXiv with
injected fake citations).

Prerequisites:
  - python evaluation/inject_fake_citations.py   (downloads + injects)
  - Backend running: cd backend && python app.py
  - GROBID running:  docker run --rm -p 8070:8070 lfoppiano/grobid:0.8.0

Run:
    cd backend && source venv/Scripts/activate
    cd .. && python evaluation/run_evaluation_real.py

Output: evaluation/results/raw_results_real.json
        evaluation/results/metrics_report_real.txt
"""

import json
import os
import time
import requests
from difflib import SequenceMatcher

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
GT_PATH     = os.path.join(SCRIPT_DIR, "ground_truth_real_papers.json")
PDFS_DIR    = os.path.join(SCRIPT_DIR, "test_pdfs")
RESULTS_DIR = os.path.join(SCRIPT_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

BACKEND_URL = "http://localhost:5000"
ANALYZE_URL = f"{BACKEND_URL}/analyze"


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def parse_sse_stream(response) -> list[dict]:
    citations = []
    buffer = ""
    for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
        buffer += chunk
        while "\n\n" in buffer:
            event_block, buffer = buffer.split("\n\n", 1)
            for line in event_block.splitlines():
                if line.startswith("data: "):
                    try:
                        payload = json.loads(line[6:])
                        if payload.get("type") == "citation":
                            citations.append(payload["data"])
                    except json.JSONDecodeError:
                        pass
    return citations


def evaluate_real_paper(paper: dict) -> dict:
    filename  = paper["filename"]
    pdf_path  = os.path.join(PDFS_DIR, filename)
    gt_cits   = paper["citations"]

    # Separate fake (injected) citations from real ones
    fake_gt   = [c for c in gt_cits if c["ground_truth"] == "FAKE"]
    real_gt   = [c for c in gt_cits if c["ground_truth"] == "REAL"]

    print(f"\n{'='*60}")
    print(f"  Evaluating: {filename}  ({paper['topic']})")
    print(f"  Total GT:   {len(real_gt)} REAL (bulk) + {len(fake_gt)} injected FAKE")

    if not os.path.exists(pdf_path):
        print(f"  ERROR: PDF not found. Run inject_fake_citations.py first.")
        return {"filename": filename, "error": "PDF not found", "matches": []}

    print(f"  Uploading to {ANALYZE_URL} ...")
    t0   = time.time()
    resp = None
    try:
        with open(pdf_path, "rb") as f:
            resp = requests.post(
                ANALYZE_URL,
                files={"file": (filename, f, "application/pdf")},
                stream=True,
                timeout=600
            )
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print(f"  ERROR: Backend not reachable at {BACKEND_URL}")
        return {"filename": filename, "error": "Backend not reachable", "matches": []}
    except requests.exceptions.HTTPError as e:
        status = resp.status_code if resp is not None else "?"
        print(f"  ERROR: HTTP {status} — {e}")
        return {"filename": filename, "error": str(e), "matches": []}

    results  = parse_sse_stream(resp)
    elapsed  = round(time.time() - t0, 1)
    print(f"  Received {len(results)} citation results in {elapsed}s")

    # ── Match injected fakes to RefLens results ───────────────────────────────
    # For real papers, we focus on the fake citations we injected.
    # For original (REAL) citations, any RefLens result NOT matched to a fake
    # is treated as a real citation result.

    fake_matches = []
    matched_fake_titles = set()

    for cit in fake_gt:
        best_score  = 0.0
        best_result = None
        for res in results:
            score = title_similarity(res.get("title", ""), cit["title"])
            if score > best_score:
                best_score  = score
                best_result = res

        if best_result and best_score >= 0.55:
            matched_fake_titles.add(best_result.get("title", ""))
            fake_matches.append({
                "gt_ref_num":     cit["ref_num"],
                "gt_title":       cit["title"],
                "gt_label":       "FAKE",
                "reflens_title":  best_result.get("title"),
                "reflens_status": best_result.get("status", "unknown"),
                "reflens_score":  best_result.get("aiScore", -1),
                "reflens_flags":  best_result.get("flags", []),
                "matched":        True
            })
            print(f"  [FAKE] ref {cit['ref_num']:3d}  RefLens={best_result.get('status'):12s}  score={best_result.get('aiScore',-1):3}  \"{cit['title'][:50]}\"")
        else:
            fake_matches.append({
                "gt_ref_num":     cit["ref_num"],
                "gt_title":       cit["title"],
                "gt_label":       "FAKE",
                "reflens_title":  None,
                "reflens_status": "not_analyzed",
                "reflens_score":  -1,
                "reflens_flags":  [],
                "matched":        False
            })
            print(f"  [FAKE] ref {cit['ref_num']:3d}  RefLens=NOT_ANALYZED  \"{cit['title'][:50]}\"")

    # All other RefLens results correspond to original REAL citations
    real_matches = []
    for res in results:
        if res.get("title", "") in matched_fake_titles:
            continue
        real_matches.append({
            "gt_ref_num":     None,
            "gt_title":       res.get("title", ""),
            "gt_label":       "REAL",
            "reflens_title":  res.get("title"),
            "reflens_status": res.get("status", "unknown"),
            "reflens_score":  res.get("aiScore", -1),
            "reflens_flags":  res.get("flags", []),
            "matched":        True
        })

    all_matches = real_matches + fake_matches

    # Quick summary
    tp = sum(1 for m in all_matches if m["gt_label"] == "FAKE" and m["reflens_status"] == "ai_likely")
    fp = sum(1 for m in all_matches if m["gt_label"] == "REAL" and m["reflens_status"] == "ai_likely")
    fn = sum(1 for m in all_matches if m["gt_label"] == "FAKE" and m["reflens_status"] == "human")
    tn = sum(1 for m in all_matches if m["gt_label"] == "REAL" and m["reflens_status"] == "human")
    print(f"  Quick:  TP={tp} FP={fp} FN={fn} TN={tn}")

    return {
        "filename":        filename,
        "topic":           paper["topic"],
        "matches":         all_matches,
        "elapsed_seconds": elapsed
    }


if __name__ == "__main__":
    if not os.path.exists(GT_PATH):
        print(f"ERROR: {GT_PATH} not found.")
        print("Run:  python evaluation/inject_fake_citations.py  first.")
        exit(1)

    print("Checking backend health...")
    try:
        health = requests.get(f"{BACKEND_URL}/health", timeout=5)
        print(f"  Backend OK: {health.json()}")
    except Exception:
        print(f"  ERROR: Backend not reachable. Start with: cd backend && python app.py")
        exit(1)

    with open(GT_PATH) as f:
        gt = json.load(f)

    all_results = []
    for paper in gt["test_papers"]:
        result = evaluate_real_paper(paper)
        all_results.append(result)

    out_path = os.path.join(RESULTS_DIR, "raw_results_real.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\nRaw results saved to: {out_path}")
    print(f"Now run:  python evaluation/compute_metrics.py --real")
