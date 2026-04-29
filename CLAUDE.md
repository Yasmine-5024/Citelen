# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
cd backend
python -m venv venv
source venv/Scripts/activate        # Windows Git Bash
pip install -r requirements.txt
python app.py                        # runs Flask on port 5000
```

**GROBID must be running** before the backend will work:
```bash
# Run GROBID via Docker
docker run --rm -p 8070:8070 lfoppiano/grobid:0.8.0
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # dev server on port 5173
npm run build     # production build → dist/
```

### Environment
Create `backend/.env` with:
```
OPENAI_API_KEY=...
SEMANTIC_SCHOLAR_API_KEY=...   # optional, increases rate limits
```

---

## Architecture

### Request Flow

When a PDF is uploaded, the frontend fires **4 parallel fetch calls**:

| Call | Endpoint | Type | Description |
|------|----------|------|-------------|
| 1 | `POST /analyze` | SSE stream | AI detection + missing citations (parallel threads) |
| 2 | `POST /reliability` | Sync JSON | Reference reliability/relevance scores |
| 3 | `POST /network` | Sync JSON | Citation cluster graph |
| 4 | `POST /bias` | Sync JSON | Citation bias metrics |

### GROBID as the Shared Foundation

All 4 endpoints start by extracting the PDF through GROBID (`services/grobid.py`). The result is cached by PDF MD5 hash in SQLite (`cache.db`, table `grobid_cache`) so subsequent calls skip re-parsing. The parsed output contains:
- `metadata` — paper title + authors
- `citations` — list of all references with id, title, authors, year, doi, venue
- `in_text_map` — maps `"b{num}"` → list of surrounding sentences where each reference is cited
- `raw_xml` — raw TEI-XML string (used by `section_extractor`)

### `/analyze` — Two Parallel Pipelines

The endpoint spawns two threads via `ThreadPoolExecutor`:

**Pipeline 1 — AI Detection** (`services/citation_agent.py`):
- For each reference, calls 4 academic APIs in parallel (CrossRef, Semantic Scholar, OpenAlex, PubMed) via `prefetch_citation_data()`
- Passes the enriched evidence to a LangChain ReAct agent backed by `gpt-4o-mini`
- The agent returns an `aiScore` (0–100), `status` (ai_likely / uncertain / human), `flags`, and `reasoning`
- Results are streamed as SSE `citation` events as each one finishes; completed citations are saved to `citation_cache` for resumption

**Pipeline 2 — Missing Citations** (`services/section_extractor.py` → `services/claim_detector.py` → `services/missing_citations.py`):
- Parses the raw GROBID XML into named sections
- Finds sentences with no `[N]` citation markers
- Searches Semantic Scholar for supporting papers; ranks by cosine similarity using `sentence-transformers/all-MiniLM-L6-v2`
- Uses GPT-4o-mini to build structured `MissingPaper` entries
- Emitted as a single `missing_complete` SSE event after both pipelines finish

### Caching Strategy

All results are stored in `cache.db` (SQLite) keyed by `{pdf_hash}_{type}`:
- `{hash}_ai` — AI detection result
- `{hash}_missing` — missing citations result
- `{hash}_network` — citation network
- `{hash}_reliability` — reliability scores
- `{hash}_bias` — bias metrics
- `{hash}` in `grobid_cache` — raw GROBID parse

On a cache hit, the backend replays results without any API calls. Per-citation results (`citation_cache`) are saved during analysis to support resuming interrupted runs.

### Frontend State Model

`App.tsx` manages all state. The `StreamingState` object drives the UI:
```ts
phase: "idle" | "grobid" | "analyzing" | "complete" | "missing" | "error"
```
The left panel is always the PDF viewer (`PDFViewer.tsx` via `react-pdf`). The right panel is `Sidebar.tsx` (480px fixed width) which renders one of 5 tabs: Citation Detail, Missing Citations, Reliability, Network, Bias.

### Key Type Contracts

`frontend/src/types.ts` defines all shared interfaces. The `AIResult` type (returned by `/analyze`) is the central citation shape used throughout the UI. Backend field names must match what the frontend expects — the mapping for `/reliability` happens in `App.tsx`'s `fetchReliability()`.
