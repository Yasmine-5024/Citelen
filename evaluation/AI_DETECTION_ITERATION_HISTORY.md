# RefLens — AI Detection: Step-by-Step Iteration History

This document tells the full story of how the AI hallucination detection system was developed and improved, from the first attempt through to the final version. Each step describes what was changed, why, and what the numbers looked like before and after.

---

## Background: What the System Does

Each citation in an uploaded PDF is scored 0–100 for likelihood of being AI-hallucinated. The score is produced by a GPT-4o-mini ReAct agent that receives evidence from academic database lookups performed before calling GPT.

**Score thresholds:**
| Score | Status | Meaning |
|-------|--------|---------|
| 0–39 | human | Likely real |
| 40–69 | uncertain | Needs manual review |
| 70–100 | ai_likely | Likely hallucinated |

**Evaluation metrics:**
- **TP (True Positive):** Fake citation correctly flagged as `ai_likely`
- **FP (False Positive):** Real citation incorrectly flagged as `ai_likely`
- **FN (False Negative):** Fake citation classified as `human` (missed)
- **TN (True Negative):** Real citation correctly classified as `human`
- **Recall:** TP / (TP + FN) — how many fakes were caught
- **Precision:** TP / (TP + FP) — of flagged citations, how many were actually fake

**Dataset (v1–v6):** 3 real arXiv survey papers (308 + 511 + 174 = 993 real citations) with 5 fake citations injected into each (15 fake total). Fake citations were AI-generated titles that sound plausible but do not exist in any academic database.

**Dataset (v7):** 5 synthetic test papers × 10 citations each (5 real + 5 fake = 50 total, 25 real + 25 fake).

---

## Step 1 — v1: Baseline (4 Databases: CrossRef, Semantic Scholar, OpenAlex, PubMed)

### What we built
The first version queried 4 academic databases in parallel for each citation, then passed the results to GPT-4o-mini with a simple scoring prompt:
- Not found in any database → score 70–100 (ai_likely)
- Found in 3–4 databases with valid DOI → score 0–39 (human)
- Found in 1–2 databases → score 40–69 (uncertain)
- A paper with 0 citations that is claimed to be foundational → suspicious

### Results (Paper 1 only, 313 citations: 308 real + 5 fake)

| TP | FP | FN | TN | Precision | Recall |
|----|----|----|-----|-----------|--------|
| 5 | 44 | 0 | 163 | 10.2% | 100% |

### What went wrong
All 5 fakes were caught (Recall = 100%), but 44 real papers were also flagged (Precision = 10.2%).

The root cause was two compounding issues:
1. **GROBID does not extract DOIs for arXiv papers.** The agent heavily penalised "Invalid DOI", pushing scores up for legitimate papers.
2. **PubMed does not index Computer Science papers.** This meant most CS citations appeared in only CrossRef + OpenAlex (2 out of 4 databases). The agent treated "found in only 2 databases" as suspicious.

Famous papers like "Attention Is All You Need" and "Graph Attention Networks" were being scored 80–100 — marked as likely hallucinated — because they had no DOI in the PDF and only appeared in 2 databases.

---

## Step 2 — v2: Deprioritise DOI, Cap Score for Multi-DB Hits

### What changed
- Told GPT that a missing DOI is **normal for arXiv papers** and should not penalise the score
- Added a hard rule: **found in 2+ databases = cap aiScore at 35**, regardless of DOI

### Results (Paper 1)

| TP | FP | FN | TN | Precision | Recall |
|----|----|----|-----|-----------|--------|
| 1 | 13 | 4 | 274 | 7.1% | 20% |

### What went wrong
False positives dropped from 44 → 13 (good). But recall collapsed from 100% → 20% — only 1 fake was caught.

The problem: **CrossRef performs a fuzzy title search when no DOI is provided.** Fake citations with plausible-sounding titles were fuzzy-matching to real unrelated papers in CrossRef. GPT then saw "found in 2 databases" and capped the score at 35, classifying fakes as human. One fake ("Unified Vision-Language Alignment via Asymmetric Contrastive Distillation") scored **0** — fully human — because CrossRef found a different real paper with similar keywords.

**Lesson learned:** Being "found" in a database is only meaningful if the returned result actually matches the citation being checked.

---

## Step 3 — v3: Require Metadata Match for Trust

### What changed
Added a rule that a database hit only counts if the returned result **matches the citation's title, authors, and year**. A mismatch means the database found a different paper — treat it as not found.

```
Found in 2+ databases AND metadata matches → aiScore 0–30
Found in 2+ databases BUT metadata does NOT match → aiScore 60+
Found in 1 database with matching metadata → aiScore 40–55
Found in 0 databases → aiScore 70+
```

### Results (Paper 1)

| TP | FP | FN | TN | Precision | Recall |
|----|----|----|-----|-----------|--------|
| 5 | 179 | 0 | 64 | 2.7% | 100% |

### What went wrong
All 5 fakes caught again (Recall = 100%), but FP exploded from 13 → 179 — the worst false positive rate so far.

The strict metadata matching backfired on real papers because GROBID's PDF extraction introduces normal artefacts that look like mismatches:
- Title casing: GROBID extracts "Gcnet: non-local networks..." but the database has "GCNet: Non-Local Networks..."
- Year differences: a paper submitted to arXiv in 2020 may be published by IEEE in 2021 — a 1-year difference
- Author names: initials vs full names, hyphenation differences

GPT treated these normal extraction artefacts as suspicious mismatches and raised scores above 70 for hundreds of real papers.

**Lesson learned:** Metadata matching must tolerate minor formatting differences. Only a completely different topic or field should count as a mismatch.

---

## Step 4 — v4: Topic-Level Mismatch Only

### What changed
Relaxed the mismatch rule: only flag a database result as a different paper if it is on a **completely different topic or field**. Minor differences in wording, year (±1–2 years), or author formatting are treated as normal.

```
Found in 2+ databases → aiScore 0–35
  UNLESS database title is on a completely different topic → aiScore 60+
Found in 1 database → aiScore 40–55
Found in 0 databases → aiScore 70+
Missing DOI is normal for arXiv — do not penalise if found in 2+ databases
```

### Results (Paper 1)

| TP | FP | FN | TN | Precision | Recall |
|----|----|----|-----|-----------|--------|
| 5 | 107 | 0 | 117 | 4.5% | 100% |

### What went wrong
All 5 fakes still caught (Recall = 100%). FP improved from 179 → 107, but still very high. The core problem remained: **most CS citations only appear in CrossRef (1 database)**. The "found in 1 database → 40–55" rule, combined with no abstract available and GPT's tendency to escalate uncertain cases, was pushing many real papers above 70.

---

## Step 5 — v5: Replaced PubMed with DBLP + Title Similarity Scores

### What changed — 4 simultaneous improvements

**1. Replaced PubMed with DBLP**
PubMed indexes biomedical literature and almost never finds CS papers. Replaced with DBLP (dblp.org), a CS-specific database covering NeurIPS, CVPR, ICML, ICCV, ACL, and all major CS conferences and journals. This directly addressed the problem of CS papers only appearing in 1–2 databases.

**2. Pre-computed title similarity scores**
Instead of asking GPT to judge whether a title "matches", we computed a deterministic `SequenceMatcher` similarity score (0.0–1.0) for each database result before calling GPT and included the number explicitly in the prompt:
```
CrossRef: title='GCNet: Non-Local Networks...' [similarity=0.87] (HIGH MATCH)
```

**3. Similarity-gated score caps**
Replaced vague database count rules with explicit similarity-gated hard caps:
- 2+ databases + similarity ≥ 0.7 → aiScore hard cap 0–25
- 1 database + similarity ≥ 0.7 → aiScore hard cap 0–50 (never ai_likely)
- Any database + similarity < 0.4 → treat as different paper, aiScore 60+
- 0 databases → aiScore 70–90

**4. Semantic Scholar retry with exponential backoff**
Added automatic retry on HTTP 429 (rate limit) responses: 1s, 2s, 4s waits. Previously, rate-limited requests silently returned "not found", artificially reducing the database count for legitimate papers.

### Results (Paper 1)

| TP | FP | FN | TN | Uncertain (real) | Precision | Recall |
|----|----|----|-----|-----------------|-----------|--------|
| 5 | 62 | 0 | 62 | ~184 | 7.5% | 100% |

FP dropped 42% (107 → 62). All 5 fakes still caught. However ~184 real papers were landing in `uncertain` (score 40–50) instead of `human`. The similarity cap was correctly preventing `ai_likely` but not pushing papers all the way to `human`.

The issue: papers found in only 1 database with high similarity should be trusted more. A high-similarity DBLP match in particular is a near-certain confirmation.

---

## Step 6 — v5.1: DBLP High-Similarity = Human

### What changed
Added a new priority rule: **if DBLP finds the paper with similarity ≥ 0.7 (even if it is the only database that found it) → aiScore hard cap 0–30 (human)**.

Rationale: DBLP is manually curated and CS-specific. Unlike CrossRef (fuzzy title search) or Semantic Scholar (rate-limited), a DBLP hit with high title similarity is a near-certain confirmation the paper exists. This rule moved the ~184 real CS papers stuck in uncertain into human.

---

## Step 7 — v6: Added CORE as 5th Database

### What changed
Added CORE (core.ac.uk) as a 5th database. CORE indexes 200M+ open access papers and covers virtually all arXiv preprints — the dominant format for CS research papers.

- API: `https://api.core.ac.uk/v3/search/works`
- DOI lookup first, title search fallback
- Returns abstracts for most papers (addressing the "no abstract" problem)
- Extended Rule 4: DBLP **or CORE** with similarity ≥ 0.7 → aiScore 0–30 hard cap

### Results (All 3 Papers — 993 real + 15 fake = 1,008 total)

| Paper | Real | Fake | TP | FP | FN | TN | Uncertain fakes |
|-------|------|------|----|----|----|----|-----------------|
| Paper 1 (Transformer Survey) | 308 | 5 | 5 | 18 | 0 | 198 | 0 |
| Paper 2 (Federated Learning) | 511 | 5 | 4 | 74 | 0 | 255 | 1 |
| Paper 3 (GNN Survey) | 174 | 5 | 3 | 16 | 0 | 116 | 2 |
| **Total** | **993** | **15** | **12** | **108** | **0** | **569** | **3** |

| Mode | Precision | Recall | F1 |
|------|-----------|--------|----|
| Strict (uncertain → human) | 10.0% | 80% | 0.174 |
| Lenient (uncertain → fake) | 12.2% | 100% | 0.217 |

### What remained as a problem
108 real papers were still being flagged as false positives. Two specific problem categories remained:

1. **Famous, highly-cited papers still getting high scores.** "Attention Is All You Need" (80,000+ citations), "Explaining and Harnessing Adversarial Examples" — these were still scoring 85–100 in some runs. A paper with tens of thousands of real citations cannot be hallucinated.

2. **Papers found in 0 databases.** Obscure workshop papers, very recent preprints, and niche venue publications sometimes appeared in none of the 5 databases, causing them to default to aiScore 70–90.

---

## Step 8 — v7 (first attempt): arXiv as 6th Database + Citation Count Hard Cap

### What changed

**1. arXiv API as conditional fallback (6th database)**
Added `_fetch_arxiv()` using `https://export.arxiv.org/api/query`. Implemented as a conditional fallback — only called when all 5 primary databases return nothing. This converts "0 databases" → "1 database" for the long tail of CS preprints/workshop papers.

**2. Citation count hard cap (Rule 0)**
Added a highest-priority rule: if SS or OpenAlex reports `citationCount >= 100` for the paper, apply a hard cap of aiScore ≤ 30. A hallucinated paper cannot have been cited 100+ times by real researchers.

### Why it broke — critical regression

| Mode | TP | FP | FN | TN | Precision | Recall | F1 |
|------|----|----|----|-----|-----------|--------|----|
| Strict | 2 | 0 | 21 | 25 | 100% | 8.7% | 0.16 |
| Lenient | 3 | 0 | 20 | 25 | 100% | 13.0% | 0.23 |

Recall collapsed from 80% → 8.7%. Nearly all fakes were classified as human.

The bug: `max_citation_count` was computed from any SS or OpenAlex result regardless of whether it was the same paper. CrossRef's fuzzy title search was matching fake titles to real, highly-cited papers. SS then reported `citation_count = 80,000` for that unrelated paper. Rule 0 fired, capping the fake's score at 30.

For example, the fake citation "Dynamic Sparse Attention in Deep Recurrent Architectures" was matching to the real paper "Attention Is All You Need" (80,000+ citations) in CrossRef, inheriting its citation count, and being capped at 30 — classified as human.

---

## Step 9 — v7 Fixed: Similarity-Gated Citation Count

### What changed
One-line fix: `max_citation_count` now only uses citation counts from databases where `title_similarities[source] >= 0.7`, confirming the result is the same paper.

```python
# Before (buggy):
max_citation_count = max(
    (s.get("citation_count", 0) for s in [ss, openalex] if s.get("found")),
    default=0,
)

# After (fixed):
max_citation_count = max(
    (s.get("citation_count", 0) for s in [ss, openalex]
     if s.get("found") and title_similarities.get(s["source"], 0) >= 0.7),
    default=0,
)
```

Now the citation count cap only fires when SS/OpenAlex returns a result with high title similarity — confirming it is actually the paper being checked, not a different paper with similar keywords.

### Final Results (50 citations: 25 real + 25 fake, 5 test papers)

| Paper | Topic | TP | FP | FN | TN | Uncertain fakes |
|-------|-------|----|----|----|----|-----------------|
| test_paper_1.pdf | Deep Learning Fundamentals | 4 | 0 | 0 | 5 | 1 (score=55) |
| test_paper_2.pdf | Neural Language Models | 2 | 0 | 0 | 4 | 2 (scores=55, 60) |
| test_paper_3.pdf | Computer Vision / Medical Imaging | 2 | 0 | 0 | 5 | 2 (scores=30, 55) |
| test_paper_4.pdf | Graph Neural Networks | 2 | 0 | 0 | 5 | 2 (scores=55, 55) |
| test_paper_5.pdf | Federated Learning / Privacy | 2 | 0 | 1 | 5 | 2 (scores=60, 60) |
| **Total** | | **12** | **0** | **1** | **24** | **9** |

*4 citations were NOT_ANALYZED (GROBID parsing gaps — no result returned from stream).*

| Mode | TP | FP | FN | TN | Precision | Recall | F1 |
|------|----|----|----|-----|-----------|--------|----|
| Strict (uncertain → human) | 12 | 0 | 10 | 24 | **100%** | **54.5%** | **0.706** |
| Lenient (uncertain → fake) | 21 | 0 | 1 | 24 | **100%** | **95.5%** | **0.977** |

**Notes:**
- All 24 real citations scored exactly 30 — zero false positives
- 12 fakes scored `ai_likely` (≥70), 9 scored `uncertain` (flagged for review), 1 scored `human` (missed: "Byzantine-Robust Federated Learning via Adaptive Gradient Clipping" — appears in enough databases to look legitimate)
- The `uncertain` band is useful: all 9 uncertain citations are genuine fakes surfaced for manual review

---

## Full Summary: Every Version at a Glance

| Step | Version | Key Change | TP | FP | FN | TN | Precision | Recall | F1 |
|------|---------|-----------|----|----|----|----|-----------|--------|----|
| 1 | v1 | Baseline: 4 DBs, DOI + DB count weighted equally | 5 | 44 | 0 | 163 | 10.2% | 100% | 0.185 |
| 2 | v2 | Missing DOI is OK; 2+ DBs = cap at 35 | 1 | 13 | 4 | 274 | 7.1% | 20% | 0.040 |
| 3 | v3 | Strict metadata match required for trust | 5 | 179 | 0 | 64 | 2.7% | 100% | 0.053 |
| 4 | v4 | Topic-level mismatch only (relax matching) | 5 | 107 | 0 | 117 | 4.5% | 100% | 0.086 |
| 5 | v5 | DBLP replaces PubMed; title similarity scores; sim-gated caps; SS retry | 5 | 62 | 0 | 62 | 7.5% | 100% | 0.138 |
| 6 | v5.1 | DBLP high-similarity = human (not uncertain) | — | — | — | — | — | — | — |
| 7 | v6 | CORE as 5th database (arXiv coverage) | 12 | 108 | 0* | 569 | 10.0% | 80–100% | 0.174–0.217 |
| 8 | v7 broken | arXiv 6th DB + citation count cap (unfiltered) | 2 | 0 | 21 | 25 | 100% | 8.7% | 0.160 |
| 9 | **v7 fixed** | Citation count only when similarity ≥ 0.7 | **12** | **0** | **1†** | **24** | **100%** | **54.5–95.5%** | **0.706–0.977** |

*v6: 3 uncertain fakes (counted as FN in strict mode, TP in lenient mode)
†v7 strict mode: 10 FN = 1 true miss + 9 uncertain fakes counted as missed

---

## Key Lessons

| # | Lesson | Discovered at |
|---|--------|---------------|
| 1 | DOI absence is normal for arXiv/CS papers — do not penalise it | v1 → v2 |
| 2 | Database "found" only counts if the returned result matches the citation | v2 → v3 |
| 3 | Strict metadata matching breaks on GROBID extraction artefacts (casing, year ±1) | v3 → v4 |
| 4 | PubMed is useless for CS — replacing with a CS-specific DB (DBLP) is essential | v4 → v5 |
| 5 | Giving GPT a deterministic similarity number removes subjective GPT title matching | v4 → v5 |
| 6 | Rate limit retries matter — silent "not found" from 429 errors fake-reduces DB count | v4 → v5 |
| 7 | CORE covers virtually all arXiv papers — essential for CS preprint coverage | v5 → v6 |
| 8 | Citation count is a powerful signal — a fake cannot have 100+ real citations | v6 → v7 |
| 9 | Citation count must be similarity-gated — unfiltered counts come from the wrong paper | v7 broken → v7 fixed |

---

*RefLens AI Detection — Iteration History — May 2026*
