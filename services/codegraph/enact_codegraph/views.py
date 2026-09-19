"""Read models for the Enact UI: communities, god nodes, GraphView projections,
tree, call-flow Mermaid and wiki. Every graph computation is graphify's; this
module shapes the output to the wire contract and applies limits."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

from .config import graphify_version
from .errors import ApiError, not_built
from .graphs import (
    GraphStore, code_edge, code_node, cohesion_for, community_of, degree, edge_data,
    labels_for, read_json,
)
from .projects import ProjectPaths

DEFAULT_LIMIT = 500
MAX_LIMIT = 2000
COMMUNITY_LEVEL_DEFAULT_LIMIT = 100
EDGE_FACTOR = 3
TOP_NODES_PER_COMMUNITY = 8
DEFAULT_TREE_MAX_CHILDREN = 200
CALLFLOW_MAX_SECTIONS = 15
CALLFLOW_MAX_DIAGRAM_NODES = 18
CALLFLOW_MAX_DIAGRAM_EDGES = 24
CALLFLOW_DIAGRAM_SCALE = 1.0

_SLUG_RE = re.compile(r"^[^/\\\x00]{1,200}$")


def parse_limit(raw: str | None, default: int = DEFAULT_LIMIT) -> int:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ApiError(400, "invalid_request", "limit must be an integer") from exc
    if value <= 0:
        raise ApiError(400, "invalid_request", "limit must be positive")
    return min(value, MAX_LIMIT)


def parse_int(raw: str | None, default: int, name: str, minimum: int = 1) -> int:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ApiError(400, "invalid_request", f"{name} must be an integer") from exc
    if value < minimum:
        raise ApiError(400, "invalid_request", f"{name} must be >= {minimum}")
    return value


# ---------------------------------------------------------------------------
# status / stats
# ---------------------------------------------------------------------------

def status(paths: ProjectPaths) -> dict:
    if not paths.is_built():
        return {"built": False}
    build = read_json(paths.build_json) if paths.build_json.is_file() else {}
    built_at = build.get("built_at")
    if not built_at:
        built_at = datetime.fromtimestamp(paths.graph_json.stat().st_mtime, tz=timezone.utc).isoformat(
            timespec="seconds"
        )
    return {
        "built": True,
        "commit": build.get("commit") or read_json(paths.graph_json).get("built_at_commit"),
        "built_at": built_at,
        "stats": build.get("stats"),
    }


def stats(paths: ProjectPaths) -> dict:
    if not paths.is_built():
        raise not_built()
    build = read_json(paths.build_json) if paths.build_json.is_file() else {}
    if build.get("stats"):
        return build["stats"]
    data = read_json(paths.graph_json)
    nodes = data.get("nodes", [])
    edges = data.get("links", data.get("edges", []))
    communities = {n.get("community") for n in nodes if n.get("community") is not None}
    return {"files": 0, "nodes": len(nodes), "edges": len(edges), "communities": len(communities),
            "duration_ms": 0, "graphify_version": graphify_version(), "incremental": False}


def report(paths: ProjectPaths) -> dict:
    if not paths.is_built():
        raise not_built()
    text = paths.report_md.read_text(encoding="utf-8") if paths.report_md.is_file() else ""
    return {"report_md": text}


# ---------------------------------------------------------------------------
# communities / god nodes
# ---------------------------------------------------------------------------

def _top_nodes(G: nx.Graph, members: list[str], n: int) -> list[dict]:
    ranked = sorted(members, key=lambda nid: (-degree(G, nid), nid))[:n]
    return [
        {
            "id": nid,
            "label": str(G.nodes[nid].get("label") or nid),
            "source_file": str(G.nodes[nid].get("source_file") or ""),
            "source_location": str(G.nodes[nid].get("source_location") or ""),
            "degree": degree(G, nid),
        }
        for nid in ranked
    ]


def communities_view(store: GraphStore, paths: ProjectPaths) -> dict:
    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    cohesion = cohesion_for(G, communities)
    ordered = sorted(communities.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    return {
        "communities": [
            {
                "id": cid,
                "label": labels.get(cid, f"Community {cid}"),
                "size": len(members),
                "cohesion": round(float(cohesion.get(cid, 0.0)), 4),
                "top_nodes": _top_nodes(G, members, TOP_NODES_PER_COMMUNITY),
            }
            for cid, members in ordered
        ]
    }


def god_nodes_view(store: GraphStore, paths: ProjectPaths, top: int) -> dict:
    from graphify.analyze import god_nodes

    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    out = []
    for item in god_nodes(G, top_n=top):
        nid = item.get("id")
        if nid not in G:
            continue
        cid = community_of(G, nid)
        out.append(
            {
                "id": nid,
                "label": str(item.get("label") or nid),
                "source_file": str(G.nodes[nid].get("source_file") or ""),
                "source_location": str(G.nodes[nid].get("source_location") or ""),
                "degree": int(item.get("degree", degree(G, nid))),
                "community_id": cid,
                "community_name": labels.get(cid) if cid is not None else None,
            }
        )
    return {"nodes": out}


# ---------------------------------------------------------------------------
# GraphView projections
# ---------------------------------------------------------------------------

def _cap_code_view(G: nx.Graph, node_ids: set[str], edge_pairs: list[tuple[str, str]],
                   labels: dict[int, str], limit: int) -> dict:
    total_nodes = len(node_ids)
    total_edges = len(edge_pairs)
    kept = sorted(node_ids, key=lambda nid: (-degree(G, nid), nid))[:limit]
    kept_set = set(kept)
    edges = [(u, v) for u, v in edge_pairs if u in kept_set and v in kept_set]
    edge_cap = limit * EDGE_FACTOR
    truncated = total_nodes > limit or len(edges) > edge_cap
    edges = edges[:edge_cap]
    return {
        "level": "code",
        "nodes": [code_node(G, nid, labels) for nid in kept],
        "edges": [code_edge(u, v, edge_data(G, u, v)) for u, v in edges],
        "truncated": truncated,
        "total_nodes": total_nodes,
        "total_edges": total_edges,
    }


def community_meta_view(store: GraphStore, paths: ProjectPaths, limit: int) -> dict:
    """One node per community, edges = cross-community edge counts.

    This is the aggregation graphify's `exporters.html.to_html` performs when a
    graph exceeds its viz limit; it lives inline there, so the ~20 lines are
    reproduced here rather than imported.
    """
    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    cohesion = cohesion_for(G, communities)
    node_to_community = {nid: cid for cid, members in communities.items() for nid in members}
    edge_counts: Counter[tuple[int, int]] = Counter()
    for u, v in G.edges():
        cu, cv = node_to_community.get(u), node_to_community.get(v)
        if cu is not None and cv is not None and cu != cv:
            edge_counts[(min(cu, cv), max(cu, cv))] += 1

    ordered = sorted(communities.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    total_nodes = len(ordered)
    kept = ordered[:limit]
    kept_ids = {cid for cid, _ in kept}
    all_edges = sorted(edge_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    visible = [(pair, w) for pair, w in all_edges if pair[0] in kept_ids and pair[1] in kept_ids]
    edge_cap = limit * EDGE_FACTOR
    truncated = total_nodes > limit or len(visible) > edge_cap
    visible = visible[:edge_cap]
    return {
        "level": "community",
        "nodes": [
            {
                "id": f"c:{cid}",
                "kind": "community",
                "label": labels.get(cid, f"Community {cid}"),
                "size": len(members),
                "community_id": cid,
                "cohesion": round(float(cohesion.get(cid, 0.0)), 4),
            }
            for cid, members in kept
        ],
        "edges": [
            {"source": f"c:{a}", "target": f"c:{b}", "relation": "cross_community", "weight": w}
            for (a, b), w in visible
        ],
        "truncated": truncated,
        "total_nodes": total_nodes,
        "total_edges": len(all_edges),
    }


def community_subgraph_view(store: GraphStore, paths: ProjectPaths, community_id: int, limit: int) -> dict:
    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    members = communities.get(community_id)
    if not members:
        raise ApiError(404, "unknown_community", f"community {community_id} does not exist")
    member_set = set(members)
    pairs = sorted((u, v) for u, v in G.subgraph(members).edges() if u != v)
    return _cap_code_view(G, member_set, pairs, labels, limit)


def resolve_node_id(G: nx.Graph, needle: str) -> str:
    if needle in G:
        return needle
    from graphify.serve import _find_node

    matches = _find_node(G, needle)
    if not matches:
        raise ApiError(404, "unknown_node", f"no node matches {needle!r}")
    return matches[0]


def focus_view(store: GraphStore, paths: ProjectPaths, focus: str, depth: int, limit: int) -> dict:
    from graphify.serve import _bfs, _traversal_view

    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    nid = resolve_node_id(G, focus)
    view = _traversal_view(G)
    nodes, edges = _bfs(view, [nid], depth)
    # Keep the focus node no matter how the degree cap falls.
    total_nodes = len(nodes)
    total_edges = len(edges)
    others = sorted((n for n in nodes if n != nid), key=lambda n: (-degree(G, n), n))
    kept = [nid, *others[: max(0, limit - 1)]]
    kept_set = set(kept)
    visible = [(u, v) for u, v in edges if u in kept_set and v in kept_set]
    edge_cap = limit * EDGE_FACTOR
    truncated = total_nodes > limit or len(visible) > edge_cap
    visible = visible[:edge_cap]
    return {
        "level": "code",
        "nodes": [code_node(G, n, labels) for n in kept],
        "edges": [code_edge(u, v, edge_data(view, u, v)) for u, v in visible],
        "truncated": truncated,
        "total_nodes": total_nodes,
        "total_edges": total_edges,
    }


# ---------------------------------------------------------------------------
# tree / callflow / wiki
# ---------------------------------------------------------------------------

def tree_view(paths: ProjectPaths, max_children: int) -> dict:
    from graphify.tree_html import build_tree

    if not paths.is_built():
        raise not_built()
    data = read_json(paths.graph_json)
    try:
        return build_tree(data, max_children=max_children, project_label=paths.key.split("--")[-1])
    except ValueError as exc:
        raise ApiError(400, "invalid_request", str(exc)) from exc


def callflow_view(paths: ProjectPaths, lang: str) -> dict:
    from graphify import callflow_html as cf

    if not paths.is_built():
        raise not_built()
    nodes, edges, _hyperedges, _meta = cf.load_graph(paths.graph_json)
    labels = cf.load_labels(paths.labels_json if paths.labels_json.is_file() else None)
    resolved_lang = cf.detect_lang(lang or "auto", nodes, labels)
    sections = cf.normalize_sections(
        cf.derive_sections_from_communities(nodes, labels, resolved_lang, CALLFLOW_MAX_SECTIONS),
        resolved_lang,
    )
    comm_idx = cf.build_community_index(nodes)
    section_nodes_map = cf.build_section_node_map(sections, comm_idx)
    classified = cf.classify_edges(edges, section_nodes_map)
    overview = cf.generate_overview_graph(
        sections, section_nodes_map, classified, labels, resolved_lang, CALLFLOW_DIAGRAM_SCALE
    )
    out = []
    for sec in sections:
        sid = sec["id"]
        if sid == "overview":
            continue
        sec_nodes = section_nodes_map.get(sid, [])
        sec_edges = classified.get("intra", {}).get(sid, [])
        out.append(
            {
                "id": sid,
                "name": sec.get("name", sid),
                "node_count": len(sec_nodes),
                "edge_count": len(sec_edges),
                "mermaid": cf.generate_section_flowchart(
                    sid, sec.get("name", sid), sec_nodes, sec_edges, resolved_lang,
                    CALLFLOW_DIAGRAM_SCALE, CALLFLOW_MAX_DIAGRAM_NODES, CALLFLOW_MAX_DIAGRAM_EDGES,
                ),
            }
        )
    return {"lang": resolved_lang, "overview_mermaid": overview, "sections": out}


def _article_title(path: Path) -> str:
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("# "):
                return line[2:].strip()
    return path.stem


def wiki_index(store: GraphStore, paths: ProjectPaths) -> dict:
    if not paths.is_built():
        raise not_built()
    wiki = paths.wiki_dir
    if not wiki.is_dir():
        return {"index_md": "", "articles": []}
    G, communities = store.load(paths)
    labels = labels_for(paths, G, communities)
    label_to_cid = {label: cid for cid, label in labels.items()}
    articles = []
    for md in sorted(wiki.glob("*.md")):
        if md.name == "index.md":
            continue
        title = _article_title(md)
        cid = label_to_cid.get(title)
        article = {"slug": md.stem, "title": title, "kind": "community" if cid is not None else "god_node"}
        if cid is not None:
            article["community_id"] = cid
        articles.append(article)
    index = wiki / "index.md"
    return {"index_md": index.read_text(encoding="utf-8") if index.is_file() else "", "articles": articles}


def wiki_article(paths: ProjectPaths, slug: str) -> dict:
    if not paths.is_built():
        raise not_built()
    if not _SLUG_RE.match(slug) or slug.startswith("."):
        raise ApiError(400, "invalid_request", "invalid article slug")
    path = (paths.wiki_dir / f"{slug}.md").resolve()
    if path.parent != paths.wiki_dir.resolve() or not path.is_file():
        raise ApiError(404, "unknown_article", f"no wiki article {slug!r}")
    return {"slug": slug, "title": _article_title(path), "markdown": path.read_text(encoding="utf-8")}
