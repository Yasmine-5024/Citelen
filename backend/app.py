from flask import Flask, request, jsonify, Response, send_file
from flask_cors import CORS
import tempfile
import os
import json
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from services.user_db import (
	init_db as _init_user_db,
	register_user, login_user, get_user, make_token, verify_token,
	save_review_history, get_review_history,
	save_draft, get_draft,
	save_chat, get_chat,
)
from services.cache import (
	get_pdf_hash,
	get_cached_ai, save_cached_ai,
	get_cached_missing, save_cached_missing,
	get_cached_network, save_cached_network,
	get_cached_bias, save_cached_bias,
	get_cached_reliability, save_cached_reliability,
	get_grobid_cached, save_grobid_cache,
	get_completed_citations, save_citation,
	get_cached_format_check, save_cached_format_check,
	get_cached_integrity, save_cached_integrity,
	get_cached_alignment, save_cached_alignment,
	get_cached_reproducibility, save_cached_reproducibility,
	get_cached_limitations, save_cached_limitations,
	get_cached_stats, save_cached_stats,
	get_cached_review, save_cached_review,
)

load_dotenv()

app = Flask(__name__)
CORS(app)

PDF_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "stored_pdfs")
os.makedirs(PDF_STORAGE_DIR, exist_ok=True)

EMPTY_MISSING = {"claims": [], "missing_papers": [], "total_claims": 0, "total_missing": 0}


@app.route("/health")
def health():
	return jsonify({"status": "ok"})


@app.route("/analyze", methods=["POST"])
def analyze():
	"""Stream citation analysis. AI detection and missing citations run in parallel."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	# Capture user_id before entering generator (request context won't be available inside)
	_analyze_user_id: int | None = None
	_auth = request.headers.get("Authorization", "")
	if _auth.startswith("Bearer "):
		try:
			_analyze_user_id = verify_token(_auth[7:])
		except Exception:
			pass

	def generate():
		try:
			pdf_hash = get_pdf_hash(tmp_path)
			filename = file.filename

			# ── Persist PDF so it can be re-served later ──────────────────────
			stored_path = os.path.join(PDF_STORAGE_DIR, f"{pdf_hash}.pdf")
			if not os.path.exists(stored_path):
				shutil.copy(tmp_path, stored_path)

			# ── Full cache hit: both pipelines already done ───────────────────
			cached_ai = get_cached_ai(pdf_hash)
			cached_missing = get_cached_missing(pdf_hash)
			if cached_ai and cached_missing:
				if _analyze_user_id:
					_m = cached_ai.get("metadata", {})
					save_review_history(_analyze_user_id, pdf_hash, _m.get("title", ""), _m.get("authors", []))
				yield f"data: {json.dumps({'type': 'metadata', 'data': cached_ai['metadata'], 'total': cached_ai['total'], 'hash': pdf_hash})}\n\n"
				for citation in cached_ai["citations"]:
					yield f"data: {json.dumps({'type': 'citation', 'data': citation})}\n\n"
				yield f"data: {json.dumps({'type': 'complete', 'summary': cached_ai['summary'], 'signals': cached_ai['signals']})}\n\n"
				yield f"data: {json.dumps({'type': 'missing_start'})}\n\n"
				yield f"data: {json.dumps({'type': 'missing_complete', 'data': cached_missing})}\n\n"
				return

			# ── GROBID: use cache if available, otherwise parse ───────────────
			parsed = get_grobid_cached(pdf_hash)
			if parsed is None:
				from services.grobid import extract_with_grobid
				parsed = extract_with_grobid(tmp_path)
				save_grobid_cache(pdf_hash, filename, parsed)

				# DEBUG: print in_text_map claim sentences
				print("\n" + "="*60)

				print("[DEBUG] CLAIM SENTENCES FROM in_text_map")
				print("="*60)
				in_text_map = parsed.get("in_text_map", {})
				references  = parsed.get("citations", [])
				ref_titles = {r.get("id"): r.get("title", "Unknown") for r in references}
				if not in_text_map:
					print("[DEBUG] in_text_map is EMPTY")
				else:
					for ref_id, contexts in list(in_text_map.items())[:10]:
						title = ref_titles.get(ref_id, "Unknown")
						print(f"  Ref [{ref_id}] {title[:60]}")
						for i, ctx in enumerate(contexts[:2]):
							print(f"    Claim {i+1}: {repr(ctx[:120])}")
				print(f"[DEBUG] Total refs with contexts: {sum(1 for v in in_text_map.values() if v)}/{len(in_text_map)}")
				print("="*60 + "\n")


			if _analyze_user_id:
				save_review_history(_analyze_user_id, pdf_hash, parsed["metadata"].get("title", ""), parsed["metadata"].get("authors", []))
			yield f"data: {json.dumps({'type': 'metadata', 'data': parsed['metadata'], 'total': parsed['total'], 'hash': pdf_hash})}\n\n"

			# ── Shared state between the two pipelines ────────────────────────
			ai_results: list[dict] = []
			summary: dict = {}
			signals: list[dict] = []
			missing_data: dict = EMPTY_MISSING.copy()
			ai_error: list[str] = []
			missing_error: list[str] = []

			# SSE queue: items are serialised event strings ready to yield
			sse_queue: list[str] = []
			queue_lock = threading.Lock()
			ai_done = threading.Event()
			missing_done = threading.Event()

			def push(event_str: str):
				with queue_lock:
					sse_queue.append(event_str)

			# ── Pipeline 1: AI detection ──────────────────────────────────────
			def run_ai_detection():
				try:
					# Check AI-specific cache FIRST
					if cached_ai:
						# AI already done — just stream from cache
						for citation in cached_ai["citations"]:
							ai_results.append(citation)
							push(f"data: {json.dumps({'type': 'citation', 'data': citation})}\n\n")
						summary.update(cached_ai["summary"])
						signals.extend(cached_ai["signals"])
						push(f"data: {json.dumps({'type': 'complete', 'summary': cached_ai['summary'], 'signals': cached_ai['signals']})}\n\n")
						print(f"AI detection: served from cache for {pdf_hash}")
						return

					from services.citation_agent import analyze_citation_with_agent

					completed = get_completed_citations(pdf_hash)

					# Stream already-completed citations first
					for citation in parsed["citations"]:
						if citation["id"] in completed:
							result = completed[citation["id"]]
							key2 = f"b{citation['num']}"
							result["contexts"] = parsed["in_text_map"].get(key2, [])
							ai_results.append(result)
							push(f"data: {json.dumps({'type': 'citation', 'data': result})}\n\n")

					# Analyze remaining
					for citation in parsed["citations"]:
						if citation["id"] in completed:
							continue
						key = f"b{citation['num']}"
						contexts = parsed["in_text_map"].get(key, [])
						print(f"[CONTEXT] {citation['id']} - {len(contexts)} sentence(s):")
						for _i, _ctx in enumerate(contexts):
							print(f"  [{_i+1}] {_ctx}")
						if not contexts:
							print("  (none)")
						result = analyze_citation_with_agent(citation, contexts)
						result["citation_count"] = len(contexts)
						result["duplicate_of"] = citation.get("duplicate_of")
						result["contexts"] = contexts
						ai_results.append(result)
						if result.get("agent_analyzed"):
							save_citation(pdf_hash, citation["id"], result)
						push(f"data: {json.dumps({'type': 'citation', 'data': result})}\n\n")

					# Build summary + signals
					total = len(ai_results)
					ai_likely = sum(1 for r in ai_results if r["status"] == "ai_likely")
					uncertain = sum(1 for r in ai_results if r["status"] == "uncertain")
					human = sum(1 for r in ai_results if r["status"] == "human")
					summary.update({
						"ai_likely": ai_likely,
						"uncertain": uncertain,
						"human": human,
						"ai_rate": round(ai_likely / total * 100) if total else 0,
					})

					signal_counts: dict = {}
					for r in ai_results:
						for flag in r.get("flags", []):
							signal_counts[flag] = signal_counts.get(flag, 0) + 1
					signals.extend([
						{"signal": k, "count": v}
						for k, v in sorted(signal_counts.items(), key=lambda x: -x[1])
					])

					push(f"data: {json.dumps({'type': 'complete', 'summary': summary, 'signals': signals})}\n\n")

					save_cached_ai(pdf_hash, filename, {
						"metadata": parsed["metadata"],
						"total": parsed["total"],
						"citations": ai_results,
						"summary": summary,
						"signals": signals,
					})
				except Exception as e:
					ai_error.append(str(e))
					import traceback; traceback.print_exc()
				finally:
					ai_done.set()

			# ── Pipeline 2: Missing citations ─────────────────────────────────
			def run_missing_citations():
				nonlocal missing_data
				try:
					# Check missing-specific cache FIRST
					if cached_missing:
						missing_data = cached_missing
						print(f"Missing citations: served from cache for {pdf_hash}")
						return

					from services.section_extractor import extract_sections
					from services.claim_detector import detect_uncited_claims
					from services.missing_citations import find_missing_citations

					raw_xml = parsed.get("raw_xml", "")
					sections = extract_sections(raw_xml) if raw_xml else {}
					print(f"[DEBUG] Sections found: {list(sections.keys())}")
					print(f"[DEBUG] Total sentences: {sum(len(v) for v in sections.values())}")

					uncited_claims = detect_uncited_claims(sections)
					print(f"[DEBUG] Uncited claims found: {len(uncited_claims)}")
					for c in uncited_claims[:3]:
						print(f"  -> {c['section']}: {c['sentence'][:80]}...")

					existing_titles = {c.get("title", "") for c in parsed["citations"] if c.get("title")}

					current_paper_title = parsed.get("metadata", {}).get("title", "")
					missing_data = find_missing_citations(uncited_claims, existing_titles, parsed["citations"], current_paper_title=current_paper_title)
					save_cached_missing(pdf_hash, filename, missing_data)
				except Exception as e:
					missing_error.append(str(e))
					import traceback; traceback.print_exc()
				finally:
					missing_done.set()

			# ── Run both pipelines concurrently ───────────────────────────────
			push(f"data: {json.dumps({'type': 'missing_start'})}\n\n")

			with ThreadPoolExecutor(max_workers=2) as executor:
				f_ai = executor.submit(run_ai_detection)
				f_missing = executor.submit(run_missing_citations)

				# Drain the queue while threads are running
				while not (ai_done.is_set() and missing_done.is_set()):
					with queue_lock:
						batch = sse_queue[:]
						sse_queue.clear()
					for event in batch:
						yield event
					threading.Event().wait(0.05)

				# Ensure futures raised no unhandled exceptions
				f_ai.result()
				f_missing.result()

			# Final drain after both threads finish
			with queue_lock:
				batch = sse_queue[:]
				sse_queue.clear()
			for event in batch:
				yield event

			# Emit missing_complete
			yield f"data: {json.dumps({'type': 'missing_complete', 'data': missing_data})}\n\n"

		except Exception as e:
			yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
		finally:
			os.unlink(tmp_path)

	return Response(generate(), mimetype="text/event-stream")


@app.route("/reliability", methods=["POST"])
def reliability():
	"""Score all references for reliability + relevance. Reuses GROBID cache."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_reliability(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.reliability import score_all_references
		scored = score_all_references(parsed)
		results = scored["results"]
		be_summary = scored["summary"]

		rels = [r["reliability"] for r in results]
		revs = [r["relevance"] for r in results if r["relevance"] is not None]

		data = {
			"citations": results,
			"summary": {
				"avg_reliability": round(sum(rels) / len(rels)) if rels else 0,
				"avg_relevance":   round(sum(revs) / len(revs)) if revs else 0,
				"flagged":         be_summary["retracted"] + be_summary["predatory_venue"],
				"self_citations":  be_summary["self_citations"],
				"total":           be_summary["total"],
				"no_abstract":     be_summary.get("no_abstract", 0),
			},
		}
		save_cached_reliability(pdf_hash, file.filename, data)
		return jsonify({"success": True, "data": data})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/network", methods=["POST"])
def network():
	"""Build citation network clusters. Reuses GROBID cache."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		cached = get_cached_network(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		from services.citation_network import build_citation_network
		result = build_citation_network(parsed)
		save_cached_network(pdf_hash, file.filename, result)

		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/bias", methods=["POST"])
def bias():
	"""Compute citation bias metrics. Reuses GROBID cache. No AI calls."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_bias(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.citation_bias import build_citation_bias
		result = build_citation_bias(parsed)
		save_cached_bias(pdf_hash, file.filename, result)

		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/format-check", methods=["POST"])
def format_check():
	"""Check reference formatting consistency. No AI calls."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_format_check(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.format_checker import check_format_consistency
		result = check_format_consistency(parsed)
		save_cached_format_check(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/integrity", methods=["POST"])
def integrity():
	"""Run Related Work Fairness Auditor + Overclaim Detector."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_integrity(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.integrity import run_integrity_audit
		result = run_integrity_audit(parsed)
		save_cached_integrity(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/alignment", methods=["POST"])
def alignment():
	"""Abstract ↔ Conclusion alignment check."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_alignment(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.alignment import run_alignment
		result = run_alignment(parsed)
		save_cached_alignment(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/reproducibility", methods=["POST"])
def reproducibility():
	"""Reproducibility checklist check."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400

	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)

		cached = get_cached_reproducibility(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.reproducibility import run_reproducibility
		result = run_reproducibility(parsed)
		save_cached_reproducibility(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/limitations", methods=["POST"])
def limitations():
	"""Detect and analyze the limitations section; cross-reference implicit weaknesses."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400
	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)
		cached = get_cached_limitations(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.limitations import analyze_limitations
		result = analyze_limitations(parsed)
		save_cached_limitations(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/stats-check", methods=["POST"])
def stats_check():
	"""Validate statistical reporting completeness."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400
	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)
		cached = get_cached_stats(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		from services.stats_validator import validate_statistics
		result = validate_statistics(parsed)
		save_cached_stats(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


@app.route("/review-template", methods=["POST"])
def review_template():
	"""Generate a pre-filled peer review template, enriched with cached analysis data."""
	if "file" not in request.files:
		return jsonify({"error": "No PDF uploaded"}), 400
	file = request.files["file"]
	if not file.filename.endswith(".pdf"):
		return jsonify({"error": "File must be a PDF"}), 400

	with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
		file.save(tmp.name)
		tmp_path = tmp.name

	try:
		pdf_hash = get_pdf_hash(tmp_path)
		cached = get_cached_review(pdf_hash)
		if cached:
			return jsonify({"success": True, "data": cached})

		parsed = get_grobid_cached(pdf_hash)
		if parsed is None:
			from services.grobid import extract_with_grobid
			parsed = extract_with_grobid(tmp_path)
			save_grobid_cache(pdf_hash, file.filename, parsed)

		# Enrich with whatever cached analyses are available
		enrichment = {}
		lim = get_cached_limitations(pdf_hash)
		if lim:
			enrichment["limitations"] = lim
		stats = get_cached_stats(pdf_hash)
		if stats:
			enrichment["stats"] = stats
		integrity = get_cached_integrity(pdf_hash)
		if integrity:
			enrichment["integrity"] = integrity

		from services.review_template import generate_review_template
		result = generate_review_template(parsed, enrichment)
		save_cached_review(pdf_hash, file.filename, result)
		return jsonify({"success": True, "data": result})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500
	finally:
		os.unlink(tmp_path)


# ══════════════════════════════════════════════════════════════════════════════
# Auth, Chat, History, Draft endpoints
# ══════════════════════════════════════════════════════════════════════════════

_init_user_db()


def _get_user_id() -> int | None:
	"""Extract and verify user_id from Authorization: Bearer <token> header."""
	auth = request.headers.get("Authorization", "")
	if not auth.startswith("Bearer "):
		return None
	try:
		return verify_token(auth[7:])
	except Exception:
		return None


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.route("/auth/register", methods=["POST"])
def auth_register():
	data = request.json or {}
	email = data.get("email", "").strip()
	name = data.get("name", "").strip()
	password = data.get("password", "")
	institution = data.get("institution", "").strip()

	if not email or not name or not password:
		return jsonify({"error": "email, name and password are required"}), 400
	if len(password) < 8:
		return jsonify({"error": "Password must be at least 8 characters"}), 400

	try:
		user = register_user(email, name, password, institution)
		token = make_token(user["id"])
		return jsonify({"user": user, "token": token})
	except ValueError as e:
		return jsonify({"error": str(e)}), 409


@app.route("/auth/login", methods=["POST"])
def auth_login():
	data = request.json or {}
	email = data.get("email", "").strip()
	password = data.get("password", "")

	if not email or not password:
		return jsonify({"error": "email and password are required"}), 400

	try:
		user = login_user(email, password)
		token = make_token(user["id"])
		return jsonify({"user": user, "token": token})
	except ValueError as e:
		return jsonify({"error": str(e)}), 401


@app.route("/auth/me", methods=["GET"])
def auth_me():
	user_id = _get_user_id()
	if not user_id:
		return jsonify({"error": "Unauthorized"}), 401
	user = get_user(user_id)
	if not user:
		return jsonify({"error": "User not found"}), 404
	return jsonify({"user": user})


# ── Serve stored PDF ─────────────────────────────────────────────────────────

@app.route("/pdf/<pdf_hash>", methods=["GET"])
def serve_pdf(pdf_hash: str):
	pdf_path = os.path.join(PDF_STORAGE_DIR, f"{pdf_hash}.pdf")
	if not os.path.exists(pdf_path):
		return jsonify({"error": "PDF not found"}), 404
	return send_file(pdf_path, mimetype="application/pdf")


# ── History ───────────────────────────────────────────────────────────────────

@app.route("/history", methods=["GET"])
def history():
	user_id = _get_user_id()
	if not user_id:
		return jsonify({"error": "Unauthorized"}), 401
	reviews = get_review_history(user_id)
	return jsonify({"reviews": reviews})


# ── Draft ─────────────────────────────────────────────────────────────────────

@app.route("/draft/<pdf_hash>", methods=["GET"])
def get_draft_route(pdf_hash: str):
	user_id = _get_user_id()
	if not user_id:
		return jsonify({"error": "Unauthorized"}), 401
	draft = get_draft(user_id, pdf_hash)
	if not draft:
		return jsonify({"content": "", "updated_at": None})
	return jsonify(draft)


@app.route("/draft/<pdf_hash>", methods=["POST"])
def save_draft_route(pdf_hash: str):
	user_id = _get_user_id()
	if not user_id:
		return jsonify({"error": "Unauthorized"}), 401
	data = request.json or {}
	content = data.get("content", "")
	save_draft(user_id, pdf_hash, content)
	return jsonify({"ok": True})


# ── Chat ──────────────────────────────────────────────────────────────────────

def _build_paper_context(pdf_hash: str) -> str:
	"""Build a rich context string about a paper from all cached analyses."""
	lines = []

	grobid = get_grobid_cached(pdf_hash)
	if grobid:
		meta = grobid.get("metadata", {})
		title = meta.get("title", "Unknown")
		authors = ", ".join(meta.get("authors", []))
		lines.append(f"PAPER TITLE: {title}")
		if authors:
			lines.append(f"AUTHORS: {authors}")
		citations = grobid.get("citations", [])
		lines.append(f"TOTAL REFERENCES: {len(citations)}")

	cached_ai = get_cached_ai(pdf_hash)
	if cached_ai:
		cits = cached_ai.get("citations", [])
		ai_likely = [c for c in cits if c.get("status") == "ai_likely"]
		uncertain = [c for c in cits if c.get("status") == "uncertain"]
		summary = cached_ai.get("summary", {})
		lines.append(f"\nAI DETECTION RESULTS:")
		lines.append(f"  - {len(ai_likely)} citation(s) flagged as likely AI-generated")
		lines.append(f"  - {len(uncertain)} citation(s) uncertain")
		lines.append(f"  - Overall AI rate: {summary.get('ai_rate', 0)}%")
		if ai_likely:
			lines.append("  FLAGGED CITATIONS:")
			for c in ai_likely[:10]:
				flags = ", ".join(c.get("flags", []))
				lines.append(f"    [{c.get('id', '?')}] \"{c.get('title', 'Unknown')}\" — {flags or 'no specific flags'}")

	cached_missing = get_cached_missing(pdf_hash)
	if cached_missing:
		missing = cached_missing.get("missing_papers", [])
		if missing:
			lines.append(f"\nMISSING CITATIONS ({len(missing)} found):")
			for p in missing[:8]:
				lines.append(f"  - \"{p.get('title', 'Unknown')}\" ({p.get('year', '?')}) — {p.get('severity', '?')} severity, {p.get('section', '')}")

	cached_rel = get_cached_reliability(pdf_hash)
	if cached_rel:
		s = cached_rel.get("summary", {})
		lines.append(f"\nRELIABILITY SUMMARY:")
		lines.append(f"  - Avg reliability: {s.get('avg_reliability', 0)}%")
		lines.append(f"  - Flagged: {s.get('flagged', 0)} | Self-citations: {s.get('self_citations', 0)}")

	return "\n".join(lines) if lines else "No analysis data is cached for this paper yet."


@app.route("/chat/<pdf_hash>", methods=["GET"])
def load_chat(pdf_hash: str):
	user_id = _get_user_id()
	if not user_id:
		return jsonify({"messages": []})
	messages = get_chat(user_id, pdf_hash)
	return jsonify({"messages": messages})


@app.route("/chat", methods=["POST"])
def chat_endpoint():
	data = request.json or {}
	pdf_hash = data.get("pdf_hash")
	messages = data.get("messages", [])

	if not pdf_hash:
		return jsonify({"error": "pdf_hash required"}), 400

	context = _build_paper_context(pdf_hash)

	system_prompt = f"""You are an expert AI research assistant helping a peer reviewer analyze an academic paper.

Here is what we know about the paper:
{context}

Your role:
- Answer questions about specific citations and why they were flagged
- Explain the analysis results clearly
- Help the reviewer identify weaknesses and strengths
- Assist in drafting review sections
- Be precise, evidence-based, and concise

When discussing flagged citations, refer to them by their ID and title."""

	try:
		from openai import OpenAI
		client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

		openai_messages = [{"role": "system", "content": system_prompt}] + [
			{"role": m["role"], "content": m["content"]} for m in messages
		]

		response = client.chat.completions.create(
			model="gpt-4o-mini",
			messages=openai_messages,
			temperature=0.7,
			max_tokens=800,
		)
		reply = response.choices[0].message.content

		# Save to user's chat history if authenticated
		user_id = _get_user_id()
		if user_id:
			all_msgs = messages + [{"role": "assistant", "content": reply}]
			save_chat(user_id, pdf_hash, all_msgs)

		return jsonify({"reply": reply})
	except Exception as e:
		import traceback; traceback.print_exc()
		return jsonify({"error": str(e)}), 500


@app.route("/review-cache/<pdf_hash>", methods=["GET"])
def review_cache(pdf_hash: str):
	"""Return all cached analysis for a paper by its hash (no file re-upload needed)."""
	result = {}

	grobid = get_grobid_cached(pdf_hash)
	if grobid:
		result["grobid"] = {
			"metadata": grobid.get("metadata", {}),
			"total_citations": len(grobid.get("citations", [])),
		}

	ai = get_cached_ai(pdf_hash)
	if ai:
		result["ai"] = ai

	missing = get_cached_missing(pdf_hash)
	if missing:
		result["missing"] = missing

	reliability = get_cached_reliability(pdf_hash)
	if reliability:
		result["reliability"] = reliability

	network = get_cached_network(pdf_hash)
	if network:
		result["network"] = network

	bias = get_cached_bias(pdf_hash)
	if bias:
		result["bias"] = bias

	format_check = get_cached_format_check(pdf_hash)
	if format_check:
		result["format_check"] = format_check

	integrity = get_cached_integrity(pdf_hash)
	if integrity:
		result["integrity"] = integrity

	limitations = get_cached_limitations(pdf_hash)
	if limitations:
		result["limitations"] = limitations

	stats = get_cached_stats(pdf_hash)
	if stats:
		result["stats"] = stats

	if not result:
		return jsonify({"error": "No cached data found"}), 404

	return jsonify(result)


if __name__ == "__main__":
	app.run(debug=True, port=5000, threaded=True)