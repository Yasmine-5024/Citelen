"""
Detect uncited claims in paper sections.

GPT-4o-mini classifies all uncited sentences directly in batches of 25.
No rule-based pre-filter — GPT decides what needs a citation.

Returns a list of UncitedClaim dicts.
"""

import re
import json
import os
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ── GPT-4 batch classification ────────────────────────────────────────────────

_SYSTEM = """You are a citation-gap detector for academic papers.
Given a list of sentences that may contain uncited factual claims,
return a JSON object with key "items" containing an array. For each sentence output:
{
  "index": <int>,
  "is_claim": <bool>,
  "claim_type": <"quantitative"|"comparative"|"general"|"methodological"|"none">,
  "suggested_query": <string to search for supporting papers, or null>
}
Only set is_claim=true if the sentence makes a concrete claim that SHOULD have a citation but doesn't."""


def _gpt_classify_batch(candidates: list[tuple[int, str]]) -> list[dict]:
    """Send a batch of (index, sentence) pairs to GPT-4o-mini for claim classification."""
    if not candidates:
        return []

    numbered = "\n".join(f"{i}. {text}" for i, text in candidates)
    prompt = f"Classify these sentences for missing citations:\n\n{numbered}"

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            timeout=30,
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        items = data.get("items") or data.get("results") or []
        if isinstance(data, list):
            items = data
        return items if isinstance(items, list) else []
    except Exception as e:
        print(f"GPT claim batch error: {e}")
        return []


# ── Public API ────────────────────────────────────────────────────────────────

def detect_uncited_claims(sections: dict[str, list[dict]]) -> list[dict]:
    """
    Scan all sections for uncited claims.

    Returns list of:
    {
        "section": str,
        "sentence": str,
        "claim_type": str,
        "suggested_query": str | None,
    }
    """
    # Collect all uncited sentences (no rule filter)
    candidates: list[tuple[str, str]] = []  # (section_name, sentence_text)
    for section_name, sentences in sections.items():
        if re.match(r'(references?|acknowledgements?|appendix)', section_name, re.I):
            continue
        for sent_obj in sentences:
            if not sent_obj["has_citation"] and sent_obj["word_count"] >= 8:
                candidates.append((section_name, sent_obj["text"]))

    print(f"[CLAIMS] Total uncited sentences to classify: {len(candidates)}")

    if not candidates:
        return []

    # Batch all candidates through GPT in chunks of 25
    BATCH_SIZE = 25
    all_results: list[dict] = []

    for batch_start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[batch_start: batch_start + BATCH_SIZE]
        indexed = [(i, text) for i, (_, text) in enumerate(batch)]
        gpt_results = _gpt_classify_batch(indexed)
        gpt_map = {item["index"]: item for item in gpt_results if isinstance(item, dict)}

        for i, (section_name, sentence) in enumerate(batch):
            gpt = gpt_map.get(i, {})
            is_claim = gpt.get("is_claim", False)
            claim_type = gpt.get("claim_type", "none")
            if is_claim and claim_type != "none":
                all_results.append({
                    "section": section_name,
                    "sentence": sentence,
                    "claim_type": claim_type,
                    "suggested_query": gpt.get("suggested_query") or sentence[:120],
                })

    print(f"[CLAIMS] GPT identified {len(all_results)} claims needing citations")
    return all_results
