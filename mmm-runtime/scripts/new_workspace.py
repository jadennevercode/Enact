#!/usr/bin/env python3
"""Create a v2 workspace, or migrate a v1 one.

    new_workspace.py <dir> --project "Acme Q3" --brand Acme \
                           --industry beauty/skincare/sunscreen
    new_workspace.py <dir> --migrate

The tree it creates is `shared/workspace-layout.md`, and that file is the
authority — this script is its executable form, not a second opinion.

Migration is a **rename**, not a rewrite: `intake/`→`inputs/`,
`mmm-state.yaml`→`state/progress.yaml`, flat `artifacts/`→`artifacts/s1/`. Nothing
a human decided is touched, which is why it is safe to run on a live engagement.
"""
from __future__ import annotations

import os
import shutil
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))

import engagement as eng  # noqa: E402
import yamlio  # noqa: E402

INPUT_CATEGORIES = ["project-background", "industry-reference", "org-structure",
                    "interview-minutes", "client-factor-tree", "data"]

TREE = [
    "state",
    "metadata/schema/enums",
    "inputs", "data/raw", "data/clean", "data/published", "data/derived",
    "artifacts/s1", "artifacts/s2", "artifacts/s3", "exports",
]


def _args(argv):
    opts, rest = {}, []
    i = 0
    while i < len(argv):
        token = argv[i]
        if token.startswith("--"):
            name = token[2:].replace("-", "_")
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                opts[name] = argv[i + 1]
                i += 2
            else:
                opts[name] = True
                i += 1
        else:
            rest.append(token)
            i += 1
    return opts, rest


def scaffold(root, opts):
    for folder in TREE:
        os.makedirs(os.path.join(root, folder), exist_ok=True)
    for category in INPUT_CATEGORIES:
        os.makedirs(os.path.join(root, "inputs", category), exist_ok=True)

    l1, l2, l3 = (str(opts.get("industry") or "").split("/") + ["", ""])[:3]
    identity = {
        "project": str(opts.get("project") or os.path.basename(root)),
        "brand": str(opts.get("brand") or ""),
        "industry": {"l1": l1, "l2": l2, "l3": l3},
        "outputLanguage": str(opts.get("language") or "en"),
        "workspaceVersion": 2,
        "createdAt": eng.now_iso(),
    }
    path = os.path.join(root, "mmm.yaml")
    if not os.path.isfile(path):
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(yamlio.dump(identity))

    progress = os.path.join(root, "state", "progress.yaml")
    if not os.path.isfile(progress):
        with open(progress, "w", encoding="utf-8") as handle:
            handle.write(yamlio.dump({"stage": "s1", "tasks": {}}))

    log = os.path.join(root, "state", "decisions.log")
    if not os.path.isfile(log):
        open(log, "a", encoding="utf-8").close()

    seed_schema(root, l1, l2, l3)
    return identity


def seed_schema(root, l1="", l2="", l3=""):
    """Seed `metadata/schema/` from the library default plus this industry's enums.

    Seeded, then owned: the library ships a sane contract, and the project edits it
    to describe *this* client's channels. A schema that lived only in the repo
    could not do that; one that lived only here would be reinvented every project.
    """
    target = os.path.join(root, "metadata", "schema", "target-schema.yaml")
    if not os.path.isfile(target):
        library = os.path.join(PLUGIN, "knowledge", "schema", "target-schema.yaml")
        if os.path.isfile(library):
            shutil.copyfile(library, target)
        else:
            try:
                sys.path.insert(0, os.path.join(PLUGIN, "tools", "engine", "src"))
                from mmm_engine.dataeng import target_schema as ts
                with open(target, "w", encoding="utf-8") as handle:
                    handle.write(yamlio.dump(ts.default_document()))
            except Exception as error:  # noqa: BLE001
                print("  ! could not seed the target schema (%s) — declare it by hand "
                      "before running the Data Engine" % error)

    enum_dir = os.path.join(root, "metadata", "schema", "enums")
    os.makedirs(enum_dir, exist_ok=True)

    # MOST SPECIFIC FIRST. The industry pack is the whole reason a pack exists: it
    # knows this industry's channels, and the library default is a generic
    # placeholder. Seeding the default first and skipping anything already present
    # meant the pack could never land — a beverage project silently got the generic
    # channel list, and nothing said so.
    parts = [p for p in (l1, l2, l3) if p]
    sources = [os.path.join(PLUGIN, "knowledge", "industry", *parts[:depth], "enums")
               for depth in range(len(parts), 0, -1)]
    sources.append(os.path.join(PLUGIN, "knowledge", "schema", "enums"))

    seeded = {}
    for folder in sources:
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith((".yaml", ".yml")):
                continue
            dest = os.path.join(enum_dir, name)
            if os.path.isfile(dest) or name in seeded:
                continue          # a nearer source already answered for this enum
            shutil.copyfile(os.path.join(folder, name), dest)
            seeded[name] = os.path.relpath(folder, PLUGIN)
    return seeded


def migrate(root):
    """v1 → v2. A rename; nothing is rewritten."""
    moves = []
    if os.path.isdir(os.path.join(root, "intake")) and not os.path.isdir(os.path.join(root, "inputs")):
        moves.append(("intake", "inputs"))
    if os.path.isfile(os.path.join(root, "mmm-state.yaml")):
        moves.append(("mmm-state.yaml", "state/progress.yaml"))
    if os.path.isfile(os.path.join(root, "decisions.log")):
        moves.append(("decisions.log", "state/decisions.log"))

    artifacts = os.path.join(root, "artifacts")
    s1 = os.path.join(artifacts, "s1")
    stage_moves = []
    if os.path.isdir(artifacts) and not os.path.isdir(s1):
        for name in sorted(os.listdir(artifacts)):
            if name in ("s1", "s2", "s3", "s4", "s5") or name.startswith("."):
                continue
            stage_moves.append(name)

    if not moves and not stage_moves:
        print("already v2 — nothing to move")
        return 0

    for folder in TREE:
        os.makedirs(os.path.join(root, folder), exist_ok=True)

    for src, dst in moves:
        source, dest = os.path.join(root, src), os.path.join(root, dst)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.move(source, dest)
        print("  %s -> %s" % (src, dst))

    for name in stage_moves:
        shutil.move(os.path.join(artifacts, name), os.path.join(s1, name))
        print("  artifacts/%s -> artifacts/s1/%s" % (name, name))

    identity = os.path.join(root, "mmm.yaml")
    progress = eng.read_yaml(os.path.join(root, "state", "progress.yaml"))
    data = {
        "project": str(progress.get("project") or os.path.basename(root)),
        "brand": str(progress.get("brand") or ""),
        "industry": progress.get("industry") or {"l1": "", "l2": "", "l3": ""},
        "outputLanguage": str(progress.get("outputLanguage") or "en"),
        "workspaceVersion": 2,
        "createdAt": eng.now_iso(),
    }
    with open(identity, "w", encoding="utf-8") as handle:
        handle.write(yamlio.dump(data))
    print("  wrote mmm.yaml (workspaceVersion 2)")

    ind = data["industry"] or {}
    seed_schema(root, ind.get("l1", ""), ind.get("l2", ""), ind.get("l3", ""))
    print("\nMigrated. The identity moved out of the progress file — `mmm.yaml` is now "
          "who the project is, `state/progress.yaml` only where it has got to.")
    return 0


def main(argv):
    opts, rest = _args(argv)
    if not rest:
        print(__doc__.strip())
        return 2
    root = os.path.abspath(rest[0])

    if opts.get("migrate"):
        if not os.path.isdir(root):
            print("no directory at %s" % root)
            return 2
        return migrate(root)

    if os.path.isfile(os.path.join(root, "mmm.yaml")):
        print("%s is already a workspace" % root)
        return 2
    os.makedirs(root, exist_ok=True)
    identity = scaffold(root, opts)
    print("created %s" % root)
    print("  project   %s" % identity["project"])
    print("  brand     %s" % (identity["brand"] or "(unset)"))
    ind = identity["industry"]
    anchor = "/".join(p for p in (ind["l1"], ind["l2"], ind["l3"]) if p)
    print("  industry  %s" % (anchor or "(unset — knowledge recall will be 'none')"))
    print("\nPut the client's documents in inputs/ by category, then run /mmm:status.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
