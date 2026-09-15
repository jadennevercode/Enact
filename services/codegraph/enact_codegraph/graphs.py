"""Graph loading and shared node/edge shaping.

Graphs are loaded through graphify's own `_GraphContextCache`, which keys on
(mtime, size) of graph.json and therefore picks up a rebuilt graph on the next
request without any notification from the build path.
"""

from __future__ import annotations

import json
import weakref
from pathlib import Path

import networkx as nx

from .errors import not_built
from .projects import ProjectPaths

_cohesion_memo: "weakref.WeakKeyDictionary[nx.Graph, dict[int, float]]" = weakref.WeakKeyDictionary()
_labels_memo: "weakref.WeakKeyDictionary[nx.Graph, dict[int, str]]" = weakref.WeakKeyDictionary()


class GraphStore:
    def __init__(self, max_contexts: int) -> None:
        from graphify.serve import _GraphContextCache

        self._cache = _GraphContextCache(max_contexts)

    def load(self, paths: ProjectPaths) -> tuple[nx.Graph, dict[int, list[str]]]:
        if not paths.is_built():
            raise not_built()
        try:
            return self._cache.load(str(paths.graph_json.resolve()))
        except FileNotFoundError:
            raise not_built() from None

    def warm(self, paths: ProjectPaths) -> None:
        """Parse a freshly built graph off the request path."""
        G, communities = self.load(paths)
        labels_for(paths, G, communities)
        cohesion_for(G, communities)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def labels_for(paths: ProjectPaths, G: nx.Graph, communities: dict[int, list[str]]) -> dict[int, str]:
    """Community labels: sidecar file, then node `community_name`, then hub names."""
    cached = _labels_memo.get(G)
    if cached is not None:
        return cached
    labels: dict[int, str] = {}
    if paths.labels_json.is_file():
        try:
            raw = read_json(paths.labels_json)
            labels = {int(k): str(v) for k, v in raw.items() if int(k) in communities}
        except (ValueError, json.JSONDecodeError, AttributeError):
            labels = {}
    for cid, members in communities.items():
        if cid in labels:
            continue
        for nid in members:
            name = G.nodes[nid].get("community_name")
            if name:
                labels[cid] = str(name)
                break
    missing = {cid: members for cid, members in communities.items() if cid not in labels}
    if missing:
        from graphify.cluster import label_communities_by_hub

        labels.update(label_communities_by_hub(G, missing))
    _labels_memo[G] = labels
    return labels


def cohesion_for(G: nx.Graph, communities: dict[int, list[str]]) -> dict[int, float]:
    cached = _cohesion_memo.get(G)
    if cached is not None:
        return cached
    from graphify.cluster import score_all

    scores = score_all(G, communities)
    _cohesion_memo[G] = scores
    return scores


def degree(G: nx.Graph, nid: str) -> int:
    return int(G.degree(nid))


def community_of(G: nx.Graph, nid: str) -> int | None:
    cid = G.nodes[nid].get("community")
    return int(cid) if cid is not None else None


def code_node(G: nx.Graph, nid: str, labels: dict[int, str]) -> dict:
    data = G.nodes[nid]
    cid = community_of(G, nid)
    return {
        "id": nid,
        "kind": "code",
        "label": str(data.get("label") or nid),
        "file_type": str(data.get("file_type") or "code"),
        "source_file": str(data.get("source_file") or ""),
        "source_location": str(data.get("source_location") or ""),
        "community_id": cid,
        "community_name": labels.get(cid) if cid is not None else None,
        "degree": degree(G, nid),
    }


def code_edge(u: str, v: str, data: dict) -> dict:
    # `_src`/`_tgt` are legacy direction markers; current graphify writes the
    # true direction into source/target and strips them, but older files and
    # graphify's traversal views still carry them.
    source = data.get("_src", u)
    target = data.get("_tgt", v)
    edge = {
        "source": source,
        "target": target,
        "relation": str(data.get("relation") or "relates"),
        "confidence": str(data.get("confidence") or "EXTRACTED"),
    }
    if data.get("confidence_score") is not None:
        try:
            edge["confidence_score"] = float(data["confidence_score"])
        except (TypeError, ValueError):
            pass
    if data.get("weight") is not None:
        try:
            edge["weight"] = float(data["weight"])
        except (TypeError, ValueError):
            pass
    return edge


def edge_data(G: nx.Graph, u: str, v: str) -> dict:
    data = G.get_edge_data(u, v)
    if data is None:
        data = G.get_edge_data(v, u) or {}
    if G.is_multigraph() and data:
        # First parallel edge, matching graphify's renderer.
        data = next(iter(data.values()))
    return data
