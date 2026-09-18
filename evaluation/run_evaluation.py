"""
Step 3 — Upload each test PDF to the running RefLens backend, collect
AI detection results via SSE, and match them to ground truth labels.

Prerequisites:
  - Backend running:  cd backend && python app.py
  - GROBID running:   docker run --rm -p 8070:8070 lfoppiano/grobid:0.8.0
  - Test PDFs exist:  python evaluation/generate_pdfs.py

Run from the project root:
    cd backend && source venv/Scripts/activate
    cd .. && python evaluation/run_evaluation.py

Output: evaluation/results/raw_results.json
"""

import json
import os
import time
import requests
from difflib import SequenceMatcher

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
GT_PATH     = os.path.join(SCRIPT_DIR, "ground_truth.json")
PDFS_DIR    = os.path.join(SCRIPT_DIR, "test_pdfs")
RESULTS_DIR = os.path.join(SCRIPT_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

BACKEND_URL = "http://localhost:5000"
ANALYZE_URL = f"{BACKEND_URL}/analyze"


# ── Utility: title similarity ─────────────────────────────────────────────────

def title_similarity(a: str, b: str) -> float:
    """Case-insensitive fuzzy title match score 0-1."""
    return SequenceMatcher(
        None,
        a.lower().strip(),
        b.lower().strip()
    ).ratio()


def match_result_to_gt(result_title: str, gt_citations: list) -> dict | None:
    """Find the best-matching ground truth entry for a RefLens citation result."""
    if not result_title:
        return None
    best_score = 0.0
    best_match = None
    for cit in gt_citations:
        score = title_similarity(result_title, cit["title"])
        if score > best_score:
            best_score = score
            best_match = cit
    # Only accept matches above threshold to avoid false matches
    return best_match if best_score >= 0.55 else None


# ── SSE stream parser ─────────────────────────────────────────────────────────

def parse_sse_stream(response) -> list[dict]:
    """Parse SSE events from a streaming response, return all citation events."""
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


# ── Single PDF evaluation ─────────────────────────────────────────────────────

def evaluate_paper(paper: dict) -> dict:
    filename  = paper["filename"]
    pdf_path  = os.path.join(PDFS_DIR, filename)
    gt_cits   = paper["citations"]

    print(f"\n{'='*60}")
    print(f"  Evaluating: {filename}")
    print(f"  Topic:      {paper['topic']}")
    print(f"  Citations:  {len(gt_cits)} ({sum(1 for c in gt_cits if c['ground_truth']=='REAL')} real, "
          f"{sum(1 for c in gt_cits if c['ground_truth']=='FAKE')} fake)")

    if not os.path.exists(pdf_path):
        print(f"  ERROR: PDF not found at {pdf_path}")
        print(f"  Run:  python evaluation/generate_pdfs.py  first.")
        return {"filename": filename, "error": "PDF not found", "matches": []}

    # Upload to /analyze and collect SSE
    print(f"  Uploading to {ANALYZE_URL} ...")
    t0   = time.time()
    resp = None
    try:
        with open(pdf_path, "rb") as f:
            resp = requests.post(
                ANALYZE_URL,
                files={"file": (filename, f, "application/pdf")},
                stream=True,
                timeout=300
            )
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print(f"  ERROR: Cannot reach backend at {BACKEND_URL}")
        print(f"  Make sure the backend is running: cd backend && python app.py")
        return {"filename": filename, "error": "Backend not reachable", "matches": []}
    except requests.exceptions.HTTPError as e:
        status = resp.status_code if resp is not None else "?"
        print(f"  ERROR: HTTP {status} — {e}")
        return {"filename": filename, "error": str(e), "matches": []}

    results = parse_sse_stream(resp)
    elapsed = round(time.time() - t0, 1)
    print(f"  Received {len(results)} citation results in {elapsed}s")

    # Match RefLens results → ground truth
    matches = []
    unmatched_gt  = list(gt_cits)   # GT entries not yet matched
    unmatched_res = []               # RefLens results not matched to any GT

    for res in results:
        res_title = res.get("title", "")
        gt_entry  = match_result_to_gt(res_title, unmatched_gt)

        if gt_entry:
            unmatched_gt.remove(gt_entry)
            matches.append({
                "gt_ref_num":     gt_entry["ref_num"],
                "gt_title":       gt_entry["title"],
                "gt_label":       gt_entry["ground_truth"],
                "reflens_title":  res_title,
                "reflens_status": res.get("status", "unknown"),
                "reflens_score":  res.get("aiScore", -1),
                "reflens_flags":  res.get("flags", []),
                "matched":        True
            })
            label_str = gt_entry["ground_truth"]
            pred_str  = res.get("status", "?")
            print(f"    [ref {gt_entry['ref_num']:2d}] GT={label_str:4s}  RefLens={pred_str:10s}  score={res.get('aiScore',-1):3}  \"{gt_entry['title'][:50]}\"")
        else:
            unmatched_res.append(res)

    # GT entries that got no RefLens result
    for gt_entry in unmatched_gt:
        matches.append({
            "gt_ref_num":     gt_entry["ref_num"],
            "gt_title":       gt_entry["title"],
            "gt_label":       gt_entry["ground_truth"],
            "reflens_title":  None,
            "reflens_status": "not_analyzed",
            "reflens_score":  -1,
            "reflens_flags":  [],
            "matched":        False
        })
        print(f"    [ref {gt_entry['ref_num']:2d}] GT={gt_entry['ground_truth']:4s}  RefLens=NOT_ANALYZED  \"{gt_entry['title'][:50]}\"")

    matched_count = sum(1 for m in matches if m["matched"])
    print(f"  Matched {matched_count}/{len(gt_cits)} citations to ground truth")

    return {
        "filename": filename,
        "topic":    paper["topic"],
        "matches":  matches,
        "unmatched_reflens_results": len(unmatched_res),
        "elapsed_seconds": elapsed
    }


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Check backend health first
    print("Checking backend health...")
    try:
        health = requests.get(f"{BACKEND_URL}/health", timeout=5)
        print(f"  Backend OK: {health.json()}")
    except Exception:
        print(f"  ERROR: Backend not reachable at {BACKEND_URL}")
        print(f"  Start it with:  cd backend && python app.py")
        exit(1)

    with open(GT_PATH) as f:
        gt = json.load(f)

    all_results = []
    for paper in gt["test_papers"]:
        result = evaluate_paper(paper)
        all_results.append(result)

    # Save raw results
    out_path = os.path.join(RESULTS_DIR, "raw_results.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Raw results saved to: {out_path}")
    print(f"Now run:  python evaluation/compute_metrics.py")
