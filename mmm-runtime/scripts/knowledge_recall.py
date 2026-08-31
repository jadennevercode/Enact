#!/usr/bin/env python3
"""Recall industry priors for an engagement, and say which pack answered.

    knowledge_recall.py <engagement> "<what you are asking for>" [--k 8]
    knowledge_recall.py <engagement> --pack

`shared/lib/knowledge.py` has held the retrieval logic and the anchoring rule for
a while, but nothing on the command line could call it, so every step that said
"recall the industry prior" was really asking a model to remember one. This is
that missing entry point and nothing more: same anchor rule, same packs, same
empty-is-a-real-answer contract.

`--pack` answers the earlier question — does this engagement's industry match a
pack at all — which is what decides whether the factor tree can start from an
industry template.

Prints YAML. Exit 1 when nothing matched, so a caller can tell "no prior" from
"here is the prior" without parsing prose.
"""
from __future__ import annotations

import os
import sys

PLUGIN = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
sys.path.insert(0, os.path.join(PLUGIN, "shared", "lib"))

import engagement as eng  # noqa: E402
import knowledge  # noqa: E402
import yamlio  # noqa: E402

#: How much of a hit to print. Enough to judge relevance and to quote from;
#: the file itself is one `Read` away when a step needs all of it.
EXCERPT = 900


def anchor_of(root):
    """The engagement's industry anchor, from mmm.yaml, falling back to the profile."""
    data = eng.read_yaml(os.path.join(root, "mmm.yaml")) if os.path.isfile(
        os.path.join(root, "mmm.yaml")) else {}
    anchor = dict(data.get("industry") or {})
    if not str(anchor.get("l1") or "").strip():
        profile = os.path.join(root, "artifacts", "s1", "project-profile.yaml")
        if os.path.isfile(profile):
            anchor = dict(((eng.read_yaml(profile) or {}).get("profile") or {}).get("industry") or {})
    return {key: str(anchor.get(key) or "").strip() for key in ("l1", "l2", "l3")}


def describe_pack(root):
    anchor = anchor_of(root)
    if not anchor["l1"]:
        return {
            "anchor": "none",
            "pack": "none",
            "why": "项目档案里没有行业。行业是 scoping 时定的，它决定这棵树能召回哪个知识包——"
                   "回去把行业问出来，或者让客户上传一棵他们自己的因子树。",
        }, 1
    pack = knowledge.industry_pack(anchor)
    label = "/".join(part for part in (anchor["l1"], anchor["l2"], anchor["l3"]) if part)
    if pack is None:
        return {
            "anchor": label,
            "pack": "none",
            "why": "%s 没有行业包。这是一个真答案，不是故障——但它意味着不能从行业模板起底。" % label,
        }, 1
    return {
        "anchor": label,
        "pack": pack.get("id", ""),
        "kind": pack.get("kind", ""),
        "files": list(pack.get("files") or []),
    }, 0


def main(argv):
    if not argv:
        print(__doc__.strip())
        return 2
    root = eng.find_engagement(argv[0])
    rest = argv[1:]

    if "--pack" in rest:
        payload, code = describe_pack(root)
        sys.stdout.write(yamlio.dump(payload))
        return code

    ask = rest[0] if rest and not rest[0].startswith("--") else ""
    if not ask:
        print("要说清楚召回什么，例：knowledge_recall.py <工作区> \"L3/L4 与候选指标\"")
        return 2
    count = 8
    if "--k" in rest:
        try:
            count = int(rest[rest.index("--k") + 1])
        except (IndexError, ValueError):
            return 2

    anchor = anchor_of(root)
    if not anchor["l1"]:
        sys.stdout.write(yamlio.dump({"knowledgeRecall": "none", "hits": [],
                                      "why": "没有行业锚点，召回不成立"}))
        return 1
    result = knowledge.recall(anchor, ask, count)
    if result is None:
        sys.stdout.write(yamlio.dump({
            "knowledgeRecall": "none", "ask": ask, "hits": [],
            "why": "召回为空。按 shared/knowledge-recall.md：照本项目自己的材料推，"
                   "标 knowledgeRecall: none，并且不许有任何一行标成 source: template。"}))
        return 1
    sys.stdout.write(yamlio.dump({
        "knowledgeRecall": result.source,
        "ask": ask,
        "industryPack": result.industry or "none",
        "note": result.note,
        "hits": [{"pack": hit["pack"], "file": hit["file"], "title": hit["title"],
                  "score": hit["score"],
                  "excerpt": hit["text"][:EXCERPT],
                  "truncated": len(hit["text"]) > EXCERPT}
                 for hit in result.items],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
