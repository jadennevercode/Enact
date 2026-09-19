"""Build subprocess: runs graphify's code-only pipeline for one project.

Runs as `python -m enact_codegraph.build_worker <src> <out> <commit> [--force]`
with GRAPHIFY_OUT set to the absolute output directory, because
`graphify.paths.GRAPHIFY_OUT` is read once at import time and the service
process serves many projects.

Primary path: `graphify.watch._rebuild_code`, the implementation behind
`graphify update`. It already does incremental AST re-extraction against the
manifest, merge + prune, clustering with stable community ids, hub-derived
labels, GRAPH_REPORT.md and an atomic graph.json write, and it never calls an
LLM. It is an underscore-prefixed API, so graphifyy is pinned in pyproject and
the tests exercise this entry point; if a future version breaks it, the public
function chain below (`fallback_build`) produces the same artifacts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RESULT_MARKER = "CODEGRAPH_RESULT "


def _emit(payload: dict) -> None:
    print(RESULT_MARKER + json.dumps(payload), flush=True)


def _load_graph(graph_json: Path):
    from networkx.readwrite import json_graph

    data = json.loads(graph_json.read_text(encoding="utf-8"))
    if "links" not in data and "edges" in data:
        data = dict(data, links=data["edges"])
    data = {**data, "directed": True}
    try:
        return json_graph.node_link_graph(data, edges="links")
    except TypeError:  # pragma: no cover - older networkx
        return json_graph.node_link_graph(data)


def _communities_from_graph(G) -> dict[int, list[str]]:
    communities: dict[int, list[str]] = {}
    for node_id, data in G.nodes(data=True):
        cid = data.get("community")
        if cid is not None:
            communities.setdefault(int(cid), []).append(node_id)
    return communities


def rebuild_with_graphify(src: Path, force: bool) -> bool:
    from graphify.watch import _rebuild_code

    return bool(_rebuild_code(src, force=force, block_on_lock=True))


def fallback_build(src: Path, out: Path, commit: str) -> None:
    """Public-function chain producing graph.json, GRAPH_REPORT.md and labels."""
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.build import build
    from graphify.cluster import cluster, label_communities_by_hub, score_all
    from graphify.detect import detect
    from graphify.export import to_json
    from graphify.extract import extract
    from graphify.report import generate

    out.mkdir(parents=True, exist_ok=True)
    detected = detect(src)
    code_files = [Path(f) for f in detected["files"].get("code", [])]
    if not code_files:
        raise RuntimeError("no code files found")
    result = extract(code_files, cache_root=out, root=src)
    G = build([result], root=src)
    communities = cluster(G)
    labels = label_communities_by_hub(G, communities)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    questions = suggest_questions(G, communities, labels)
    report = generate(
        G, communities, cohesion, labels, gods, surprises, detected,
        {"input": 0, "output": 0}, str(src),
        suggested_questions=questions, built_at_commit=commit,
    )
    if not to_json(G, communities, str(out / "graph.json"), force=True,
                   built_at_commit=commit, community_labels=labels):
        raise RuntimeError("graphify refused to write graph.json")
    (out / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (out / ".graphify_labels.json").write_text(
        json.dumps({str(k): v for k, v in sorted(labels.items())}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def ensure_labels_and_wiki(out: Path) -> None:
    """Hub labels when the labels sidecar is missing; regenerate the wiki always.

    `label_communities_by_hub` is the deterministic, LLM-free labeler; we never
    call `generate_community_labels`.
    """
    import shutil

    from graphify.analyze import god_nodes
    from graphify.cluster import label_communities_by_hub, score_all
    from graphify.wiki import to_wiki

    graph_json = out / "graph.json"
    G = _load_graph(graph_json)
    communities = _communities_from_graph(G)
    if not communities:
        return
    labels_path = out / ".graphify_labels.json"
    labels: dict[int, str] = {}
    if labels_path.is_file():
        try:
            labels = {int(k): str(v) for k, v in json.loads(labels_path.read_text(encoding="utf-8")).items()}
        except (ValueError, json.JSONDecodeError):
            labels = {}
    missing = {cid: members for cid, members in communities.items() if cid not in labels}
    if missing:
        labels.update(label_communities_by_hub(G, missing))
        labels_path.write_text(
            json.dumps({str(k): v for k, v in sorted(labels.items())}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    wiki_dir = out / "wiki"
    if wiki_dir.exists():
        shutil.rmtree(wiki_dir)
    to_wiki(G, communities, wiki_dir, community_labels=labels,
            cohesion=score_all(G, communities), god_nodes_data=god_nodes(G))


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        _emit({"ok": False, "error": "usage: build_worker <src> <out> <commit> [--force]"})
        return 2
    src = Path(argv[0]).resolve()
    out = Path(argv[1]).resolve()
    commit = argv[2]
    force = "--force" in argv[3:]
    used = "rebuild_code"
    try:
        ok = False
        try:
            ok = rebuild_with_graphify(src, force)
        except Exception as exc:  # noqa: BLE001 - reported below
            print(f"[codegraph] _rebuild_code raised: {exc}", file=sys.stderr, flush=True)
        if not ok or not (out / "graph.json").is_file():
            used = "fallback"
            fallback_build(src, out, commit)
        ensure_labels_and_wiki(out)
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "error": str(exc), "used": used})
        return 1
    _emit({"ok": True, "used": used})
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through subprocess
    sys.exit(main(sys.argv[1:]))
