import sqlite3
import hashlib
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "../cache.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    # Final completed analysis
    conn.execute("""
        CREATE TABLE IF NOT EXISTS analysis_cache (
            pdf_hash TEXT PRIMARY KEY,
            filename TEXT,
            result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Per-citation results saved as they finish (for resume)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS citation_cache (
            pdf_hash TEXT,
            citation_id TEXT,
            result TEXT,
            PRIMARY KEY (pdf_hash, citation_id)
        )
    """)
    # GROBID parse result (so we don't re-parse on resume)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS grobid_cache (
            pdf_hash TEXT PRIMARY KEY,
            filename TEXT,
            result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def get_pdf_hash(pdf_path: str) -> str:
    """Generate MD5 hash of PDF content."""
    hasher = hashlib.md5()
    with open(pdf_path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

# ── Full analysis cache ───────────────────────────────────────────────────────

def get_cached(pdf_hash: str) -> dict | None:
    """Return completed analysis result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (pdf_hash,)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (full) for {pdf_hash}")
        return json.loads(row[0])
    print(f"Cache MISS for {pdf_hash}")
    return None

def save_cache(pdf_hash: str, filename: str, result: dict):
    """Save completed analysis to cache and clean up partial data."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (pdf_hash, filename, json.dumps(result))
    )
    # Clean up partial citation cache — no longer needed
    conn.execute("DELETE FROM citation_cache WHERE pdf_hash = ?", (pdf_hash,))
    conn.execute("DELETE FROM grobid_cache WHERE pdf_hash = ?", (pdf_hash,))
    conn.commit()
    conn.close()
    print(f"Cached complete result for {pdf_hash}")

# ── GROBID parse cache ────────────────────────────────────────────────────────

def get_grobid_cached(pdf_hash: str) -> dict | None:
    """Return cached GROBID parse result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM grobid_cache WHERE pdf_hash = ?", (pdf_hash,)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (grobid) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_grobid_cache(pdf_hash: str, filename: str, result: dict):
    """Save GROBID parse result."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO grobid_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (pdf_hash, filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Per-citation partial cache ────────────────────────────────────────────────

def get_completed_citations(pdf_hash: str) -> dict:
    """Return dict of citation_id -> result for all already-analyzed citations."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT citation_id, result FROM citation_cache WHERE pdf_hash = ?", (pdf_hash,)
    ).fetchall()
    conn.close()
    completed = {row[0]: json.loads(row[1]) for row in rows}
    if completed:
        print(f"Resume: found {len(completed)} cached citations for {pdf_hash}")
    return completed

def save_citation(pdf_hash: str, citation_id: str, result: dict):
    """Save a single citation result as it finishes."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO citation_cache (pdf_hash, citation_id, result) VALUES (?, ?, ?)",
        (pdf_hash, citation_id, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Missing-citations cache ───────────────────────────────────────────────────

def get_cached_missing(pdf_hash: str) -> dict | None:
    """Return cached missing-citations result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_missing",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (missing) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_missing(pdf_hash: str, filename: str, result: dict):
    """Save missing-citations result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_missing", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached missing result for {pdf_hash}")

def get_cached_ai(pdf_hash: str) -> dict | None:
    """Return cached AI-detection result (metadata + citations + summary) or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_ai",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (ai) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_ai(pdf_hash: str, filename: str, result: dict):
    """Save AI-detection result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_ai", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached AI result for {pdf_hash}")

# ── Network cache ─────────────────────────────────────────────────────────────

def get_cached_network(pdf_hash: str) -> dict | None:
    """Return cached citation network result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_network",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (network) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_network(pdf_hash: str, filename: str, result: dict):
    """Save citation network result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_network", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached network result for {pdf_hash}")

# ── Reliability cache ─────────────────────────────────────────────────────────

def get_cached_reliability(pdf_hash: str) -> dict | None:
    """Return cached reliability result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_reliability",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (reliability) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_reliability(pdf_hash: str, filename: str, result: dict):
    """Save reliability result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_reliability", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached reliability result for {pdf_hash}")

# ── Bias cache ────────────────────────────────────────────────────────────────

def get_cached_bias(pdf_hash: str) -> dict | None:
    """Return cached bias analysis result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_bias",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (bias) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_bias(pdf_hash: str, filename: str, result: dict):
    """Save bias analysis result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_bias", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached bias result for {pdf_hash}")

# ── Format-check cache ────────────────────────────────────────────────────────

def get_cached_format_check(pdf_hash: str) -> dict | None:
    """Return cached format-check result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_format",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (format) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_format_check(pdf_hash: str, filename: str, result: dict):
    """Save format-check result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_format", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached format result for {pdf_hash}")

# ── Integrity cache ───────────────────────────────────────────────────────────

def get_cached_integrity(pdf_hash: str) -> dict | None:
    """Return cached integrity audit result or None."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_integrity",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (integrity) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_integrity(pdf_hash: str, filename: str, result: dict):
    """Save integrity audit result to cache."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_integrity", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()
    print(f"Cached integrity result for {pdf_hash}")

# ── Alignment cache ───────────────────────────────────────────────────────────

def get_cached_alignment(pdf_hash: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_alignment",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (alignment) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_alignment(pdf_hash: str, filename: str, result: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_alignment", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Reproducibility cache ─────────────────────────────────────────────────────

def get_cached_reproducibility(pdf_hash: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_repro",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (reproducibility) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_reproducibility(pdf_hash: str, filename: str, result: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_repro", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Limitations cache ─────────────────────────────────────────────────────────

def get_cached_limitations(pdf_hash: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_limitations",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (limitations) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_limitations(pdf_hash: str, filename: str, result: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_limitations", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Stats cache ───────────────────────────────────────────────────────────────

def get_cached_stats(pdf_hash: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_stats",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (stats) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_stats(pdf_hash: str, filename: str, result: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_stats", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# ── Review template cache ─────────────────────────────────────────────────────

def get_cached_review(pdf_hash: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT result FROM analysis_cache WHERE pdf_hash = ?", (f"{pdf_hash}_review",)
    ).fetchone()
    conn.close()
    if row:
        print(f"Cache HIT (review) for {pdf_hash}")
        return json.loads(row[0])
    return None

def save_cached_review(pdf_hash: str, filename: str, result: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (pdf_hash, filename, result) VALUES (?, ?, ?)",
        (f"{pdf_hash}_review", filename, json.dumps(result))
    )
    conn.commit()
    conn.close()

# Initialize DB on import
init_db()
