# RefLens — Technical Interview Preparation

---

## What is RefLens?

RefLens is a full-stack AI-powered academic citation analysis tool. You upload a research paper (PDF), and it automatically:

1. Detects AI-generated or hallucinated citations
2. Identifies missing citations the author should have included
3. Scores each reference for reliability and relevance
4. Visualizes citation clusters as a force-directed network graph
5. Measures citation bias (self-citation, recency, venue diversity)

---

## High-Level Architecture

```
PDF Upload
    |
    +---> [GROBID] PDF parsing (TEI-XML)
    |         |
    |     SQLite cache (MD5 hash key)
    |
    +---> 4 parallel HTTP calls from frontend
          |
          +-- POST /analyze      (SSE stream)  --> AI detection + missing citations
          +-- POST /reliability  (sync JSON)   --> reference quality scores
          +-- POST /network      (sync JSON)   --> citation cluster graph
          +-- POST /bias         (sync JSON)   --> bias metrics
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask |
| PDF Parsing | GROBID (Docker, port 8070) |
| AI Agent | LangChain ReAct + GPT-4o-mini (OpenAI) |
| Embeddings | sentence-transformers — all-MiniLM-L6-v2 |
| Caching | SQLite (cache.db) |
| Frontend | React + TypeScript, Vite |
| Visualization | SVG force-directed graph (custom physics, no library) |
| PDF Viewer | react-pdf |
| External APIs | CrossRef, Semantic Scholar, OpenAlex, DBLP, CORE, arXiv, PubMed |

---

## Pipeline 1 — GROBID (Foundation for Everything)

**What it does:** Parses the raw PDF into structured data.

**How it works:**
- Sends the PDF via HTTP to a locally running GROBID Docker container
- GROBID returns TEI-XML (Text Encoding Initiative format)
- We parse that XML to extract:
  - Paper metadata (title, authors, abstract)
  - Full reference list with title, authors, year, DOI, venue
  - In-text citation map — for each reference, which sentences in the body cite it

**Caching:** The GROBID result is hashed by MD5 of the PDF bytes and stored in SQLite. Subsequent requests skip GROBID entirely.

**Key challenge:** GROBID sometimes mis-extracts DOIs or confuses venue names with paper titles. We added regex-based DOI extraction as a fallback and a pattern filter to detect when a venue name was labelled as a title.

---

## Pipeline 2 — AI Detection (`/analyze` endpoint, SSE stream)

This is the most complex pipeline. It runs as a **Server-Sent Events (SSE) stream** so the frontend receives results citation-by-citation in real time.

### Step 1 — Parallel API Pre-fetch

For each citation, we call 6 external academic databases **in parallel** using `ThreadPoolExecutor`:

- **CrossRef** — resolves DOI, returns canonical metadata
- **Semantic Scholar** — title/author search, citation count, abstract
- **OpenAlex** — open metadata aggregator
- **DBLP** — CS-focused bibliography (reliable for CS papers)
- **CORE** — open access full-text repository
- **arXiv** — preprint server

Each call has a 15-second timeout wrapped in a `_safe_result()` helper that catches any exception (timeout, network error) and returns `{"found": False}` so one API failure never crashes the whole analysis.

### Step 2 — Evidence Assembly

After pre-fetch, we build a structured evidence object:
- Title similarity scores (SequenceMatcher ratio, 0.0–1.0) between cited title and each DB result
- `doi_valid` — does the DOI resolve anywhere?
- `original_doi_failed` — DOI didn't resolve in CrossRef but title search found it
- `author_mismatch` — cited authors don't match any author returned from DBs (with similarity threshold 0.85 to avoid false positives)
- `doi_mismatch` — DOI resolves in CrossRef but to a completely different paper (sim < 0.4) AND no other DB confirms it (distinguishes GROBID mis-extraction from genuine hallucination)
- Best abstract from any source
- Citation count (used carefully — recent papers penalized less)

### Step 3 — LangChain ReAct Agent

The evidence is formatted as text and passed to a **LangChain ReAct agent** backed by GPT-4o-mini.

The agent is given:
- A system prompt with explicit scoring rules
- The citation text (title, authors, year, DOI)
- All the pre-fetched evidence
- Step-by-step reasoning instructions

**Scoring rules the agent applies:**
- Base score: 0
- Not found in any DB: +40
- DOI invalid (not resolved anywhere): +20
- DOI mismatch (resolves to different paper, not confirmed elsewhere): +30
- Author mismatch (surnames don't overlap, confirmed by high-similarity DB match): +25
- Original DOI failed but title found: +10 (weak signal only)
- Low citation count: context-dependent — post-2021 papers not penalized

**Output:**
```json
{
  "aiScore": 0-100,
  "status": "ai_likely | uncertain | human",
  "flags": ["DEAD_DOI", "AUTHOR_MISMATCH", ...],
  "reasoning": "..."
}
```

Results are streamed as SSE `citation` events as each citation finishes, and saved to `citation_cache` in SQLite for resumption if interrupted.

---

## Pipeline 3 — Missing Citations (`/analyze`, second thread)

Runs in parallel with AI detection inside the same `/analyze` endpoint.

### Step 1 — Section Extraction
Parses GROBID's raw XML to split the paper body into named sections (Introduction, Related Work, Methods, etc.).

### Step 2 — Claim Detection
Scans each section for sentences that:
- Make factual or quantitative claims
- Have **no** `[N]` citation marker attached

Uses GPT-4o-mini to classify whether each uncited sentence actually needs a citation, and generates a Semantic Scholar search query for it.

### Step 3 — Semantic Scholar Search + Similarity Scoring
For each uncited claim:
- Searches Semantic Scholar with the generated query
- Scores candidate papers by cosine similarity using `sentence-transformers/all-MiniLM-L6-v2`
- Ranks and filters results, removes junk papers (indexes, errata, papers with no abstract and low citation count)

### Step 4 — SS Recommendations API
Seeds the Semantic Scholar recommendations endpoint with paper IDs from the existing reference list — gets back related papers the author might have missed but didn't write a specific claim about.

### Step 5 — GPT-4o-mini Enrichment
For each candidate missing paper, calls GPT-4o-mini to generate:
- `reason` — why this paper should be cited
- `severity` — critical / high / medium
- `category` — foundational / competitor / methodological / dataset / survey

Emitted as a single `missing_complete` SSE event at the end.

---

## Pipeline 4 — Reliability (`/reliability`)

Scores each reference on:
- **Source credibility** — is it from a known venue, does it have a DOI, citation count?
- **Semantic relevance** — cosine similarity between the paper's abstract and the reference's abstract (using the same sentence-transformer model)
- **Recency** — how recent is the reference?
- **In-text usage** — is it actually cited in the body or just listed?

Returns a score per reference and aggregate metrics.

---

## Pipeline 5 — Citation Network (`/network`)

Clusters references into thematic groups using:
- Embedding all reference titles/abstracts
- Running k-means or agglomerative clustering on the embedding space
- Assigning cluster names using GPT-4o-mini

Frontend renders this as a **custom SVG force-directed graph** with no external graph library:
- Physics simulation: repulsion (inverse square), spring forces on edges, cluster cohesion, center gravity
- Runs via `requestAnimationFrame` for ~280 frames then settles
- Hover detection uses an invisible larger hit-area circle to prevent shaking

---

## Pipeline 6 — Bias (`/bias`)

Measures:
- **Self-citation rate** — how many references are by the same authors
- **Recency bias** — distribution of publication years
- **Venue diversity** — are references spread across journals/conferences or concentrated?
- **Geographic/language bias** (if detectable from metadata)

---

## Caching Strategy

All results keyed by `{pdf_md5}_{type}` in SQLite `cache.db`:

| Key | Content |
|---|---|
| `{hash}` (grobid_cache table) | Raw GROBID parse |
| `{hash}_ai` | Full AI detection result |
| `{hash}_missing` | Missing citations result |
| `{hash}_reliability` | Reliability scores |
| `{hash}_network` | Network clusters |
| `{hash}_bias` | Bias metrics |
| citation_cache table | Per-citation results for resumption |

Cache hit = zero API calls, instant response.

---

## Frontend Architecture

- **`App.tsx`** — central state manager. Fires 4 parallel fetch calls on PDF upload. Manages `StreamingState` (phase: idle / grobid / analyzing / complete / error).
- **`PDFViewer.tsx`** — left panel, always visible, uses `react-pdf`
- **`Sidebar.tsx`** — right panel (480px fixed), tab-based: Citation Detail, Missing Citations, Reliability, Network, Bias
- **SSE handling** — reads the `/analyze` stream event-by-event, updates citation list in real time as each result arrives
- **`types.ts`** — single source of truth for all shared interfaces between frontend and backend

---

## Key Engineering Decisions & Why

**Why GROBID?**
Open-source, battle-tested academic PDF parser. Handles complex bibliography formats, gives us structured XML with in-text citation positions. Running it in Docker means no Python dependency issues.

**Why SSE instead of WebSockets?**
SSE is unidirectional (server to client), simpler, and works over standard HTTP. Since we only need to push citation results as they finish, SSE is the right tool. WebSockets would be overkill.

**Why LangChain ReAct?**
The ReAct pattern (Reason + Act) lets the agent explain its reasoning step by step before giving a verdict. This makes results interpretable and debuggable. We can read the `reasoning` field to understand exactly why a citation was flagged.

**Why GPT-4o-mini specifically?**
Good enough accuracy for this task at much lower cost and latency than GPT-4o. The structured pre-fetched evidence does the heavy lifting — the LLM mostly needs to synthesize and apply rules, not recall facts.

**Why SQLite?**
Zero infrastructure. No Redis, no Postgres to run. For a single-server academic tool, SQLite is perfectly sufficient and trivially simple to deploy.

**Why custom force-directed graph?**
Avoids pulling in d3.js (large bundle) for a single visualization. The physics is straightforward and gives us full control over hover behavior, cluster coloring, and settling speed.

---

## Interesting Technical Challenges

### 1. DOI Mismatch vs. GROBID Extraction Error
GROBID sometimes extracts the wrong DOI from a PDF (e.g., picks up a DOI from a footnote). If we blindly flag "DOI resolves to a different paper" as hallucination, we get false positives on real papers.

**Solution:** When CrossRef similarity is low (< 0.4), we check all other databases. If any other DB confirms the paper with similarity >= 0.7, we classify it as a GROBID extraction error (not hallucination) and log it differently.

### 2. Author Mismatch False Positives
Author mismatch is a strong hallucination signal. But DBLP sometimes returns a different paper with a similar title and completely different authors.

**Solution:** Only trigger author mismatch when the title similarity to the DB result is >= 0.85. Below that threshold, we can't trust the DB match enough to compare authors.

### 3. Penalizing Recent Papers for Low Citation Count
A 2024 paper with 3 citations is not suspicious — it's new. The original scoring penalized any paper with low citation count, causing false positives for recent legitimate papers.

**Solution:** Post-2021 papers are exempt from citation-count penalties in the scoring rules.

### 4. Network Graph Hover Shaking
Changing the node radius on hover (to show selection) moved the mouse outside the node boundary, triggering a mouseLeave event, which reset the hover state, which shrank the radius back, which put the mouse inside again — infinite flicker.

**Solution:** Two-circle approach: an invisible, larger hit-area circle handles all mouse events; the visible circle has `pointer-events: none` and a fixed radius that never changes.

### 5. Prefetch Timeout Crash
If CrossRef or another API timed out mid-analysis, the unhandled exception propagated and crashed the entire analysis pipeline.

**Solution:** `_safe_result()` wrapper catches any exception from a future and returns a safe fallback dict, so one API failure is silently handled and analysis continues.

---

## Numbers to Know

- **6 external APIs** queried per citation in parallel
- **280 physics frames** for the network graph to settle
- **sentence-transformers/all-MiniLM-L6-v2** — 384-dimensional embeddings, runs locally
- **15-second timeout** per API call
- **Title similarity threshold: 0.85** for author mismatch to trigger
- **DOI mismatch threshold: 0.4** (CrossRef) + **0.7** (other DBs for confirmation)
- **4 parallel fetch calls** from frontend on upload
- **2 parallel threads** inside `/analyze` (AI detection + missing citations)

---

## How to Talk About It in an Interview

**One-sentence summary:**
"RefLens is a full-stack AI tool that detects hallucinated citations in academic papers by cross-referencing 6 academic databases in parallel and using a LangChain ReAct agent to reason about the evidence."

**What makes it technically interesting:**
- Multi-source evidence fusion with conflict resolution (DOI mismatch logic)
- Real-time streaming architecture (SSE) with per-item caching for resumption
- Local ML inference (sentence-transformers) combined with remote LLM (GPT-4o-mini) for cost efficiency
- Custom physics simulation in SVG with no external graph library
- Graceful degradation — any single API failure is caught and analysis continues

**What you'd improve with more time:**
- Replace the LangChain agent with a fine-tuned classifier for lower latency
- Add a vector database to cache embeddings and avoid recomputing similarity
- Move the physics simulation to a Web Worker to avoid blocking the main thread
- Add user accounts and persistent paper history
