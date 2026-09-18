"""
Step 4 — Compute precision, recall, F1 and a full confusion matrix from
the raw results produced by run_evaluation.py.

Run from the project root:
    cd backend && source venv/Scripts/activate
    cd .. && python evaluation/compute_metrics.py

Reads:   evaluation/results/raw_results.json
Outputs: evaluation/results/metrics_report.txt  (and prints to console)

Decision rule:
    RefLens status "ai_likely"  → predicted FAKE
    RefLens status "uncertain"  → predicted UNCERTAIN (treated as REAL for F1)
    RefLens status "human"      → predicted REAL
    "not_analyzed"              → excluded from metrics

We report two sets of metrics:
    Strict  — uncertain counts as REAL (conservative; we only flag what we're sure about)
    Lenient — uncertain counts as FAKE (aggressive; flag anything that isn't clearly human)
"""

import json
import os

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(SCRIPT_DIR, "results")
RAW_PATH    = os.path.join(RESULTS_DIR, "raw_results.json")
OUT_PATH    = os.path.join(RESULTS_DIR, "metrics_report.txt")


# ── Metric helpers ─────────────────────────────────────────────────────────────

def safe_div(num, den):
    return round(num / den, 3) if den > 0 else 0.0


def compute_metrics(tp, fp, fn, tn):
    precision = safe_div(tp, tp + fp)
    recall    = safe_div(tp, tp + fn)
    f1        = safe_div(2 * precision * recall, precision + recall)
    accuracy  = safe_div(tp + tn, tp + fp + fn + tn)
    return precision, recall, f1, accuracy


def classify(reflens_status: str, uncertain_is_fake: bool) -> str | None:
    """Map RefLens status to FAKE/REAL prediction, or None to exclude."""
    if reflens_status == "ai_likely":
        return "FAKE"
    if reflens_status == "human":
        return "REAL"
    if reflens_status == "uncertain":
        return "FAKE" if uncertain_is_fake else "REAL"
    return None   # not_analyzed or unknown → exclude


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(RAW_PATH):
        print(f"ERROR: {RAW_PATH} not found.")
        print("Run:  python evaluation/run_evaluation.py  first.")
        return

    with open(RAW_PATH) as f:
        all_results = json.load(f)

    lines = []

    def out(text=""):
        print(text)
        lines.append(text)

    out("=" * 65)
    out("  RefLens AI Detection — Quantitative Evaluation Report")
    out("=" * 65)

    # ── Collect all matched entries ─────────────────────────────────────────
    all_matches = []
    for paper_result in all_results:
        if paper_result.get("error"):
            out(f"\n  SKIPPED {paper_result['filename']}: {paper_result['error']}")
            continue
        all_matches.extend(paper_result["matches"])

    matched    = [m for m in all_matches if m["matched"]]
    unanalyzed = [m for m in all_matches if not m["matched"]]

    out(f"\n  Total citations in ground truth : {len(all_matches)}")
    out(f"  Matched by RefLens              : {len(matched)}")
    out(f"  Not analyzed (GROBID missed)    : {len(unanalyzed)}")

    # ── Per-paper breakdown ─────────────────────────────────────────────────
    out(f"\n{'─'*65}")
    out("  Per-paper results")
    out(f"{'─'*65}")
    out(f"  {'Paper':<35} {'GT':>5} {'Matched':>7} {'ai_likely':>9} {'uncertain':>9} {'human':>7}")
    out(f"  {'-'*35} {'-'*5} {'-'*7} {'-'*9} {'-'*9} {'-'*7}")

    for pr in all_results:
        if pr.get("error"):
            continue
        m = [x for x in pr["matches"] if x["matched"]]
        n_ai  = sum(1 for x in m if x["reflens_status"] == "ai_likely")
        n_unc = sum(1 for x in m if x["reflens_status"] == "uncertain")
        n_hum = sum(1 for x in m if x["reflens_status"] == "human")
        out(f"  {pr['filename']:<35} {len(pr['matches']):>5} {len(m):>7} {n_ai:>9} {n_unc:>9} {n_hum:>7}")

    # ── Score distribution analysis ─────────────────────────────────────────
    out(f"\n{'─'*65}")
    out("  aiScore distribution (matched citations only)")
    out(f"{'─'*65}")
    out(f"  {'Ref':<4} {'GT':>5}  {'Status':>12}  {'Score':>5}  {'Title':<45}")
    out(f"  {'-'*4} {'-'*5}  {'-'*12}  {'-'*5}  {'-'*45}")

    for pr in all_results:
        if pr.get("error"):
            continue
        for m in sorted(pr["matches"], key=lambda x: x["gt_ref_num"]):
            if not m["matched"]:
                continue
            title_short = (m["gt_title"][:43] + "..") if len(m["gt_title"]) > 45 else m["gt_title"]
            score_str   = str(m["reflens_score"]) if m["reflens_score"] >= 0 else "N/A"
            out(f"  {m['gt_ref_num']:<4} {m['gt_label']:>5}  {m['reflens_status']:>12}  {score_str:>5}  {title_short:<45}")

    # ── Confusion matrices + metrics ────────────────────────────────────────
    for uncertain_is_fake, label in [(False, "STRICT (uncertain → REAL)"),
                                      (True,  "LENIENT (uncertain → FAKE)")]:
        out(f"\n{'─'*65}")
        out(f"  Confusion Matrix — {label}")
        out(f"{'─'*65}")

        tp = fp = fn = tn = 0
        skipped = 0

        for m in matched:
            pred = classify(m["reflens_status"], uncertain_is_fake)
            if pred is None:
                skipped += 1
                continue
            gt = m["gt_label"]

            if gt == "FAKE" and pred == "FAKE":
                tp += 1
            elif gt == "REAL" and pred == "FAKE":
                fp += 1
            elif gt == "FAKE" and pred == "REAL":
                fn += 1
            elif gt == "REAL" and pred == "REAL":
                tn += 1

        precision, recall, f1, accuracy = compute_metrics(tp, fp, fn, tn)

        out(f"\n                     Predicted FAKE   Predicted REAL")
        out(f"  Actual FAKE              {tp:3d}               {fn:3d}")
        out(f"  Actual REAL              {fp:3d}               {tn:3d}")
        out("")
        out(f"  TP={tp}  FP={fp}  FN={fn}  TN={tn}  (skipped={skipped})")
        out("")
        out(f"  Precision  = TP / (TP+FP) = {tp} / {tp+fp} = {precision:.3f}")
        out(f"  Recall     = TP / (TP+FN) = {tp} / {tp+fn} = {recall:.3f}")
        out(f"  F1 Score   = 2*(P*R)/(P+R)              = {f1:.3f}")
        out(f"  Accuracy   = (TP+TN) / total             = {accuracy:.3f}")
        out("")
        if precision > 0 or recall > 0:
            if f1 >= 0.75:
                out(f"  Interpretation: STRONG detection performance (F1={f1:.2f})")
            elif f1 >= 0.5:
                out(f"  Interpretation: MODERATE detection performance (F1={f1:.2f})")
            else:
                out(f"  Interpretation: WEAK detection performance (F1={f1:.2f}) — review threshold or agent prompting")

    # ── Error analysis ──────────────────────────────────────────────────────
    out(f"\n{'─'*65}")
    out("  Error Analysis — False Positives and False Negatives")
    out(f"{'─'*65}")

    out("\n  False Positives (REAL flagged as ai_likely):")
    fp_list = [m for m in matched if m["gt_label"] == "REAL" and m["reflens_status"] == "ai_likely"]
    if fp_list:
        for m in fp_list:
            out(f"    [ref {m['gt_ref_num']}] score={m['reflens_score']} flags={m['reflens_flags']}")
            out(f"          \"{m['gt_title']}\"")
    else:
        out("    None")

    out("\n  False Negatives (FAKE classified as human):")
    fn_list = [m for m in matched if m["gt_label"] == "FAKE" and m["reflens_status"] == "human"]
    if fn_list:
        for m in fn_list:
            out(f"    [ref {m['gt_ref_num']}] score={m['reflens_score']} flags={m['reflens_flags']}")
            out(f"          \"{m['gt_title']}\"")
    else:
        out("    None")

    out("\n  Uncertain cases (may warrant manual review):")
    unc_list = [m for m in matched if m["reflens_status"] == "uncertain"]
    if unc_list:
        for m in unc_list:
            out(f"    [ref {m['gt_ref_num']}] GT={m['gt_label']:4s} score={m['reflens_score']} \"{m['gt_title'][:55]}\"")
    else:
        out("    None")

    out(f"\n{'='*65}")

    # Save to file
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\nReport saved to: {OUT_PATH}")


if __name__ == "__main__":
    main()
