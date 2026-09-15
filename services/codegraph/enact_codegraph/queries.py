"""Agent-facing text queries, delegated to graphify.serve / graphify.affected.

`_query_graph_text`, `_score_nodes`, `_pick_scored_endpoint`, `_find_node` and
`_subgraph_to_text` are underscore-prefixed in graphify but are the exact code
behind its own `query` / `path` / `explain` CLI commands; graphifyy is pinned.
"""

from __future__ import annotations

import networkx as nx

from .errors import ApiError
from .graphs import GraphStore
from .projects import ProjectPaths

DEFAULT_DEPTH = 3
DEFAULT_TOKEN_BUDGET = 2000
MAX_TOKEN_BUDGET = 20_000
DEFAULT_AFFECTED_DEPTH = 2
PATH_MAX_HOPS = 8


def _str(body: dict, name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, "invalid_request", f"{name} is required")
    return value.strip()


def _int(body: dict, name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    raw = body.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "invalid_request", f"{name} must be an integer") from exc
    if value < minimum:
        raise ApiError(400, "invalid_request", f"{name} must be >= {minimum}")
    if maximum is not None:
        value = min(value, maximum)
    return value


def query(store: GraphStore, paths: ProjectPaths, body: dict) -> dict:
    from graphify.serve import _query_graph_text

    G, _ = store.load(paths)
    question = _str(body, "question")
    mode = str(body.get("mode") or "bfs").lower()
    if mode not in ("bfs", "dfs"):
        raise ApiError(400, "invalid_request", "mode must be bfs or dfs")
    depth = _int(body, "depth", DEFAULT_DEPTH, maximum=10)
    budget = _int(body, "token_budget", DEFAULT_TOKEN_BUDGET, maximum=MAX_TOKEN_BUDGET)
    context = body.get("context")
    filters = None
    if context:
        if not isinstance(context, list) or not all(isinstance(c, str) for c in context):
            raise ApiError(400, "invalid_request", "context must be a list of strings")
        filters = context
    text = _query_graph_text(G, question, mode=mode, depth=depth, token_budget=budget, context_filters=filters)
    return {"text": text}


def _resolve_endpoint(G: nx.Graph, needle: str) -> str | None:
    from graphify.serve import _pick_scored_endpoint, _score_nodes

    scored = _score_nodes(G, [t.lower() for t in needle.split()])
    if not scored:
        return None
    return _pick_scored_endpoint(G, scored, needle)


def _path_ids(G: nx.Graph, source: str, target: str, undirected: bool) -> list[str]:
    """Node ids along the same canonical path `_shortest_path_text` renders."""
    src = _resolve_endpoint(G, source)
    tgt = _resolve_endpoint(G, target)
    if src is None or tgt is None or src == tgt:
        return []
    try:
        if undirected:
            und = nx.Graph()
            und.add_nodes_from(sorted(G.nodes))
            und.add_edges_from(sorted((min(u, v), max(u, v)) for u, v in G.edges()))
            return [str(n) for n in nx.shortest_path(und, src, tgt)]
        dg = nx.DiGraph()
        dg.add_nodes_from(sorted(G.nodes))
        dg.add_edges_from(sorted((d.get("_src", u), d.get("_tgt", v)) for u, v, d in G.edges(data=True)))
        return [str(n) for n in nx.shortest_path(dg, src, tgt)]
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []


def path(store: GraphStore, paths: ProjectPaths, body: dict) -> dict:
    from graphify.serve import _shortest_path_text

    G, _ = store.load(paths)
    source = _str(body, "source")
    target = _str(body, "target")
    undirected = bool(body.get("undirected", True))
    text = _shortest_path_text(
        G, {"source": source, "target": target, "undirected": undirected, "max_hops": PATH_MAX_HOPS}
    )
    ids = _path_ids(G, source, target, undirected)
    if len(ids) - 1 > PATH_MAX_HOPS:
        ids = []
    return {"text": text, "path": ids}


def explain(store: GraphStore, paths: ProjectPaths, body: dict) -> dict:
    from graphify.serve import _find_node, _subgraph_to_text, find_node_ambiguity

    G, _ = store.load(paths)
    needle = _str(body, "node")
    budget = _int(body, "token_budget", DEFAULT_TOKEN_BUDGET, maximum=MAX_TOKEN_BUDGET)
    matches = [needle] if needle in G else _find_node(G, needle)
    if not matches:
        return {"text": f"No node matching '{needle}' found.", "matches": [], "ambiguous": False}
    rivals = find_node_ambiguity(G, needle) if needle not in G else []
    nid = matches[0]
    neighbours: set[str] = {nid}
    edges: list[tuple[str, str]] = []
    if G.is_directed():
        for nb in G.successors(nid):
            neighbours.add(nb)
            edges.append((nid, nb))
        for nb in G.predecessors(nid):
            neighbours.add(nb)
            edges.append((nb, nid))
    else:
        for nb in G.neighbors(nid):
            neighbours.add(nb)
            edges.append((nid, nb))
    header = f"Explain: {G.nodes[nid].get('label', nid)} ({len(neighbours) - 1} neighbours)"
    if rivals:
        listing = "\n".join(f"  {G.nodes[r].get('source_file') or r}  id: {r}" for r in rivals)
        header += f"\nAmbiguous: {len(rivals)} nodes in different files match; showing the first.\n{listing}"
    text = header + "\n\n" + _subgraph_to_text(G, neighbours, edges, budget, seeds=[nid])
    return {"text": text, "matches": [str(m) for m in matches], "ambiguous": bool(rivals)}


def affected(store: GraphStore, paths: ProjectPaths, body: dict) -> dict:
    from graphify.affected import DEFAULT_AFFECTED_RELATIONS, format_affected

    G, _ = store.load(paths)
    seed = _str(body, "seed")
    depth = _int(body, "depth", DEFAULT_AFFECTED_DEPTH, maximum=10)
    relations = body.get("relations")
    if relations is not None:
        if not isinstance(relations, list) or not all(isinstance(r, str) for r in relations):
            raise ApiError(400, "invalid_request", "relations must be a list of strings")
        rels = tuple(relations) if relations else tuple(DEFAULT_AFFECTED_RELATIONS)
    else:
        rels = tuple(DEFAULT_AFFECTED_RELATIONS)
    return {"text": format_affected(G, seed, relations=rels, depth=depth)}
