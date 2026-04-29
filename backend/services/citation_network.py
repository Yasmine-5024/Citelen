"""
Citation Network Service
========================
Groups citations into dynamic thematic clusters using GPT-4o.

Algorithm:
1. Build a text representation of each citation: title + in-text usage sentences
2. Send all citations to GPT-4o in one call → get clusters + orphans
3. Compute co-citation links: how many times two papers appear in the same sentence
4. Compute cohesion score: avg within-cluster link density

Returns CitationNetworkData matching the frontend schema.
"""

import os
import json
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

_CLUSTER_SYSTEM = """You are an expert academic research analyst.

Given a list of citations from a research paper (each with an ID, title, and the sentences where they are cited), your task is to:

1. Identify 3-5 meaningful thematic clusters that reflect the research landscape of the paper.
   - Cluster names should be short (2-4 words), descriptive, and specific to the paper's domain.
   - Every citation must belong to exactly one cluster OR be marked as an orphan.
   - Orphans are citations that don't thematically fit any cluster (isolated, tangential, or unrelated to the main themes).

2. Return ONLY valid JSON in this exact format:
{
  "clusters": [
    {
      "name": "cluster name",
      "color": "one of: blue|purple|green|orange|cyan",
      "ids": ["[1]", "[5]", "[12]"]
    }
  ],
  "orphans": ["[7]", "[29]"]
}

Rules:
- Use the actual citation IDs like [1], [2], [3] etc.
- Choose colors to visually distinguish clusters (no two adjacent clusters same color)
- Orphans list can be empty if all citations fit a cluster
- Do NOT create a cluster with only 1 paper — make it an orphan instead
- Cluster names must reflect the actual academic topics, not generic labels like "Other" or "Misc"
"""


def _build_citation_text(citations: list[dict], in_text_map: dict) -> str:
    """Build a compact text representation of all citations for GPT."""
    lines = []
    for cit in citations:
        cid = cit["id"]
        title = cit.get("title") or "Unknown"
        key = f"b{cit.get('num', '')}"
        contexts = in_text_map.get(key, [])
        # Use up to 2 context sentences
        ctx_str = " | ".join(c[:150] for c in contexts[:2]) if contexts else "(no in-text context)"
        lines.append(f'{cid} | "{title}" | Used as: {ctx_str}')
    return "\n".join(lines)


def _compute_co_citations(in_text_map: dict, citations: list[dict]) -> dict[str, int]:
    """
    Count how many other citations each citation co-appears with in the same sentence.
    Returns {citation_id: link_count}
    """
    # Build sentence → set of citation ids mapping
    sentence_to_ids: dict[str, set] = {}
    id_by_key: dict[str, str] = {f"b{c['num']}": c["id"] for c in citations}

    for key, sentences in in_text_map.items():
        cid = id_by_key.get(key)
        if not cid:
            continue
        for sentence in sentences:
            if sentence not in sentence_to_ids:
                sentence_to_ids[sentence] = set()
            sentence_to_ids[sentence].add(cid)

    # Count co-citation links per citation
    link_counts: dict[str, int] = {c["id"]: 0 for c in citations}
    for ids_in_sentence in sentence_to_ids.values():
        if len(ids_in_sentence) > 1:
            for cid in ids_in_sentence:
                if cid in link_counts:
                    link_counts[cid] += len(ids_in_sentence) - 1

    return link_counts


def _compute_cohesion(clusters: list[dict], link_counts: dict[str, int], total_citations: int) -> float:
    """
    Simple cohesion score 0-1:
    ratio of citations with at least 1 co-citation link to total citations.
    """
    if total_citations == 0:
        return 0.0
    connected = sum(1 for v in link_counts.values() if v > 0)
    return round(connected / total_citations, 2)


def build_citation_network(parsed: dict) -> dict:
    """
    Main entry point. Takes GROBID parsed output, returns CitationNetworkData.
    """
    citations = parsed.get("citations", [])
    in_text_map = parsed.get("in_text_map", {})

    if not citations:
        return {
            "clusters": [],
            "orphans": [],
            "total_clusters": 0,
            "total_orphans": 0,
            "cohesion_score": 0.0,
            "avg_connections": 0.0,
        }

    # Step 1: compute co-citation links
    link_counts = _compute_co_citations(in_text_map, citations)

    # Step 2: build citation text for GPT
    citation_text = _build_citation_text(citations, in_text_map)

    # Step 3: call GPT-4o to cluster
    prompt = f"Here are {len(citations)} citations from a research paper:\n\n{citation_text}\n\nGroup them into thematic clusters."

    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _CLUSTER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            timeout=60,
        )
        gpt_result = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        print(f"[network] GPT clustering error: {e}")
        gpt_result = {"clusters": [], "orphans": [c["id"] for c in citations]}

    raw_clusters = gpt_result.get("clusters", [])
    orphan_ids = set(gpt_result.get("orphans", []))

    # Step 4: enrich clusters with citation metadata + link counts
    id_to_citation = {c["id"]: c for c in citations}

    enriched_clusters = []
    for cluster in raw_clusters:
        members = []
        for cid in cluster.get("ids", []):
            cit = id_to_citation.get(cid)
            if not cit:
                continue
            members.append({
                "id": cid,
                "title": cit.get("title") or "Unknown",
                "year": cit.get("year"),
                "venue": cit.get("venue") or "",
                "links": link_counts.get(cid, 0),
            })
        # Sort by links descending
        members.sort(key=lambda x: x["links"], reverse=True)
        if members:
            enriched_clusters.append({
                "name": cluster.get("name", "Unnamed"),
                "color": cluster.get("color", "blue"),
                "papers": members,
            })

    # Enrich orphans
    orphan_list = []
    for cid in orphan_ids:
        cit = id_to_citation.get(cid)
        if cit:
            orphan_list.append({
                "id": cid,
                "title": cit.get("title") or "Unknown",
                "year": cit.get("year"),
                "venue": cit.get("venue") or "",
            })

    # Step 5: summary stats
    total_citations = len(citations)
    avg_connections = (
        round(sum(link_counts.values()) / total_citations, 1)
        if total_citations else 0.0
    )
    cohesion = _compute_cohesion(enriched_clusters, link_counts, total_citations)

    print(f"[network] {len(enriched_clusters)} clusters, {len(orphan_list)} orphans, cohesion={cohesion}, avg_links={avg_connections}")

    return {
        "clusters": enriched_clusters,
        "orphans": orphan_list,
        "total_clusters": len(enriched_clusters),
        "total_orphans": len(orphan_list),
        "cohesion_score": cohesion,
        "avg_connections": avg_connections,
    }
