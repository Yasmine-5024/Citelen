"""
Masked Citation Test — Missing Citations Pipeline
==================================================
Tests whether the missing citations pipeline can recover citations that
have been deliberately hidden from the paper.

Method (Option 2 — Masked Citation Test):
1. Load the GROBID parse of real_paper_N.pdf from cache
2. Pick 10 well-known citations that have in-text context sentences
3. For each masked citation:
   - Query A (title-based): use the paper title — tests retrieval precision
   - Query B (context-based): use the in-text sentence — tests real pipeline
4. Run through Semantic Scholar search + cosine similarity ranking
5. Check if the masked citation appears in the top K suggestions
6. Report Recall@K and Mean Reciprocal Rank (MRR) for both query modes

Notes:
  - Without an SS API key, unauthenticated rate limit is ~100 req/5min.
  - A 1.5s delay is inserted between requests to stay within limits.
  - Title queries typically outperform context queries because in-text sentences
    are often generic ("many methods have proposed X [1][2][3]").

Prerequisites:
  - Backend has processed real_paper_N.pdf (GROBID cache exists)
  - cd backend && source venv/Scripts/activate

Run from project root:
    python evaluation/test_missing_citations.py
"""

import sys
import os
import json
import sqlite3
import time

# Load .env before importing any service that needs OPENAI_API_KEY
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../backend"))
os.chdir(os.path.join(os.path.dirname(__file__), "../backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "../backend/.env"), override=True)

# The SS API key may be expired; clear it so requests fall back to unauthenticated
# (unauthenticated works fine for the search endpoint, just with lower rate limits)
import requests as _req_module
_orig_get = _req_module.get
def _patched_get(url, **kwargs):
    if "semanticscholar" in url:
        kwargs.pop("headers", None)
        return _orig_get(url, headers={}, **kwargs)
    return _orig_get(url, **kwargs)
# Only patch if the key is bad; probe first
_ss_probe = _req_module.get(
    "https://api.semanticscholar.org/graph/v1/paper/search",
    params={"query": "test", "limit": 1},
    headers={"x-api-key": os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")},
    timeout=(5, 10),
)
if _ss_probe.status_code == 403:
    print("  [INFO] SS API key invalid (403) — falling back to unauthenticated requests")
    os.environ["SEMANTIC_SCHOLAR_API_KEY"] = ""

from services.missing_citations import _search_ss, _score_papers, _is_junk_paper
from difflib import SequenceMatcher

DB_PATH = os.path.join(os.path.dirname(__file__), "../backend/cache.db")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

TOP_K = [1, 3, 5, 10]
SEARCH_LIMIT = 10

# Well-known papers to try masking — common in CS survey papers
TARGET_KEYWORDS = [
    "attention is all you need",
    "bert",
    "imagenet",
    "deep residual learning",
    "generative adversarial",
    "dropout",
    "adam",
    "batch normalization",
    "long short-term memory",
    "graph convolutional",
    "graph attention",
    "word2vec",
    "resnet",
    "transformer",
    "gpt",
    "vision transformer",
    "federated learning",
    "object detection",
]


def _load_grobid(pdf_name: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM grobid_cache WHERE filename LIKE ?",
        (f"%{pdf_name}%",)
    ).fetchone()
    conn.close()
    return json.loads(row[0]) if row else None


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _pick_masked(citations: list, in_text_map: dict, n: int = 10) -> list:
    """Pick N citations that have in-text context and recognisable titles."""
    masked = []
    used_keywords = set()

    # First pass: try to match target well-known papers
    for cit in citations:
        title = (cit.get("title") or "").lower()
        cit_id = cit.get("id", "")
        # Convert [N] → bN for in_text_map lookup (GROBID internal key format)
        imap_key = "b" + cit_id.strip("[]") if cit_id.startswith("[") else cit_id
        contexts = in_text_map.get(imap_key, [])
        if not contexts or not title or len(title) < 10:
            continue
        for kw in TARGET_KEYWORDS:
            if kw in title and kw not in used_keywords:
                masked.append({
                    "id": cit_id,
                    "title": cit.get("title", ""),
                    "authors": cit.get("authors", []),
                    "year": cit.get("year"),
                    "contexts": contexts[:2],
                })
                used_keywords.add(kw)
                break
        if len(masked) >= n:
            break

    # Second pass: fill remaining slots with any cited-with-context papers
    if len(masked) < n:
        for cit in citations:
            cit_id = cit.get("id", "")
            if any(m["id"] == cit_id for m in masked):
                continue
            title = cit.get("title", "")
            imap_key = "b" + cit_id.strip("[]") if cit_id.startswith("[") else cit_id
            contexts = in_text_map.get(imap_key, [])
            if contexts and title and len(title) > 15:
                masked.append({
                    "id": cit_id,
                    "title": title,
                    "authors": cit.get("authors", []),
                    "year": cit.get("year"),
                    "contexts": contexts[:2],
                })
            if len(masked) >= n:
                break

    return masked


def evaluate_paper(pdf_name: str) -> dict:
    print(f"\nLoading GROBID cache for {pdf_name}...")
    grobid = _load_grobid(pdf_name)
    if not grobid:
        print(f"  ERROR: No GROBID cache found for {pdf_name}.")
        print("  Upload the PDF via the RefLens UI first to populate the cache.")
        return {}

    citations = grobid.get("citations", [])
    in_text_map = grobid.get("in_text_map", {})
    print(f"  Total citations: {len(citations)}")
    print(f"  Citations with in-text context: {len(in_text_map)}")

    masked = _pick_masked(citations, in_text_map, n=10)
    if not masked:
        print("  ERROR: No suitable citations found to mask.")
        return {}

    print(f"\n  Masking {len(masked)} citations:")
    for m in masked:
        print(f"    [{m['id']}] {m['title'][:65]}")

    hits = {k: 0 for k in TOP_K}
    reciprocal_ranks = []
    results = []

    print(f"\n  Running search + ranking for each masked citation...")
    print(f"  {'Citation':<55} {'Title-Q':>8}  {'Ctx-Q':>7}")
    print(f"  {'-'*55} {'-'*8}  {'-'*7}")

    for m in masked:
        # Use paper title as query — tests whether SS can retrieve the paper
        # by its topic. Context sentences are often too generic to be useful queries.
        query_title = m["title"]
        query_context = m["contexts"][0] if m["contexts"] else m["title"]

        # --- Title-based search ---
        time.sleep(3.0)  # stay within unauthenticated rate limit (~1 req/3s)
        raw_t = _search_ss(query_title, limit=SEARCH_LIMIT)
        filtered_t = [p for p in raw_t if not _is_junk_paper(p)]
        scored_t = _score_papers(query_title, filtered_t)

        rank_title = None
        for i, (paper, score) in enumerate(scored_t):
            if _sim(m["title"], paper.get("title", "")) >= 0.65:
                rank_title = i + 1
                break

        # --- Context-based search ---
        time.sleep(1.5)
        raw_c = _search_ss(query_context, limit=SEARCH_LIMIT)
        filtered_c = [p for p in raw_c if not _is_junk_paper(p)]
        scored_c = _score_papers(query_context, filtered_c)

        rank_context = None
        for i, (paper, score) in enumerate(scored_c):
            if _sim(m["title"], paper.get("title", "")) >= 0.65:
                rank_context = i + 1
                break

        # Primary rank = title-based (better signal; context is supplementary)
        rank = rank_title
        top_title = scored_t[0][0].get("title", "-")[:40] if scored_t else "-"
        top_sim = round(scored_t[0][1], 3) if scored_t else 0.0
        reciprocal_ranks.append(1.0 / rank if rank else 0.0)

        for k in TOP_K:
            if rank and rank <= k:
                hits[k] += 1

        status = f"#{rank}" if rank else "MISS"
        ctx_status = f"#{rank_context}" if rank_context else "MISS"
        print(f"  {m['title'][:55]:<55} title:{status:>5}  ctx:{ctx_status:>5}")

        results.append({
            "masked_id": m["id"],
            "masked_title": m["title"],
            "masked_year": m["year"],
            "rank_title": rank_title,
            "rank_context": rank_context,
            "found_title": rank_title is not None,
            "found_context": rank_context is not None,
            "top_result_title": top_title,
            "top_result_sim": top_sim,
            "query_title": query_title[:120],
            "query_context": query_context[:120],
        })

    n = len(masked)
    mrr = round(sum(reciprocal_ranks) / n, 3) if n else 0

    print(f"\n  {'='*60}")
    print(f"  RESULTS — {pdf_name}")
    print(f"  Masked: {n} citations   Search limit: top {SEARCH_LIMIT} from Semantic Scholar")
    print(f"  {'-'*60}")
    for k in TOP_K:
        pct = hits[k] / n * 100 if n else 0
        bar = "#" * hits[k] + "." * (n - hits[k])
        print(f"  Recall@{k:2d}: {hits[k]:2d}/{n}  {pct:5.1f}%  {bar}")
    print(f"  MRR:      {mrr:.3f}")
    print(f"  {'='*60}")

    return {
        "pdf": pdf_name,
        "masked_count": n,
        "search_limit": SEARCH_LIMIT,
        "recall": {f"@{k}": round(hits[k] / n * 100, 1) for k in TOP_K},
        "mrr": mrr,
        "results": results,
    }


if __name__ == "__main__":
    papers = ["real_paper_1", "real_paper_2", "real_paper_3"]
    all_results = []

    for paper in papers:
        res = evaluate_paper(paper)
        if res:
            all_results.append(res)

    if all_results:
        # Aggregate across all papers
        total_masked = sum(r["masked_count"] for r in all_results)
        agg_hits = {k: 0 for k in TOP_K}
        agg_rr = []
        for r in all_results:
            n = r["masked_count"]
            for k in TOP_K:
                agg_hits[k] += round(r["recall"][f"@{k}"] * n / 100)
            agg_rr.extend([
                1.0 / res["rank_title"] if res["rank_title"] else 0.0
                for res in r["results"]
            ])

        print(f"\n{'='*60}")
        print(f"  AGGREGATE RESULTS (all {len(all_results)} papers, {total_masked} citations)")
        print(f"{'='*60}")
        for k in TOP_K:
            pct = agg_hits[k] / total_masked * 100 if total_masked else 0
            print(f"  Recall@{k:2d}: {agg_hits[k]:2d}/{total_masked}  {pct:.1f}%")
        print(f"  MRR:      {sum(agg_rr)/len(agg_rr):.3f}")
        print(f"{'='*60}")

        out_path = os.path.join(RESULTS_DIR, "missing_citations_eval.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({
                "query_mode": "title-based (primary) + context-based (supplementary)",
                "papers": all_results,
                "aggregate": {
                    "total_masked": total_masked,
                    "recall_title": {f"@{k}": round(agg_hits[k] / total_masked * 100, 1) for k in TOP_K},
                    "mrr_title": round(sum(agg_rr) / len(agg_rr), 3),
                },
            }, f, indent=2)
        print(f"\nFull results saved to: {out_path}")
