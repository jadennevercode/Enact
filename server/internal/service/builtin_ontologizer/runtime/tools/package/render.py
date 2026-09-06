"""Deterministic rendering of a candidate release into a Skill package.

No timestamps, no wall clock, sorted iteration everywhere. A package that changed
its bytes on every render could never be checked against its source.

What goes in is the model and what it does not know. What stays out is the raw
evidence: the package cites source ids and anchor locations so a reader can go
find the sentence, but it does not carry the sentence (流程 §12.4).
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
import digest as digest_lib  # noqa: E402
from paths import Paths  # noqa: E402

from tools.trace.index import _declarations  # noqa: E402

PACKAGE_ROOT = "skill-package"
KIND_TITLES = {
    "entity": "实体", "relationship": "关系", "attribute": "属性",
    "event": "事件", "lifecycle": "生命周期", "constraint": "约束",
    "policy": "政策", "capability": "能力", "binding": "绑定", "metric": "指标",
}


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _load(path: Path):
    if not Path(path).is_file():
        return None
    try:
        return yamlio.load_path(path)
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# gathering
# --------------------------------------------------------------------------- #

def gather(workspace: Path, revision_id: str) -> dict:
    """Everything the package needs, read once, in a shape the writers can use."""
    paths = Paths(Path(workspace))
    directory = paths.revision(revision_id)
    candidate = _load(directory / "candidate.yaml") or {}
    bundle = candidate.get("bundle", candidate) or {}
    project = _load(paths.project) or {}
    charter = _load(paths.charter) or {}

    declarations = _declarations(bundle)
    fagc = _load(paths.fagc) or {}
    statements = [s for s in _as_list(fagc.get("statements")) if isinstance(s, dict)]

    cq_register = _load(paths.cq_register) or {}
    questions = {
        q["cq_id"]: q for q in _as_list(cq_register.get("questions"))
        if isinstance(q, dict) and q.get("cq_id")
    }
    results: dict[str, dict] = {}
    if paths.evaluation_runs.is_dir():
        for path in sorted(paths.evaluation_runs.glob("*.yaml")):
            run = _load(path) or {}
            if run.get("revision") != revision_id:
                continue
            for item in _as_list(run.get("results")):
                if isinstance(item, dict) and item.get("cq_id"):
                    results[item["cq_id"]] = item

    release_id, scopes = None, []
    for candidate_release in reversed(paths.release_ids()):
        selection = _load(paths.release(candidate_release) / "selection.yaml") or {}
        if selection.get("candidate_revision") == revision_id:
            release_id = candidate_release
            scope_doc = _load(paths.release(candidate_release) / "access-scopes.yaml") or {}
            scopes = [s for s in _as_list(scope_doc.get("scopes")) if isinstance(s, dict)]
            break

    return {
        "workspace": Path(workspace),
        "revision": revision_id,
        "revision_meta": _load(directory / "revision.yaml") or {},
        "bundle": bundle,
        "declarations": declarations,
        "project": project,
        "charter": charter,
        "statements": statements,
        "questions": questions,
        "results": results,
        "release": release_id,
        "scopes": scopes,
        "evidential": _load(directory / "evidential_ir.yaml") or {},
        "alignment": _load(directory / "alignment.yaml") or {},
        "process": _load(directory / "process_ir.yaml") or {},
        "cypher": (directory / "candidate.cypher").read_text(encoding="utf-8")
        if (directory / "candidate.cypher").is_file() else "",
    }


def slug_of(data: dict) -> str:
    project = data["project"]
    return str(project.get("slug") or data["bundle"].get("domain", {}).get("id") or "ontology")


# --------------------------------------------------------------------------- #
# SKILL.md
# --------------------------------------------------------------------------- #

def _aliases(item: dict) -> list[str]:
    names = [item.get("view_label"), item.get("canonical_name")]
    names += [str(a) for a in _as_list(item.get("aliases"))]
    return [n for n in dict.fromkeys(filter(None, names))]


def description(data: dict) -> str:
    """The trigger. Names the domain, its main objects and their aliases, and the
    question shapes it answers — because a description that only says "an ontology"
    fires for everything and therefore for nothing."""
    bundle = data["bundle"]
    domain = bundle.get("domain") or {}
    entities = [item for item in _declarations(bundle).values() if item["_kind"] == "entity"]
    names: list[str] = []
    for item in sorted(entities, key=lambda x: x["id"])[:8]:
        names.extend(_aliases(item)[:3])
    seen = list(dict.fromkeys(names))[:14]

    kinds = {kind: 0 for kind in KIND_TITLES}
    for item in _declarations(bundle).values():
        kinds[item["_kind"]] = kinds.get(item["_kind"], 0) + 1

    asks = []
    for question in list(data["questions"].values())[:4]:
        text = str(question.get("question") or "").strip().rstrip("？?")
        if text:
            asks.append(f"「{text}」")

    parts = [
        f"{domain.get('name') or domain.get('id') or slug_of(data)} 领域的受治理本体，"
        f"覆盖 {kinds.get('entity', 0)} 个实体、{kinds.get('relationship', 0)} 条关系、"
        f"{kinds.get('event', 0)} 个事件、{kinds.get('lifecycle', 0)} 条生命周期、"
        f"{kinds.get('constraint', 0)} 条约束。",
        f"讲到{'、'.join(seen)}这些说法时用它——它给出这些对象的准确定义、身份键、"
        "关系方向与基数、状态与允许的转换、必须成立的约束，以及每条结论的出处。",
    ]
    if asks:
        parts.append(f"典型问题：{'、'.join(asks)}。")
    parts.append(
        "回答这个领域的问题、判断某个操作允不允许、解释某个字段口径、"
        "或者要把业务说法对到系统对象上时，先查它再回答；"
        "它同时明确写了自己不知道什么，遇到边界之外的问题应当说不知道，而不是推测。"
    )
    return "".join(parts)


def skill_md(data: dict) -> str:
    bundle = data["bundle"]
    domain = bundle.get("domain") or {}
    slug = slug_of(data)
    counts = {kind: 0 for kind in KIND_TITLES}
    for item in data["declarations"].values():
        counts[item["_kind"]] = counts.get(item["_kind"], 0) + 1

    unknowns = open_questions(data)
    lines = [
        "---",
        f"name: {slug}",
        f"description: {description(data)}",
        "---",
        "",
        f"# {domain.get('name') or slug} · 本体",
        "",
        f"来自 {data['revision']}"
        + (f"（release {data['release']}）" if data["release"] else "")
        + "。这是一份受治理的语义模型，不是一份可以改的草稿：",
        "内容由构建流程产出并经检查，改动要回到那边走一次修订。",
        "",
        "## 先读哪一份",
        "",
        "| 你要什么 | 读 |",
        "|---|---|",
        "| 某个业务说法指的是哪个对象 | `ontology/glossary.md` |",
        "| 对象的定义、身份键、属性 | `ontology/entities.md` |",
        "| 两个对象怎么连、方向与基数 | `ontology/relationships.md` |",
        "| 状态怎么变、什么时候允许变 | `ontology/behaviour.md` |",
        "| 什么必须成立、谁可以做什么 | `ontology/constraints.md` |",
        "| 这份模型能回答哪些问题 | `references/competency-questions.md` |",
        "| **它不知道什么** | `references/boundaries.md` |",
        "| 某条结论的依据从哪来 | `references/provenance.md` |",
        "| 机器可读的完整模型 | `ontology/bundle.yaml` · `ontology/graph.cypher` |",
        "",
        "## 怎么用",
        "",
        "1. **先对术语。** 用户的说法未必是模型里的名字。查 `ontology/glossary.md`，",
        "   把说法解析成稳定 id，再往下走。解析不到就说解析不到——",
        "   猜一个相近的对象，后面所有推理都建在错的东西上。",
        "2. **按结构回答，不按印象回答。** 关系有方向和基数，属性有口径和单位，",
        "   状态转换有前置条件。这些都写在文件里，照着说。",
        "3. **先看边界再回答。** `references/boundaries.md` 列了未决的假设、",
        "   互相冲突且尚未裁决的说法、以及这份模型明确不承诺的能力。",
        "   问题落在那里面时，正确的回答是说明它未决，而不是挑一边讲。",
        "4. **带出处。** 每个对象都有 id，`references/provenance.md` 说它从哪条材料来。",
        "   回答里带上 id，让人能自己查。",
        "",
        "## 这份本体有什么",
        "",
        "| 构件 | 数量 |",
        "|---|---|",
    ]
    for kind, title in KIND_TITLES.items():
        if counts.get(kind):
            lines.append(f"| {title} | {counts[kind]} |")
    lines += [
        "",
        "## 它不做什么",
        "",
        "- **不存业务数据。** 这里是类型层：有哪些对象、怎么连、什么必须成立。",
        "  具体某一条记录的值要去源系统查。",
        "- **不授权。** 里面的 scope 声明的是受治理的资源边界，不代表谁可以访问什么。",
        "- **不替代判断。** 约束和政策写的是规则，具体一次操作允不允许，",
        "  要结合当时的数据和当时生效的版本。",
    ]
    if unknowns:
        lines += [
            "",
            f"- **有 {len(unknowns)} 处已知的未决**，逐条写在 `references/boundaries.md`。",
            "  碰到它们时说未决，不要替它们做决定。",
        ]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# ontology/ documents
# --------------------------------------------------------------------------- #

def _support_ids(item: dict) -> str:
    parts = []
    for support in _as_list(item.get("support")):
        if not isinstance(support, dict):
            continue
        kind = support.get("type")
        reference = support.get("alignment_id") or support.get("id") or ""
        parts.append(f"{kind}:{reference}" if reference else str(kind))
    return "、".join(parts) or "—"


def entities_md(data: dict) -> str:
    bundle = data["bundle"]
    attributes: dict[str, list[dict]] = {}
    for item in _as_list(bundle.get("attributes")):
        if isinstance(item, dict) and item.get("owner"):
            attributes.setdefault(item["owner"], []).append(item)

    lines = ["# 实体", ""]
    for item in sorted(_as_list(bundle.get("entities")), key=lambda x: x.get("id", "")):
        if not isinstance(item, dict):
            continue
        lines.append(f"## {item.get('view_label') or item.get('id')}  `{item.get('id')}`")
        lines.append("")
        lines.append(item.get("definition", "").strip() or "_（无定义）_")
        lines.append("")
        aliases = [a for a in _as_list(item.get("aliases"))]
        if aliases:
            lines.append(f"**别名**：{'、'.join(str(a) for a in aliases)}")
        counter = _as_list(item.get("counter_examples"))
        if counter:
            lines.append(f"**不是它**：{'；'.join(str(c) for c in counter)}")
        if item.get("identity_keys"):
            lines.append(f"**身份键**：{'、'.join(str(k) for k in _as_list(item['identity_keys']))}")
        if item.get("classification"):
            lines.append(f"**分类**：{item['classification']}")
        lines.append(f"**依据**：{_support_ids(item)}")
        owned = sorted(attributes.get(item.get("id"), []), key=lambda x: x.get("id", ""))
        if owned:
            lines += ["", "| 属性 | 类型 | 口径 | 可空 | 分类 |", "|---|---|---|---|---|"]
            for attribute in owned:
                lines.append(
                    f"| `{attribute.get('id')}` | {attribute.get('datatype', '—')} | "
                    f"{attribute.get('unit_or_format') or '—'} | "
                    f"{'是' if attribute.get('nullable') else '否'} | "
                    f"{attribute.get('classification') or '—'} |"
                )
        lines.append("")
    return "\n".join(lines)


def relationships_md(data: dict) -> str:
    lines = [
        "# 关系", "",
        "方向读作「源 → 目标」。基数写在两端：`1` 表示恰好一个，`many` 表示多个。", "",
        "| id | 源 | → | 目标 | 基数 | 语义 | 定义 |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in sorted(_as_list(data["bundle"].get("relationships")), key=lambda x: x.get("id", "")):
        if not isinstance(item, dict):
            continue
        cardinality = item.get("cardinality") or {}
        lines.append(
            f"| `{item.get('id')}` | `{item.get('source')}`（{item.get('source_role', '—')}） | "
            f"{item.get('canonical_name') or '→'} | "
            f"`{item.get('target')}`（{item.get('target_role', '—')}） | "
            f"{cardinality.get('source', '?')} : {cardinality.get('target', '?')} | "
            f"{item.get('semantics', '—')} | {(item.get('definition') or '').strip()} |"
        )
    return "\n".join(lines) + "\n"


def behaviour_md(data: dict) -> str:
    bundle = data["bundle"]
    lines = ["# 事件与生命周期", "", "## 事件", ""]
    events = sorted(_as_list(bundle.get("events")), key=lambda x: x.get("id", ""))
    if not events:
        lines.append("_这份本体没有建事件——它只描述了对象和关系，没有描述世界怎么变化。_")
    for item in events:
        if not isinstance(item, dict):
            continue
        lines.append(f"### {item.get('id')}")
        lines.append("")
        lines.append((item.get("definition") or "").strip() or "_（无定义）_")
        lines.append("")
        if item.get("participants"):
            lines.append(f"**参与者**：{'、'.join(f'`{p}`' for p in _as_list(item['participants']))}")
        if item.get("changes_state_of"):
            lines.append(f"**改变谁的状态**：`{item['changes_state_of']}`")
        if item.get("process_ref"):
            lines.append(f"**流程位置**：`{item['process_ref']}`")
        lines.append("")

    lines += ["## 生命周期", ""]
    lifecycles = sorted(_as_list(bundle.get("lifecycles")), key=lambda x: x.get("id", ""))
    if not lifecycles:
        lines.append("_没有建生命周期——状态字段可以写任意值，不受允许路径约束。_")
    for item in lifecycles:
        if not isinstance(item, dict):
            continue
        lines.append(f"### `{item.get('entity')}` 的状态")
        lines.append("")
        lines.append(f"状态：{'、'.join(str(s) for s in _as_list(item.get('states')))}")
        lines.append("")
        lines += ["| 从 | 到 | 触发 | 前置条件 | 谁可以做 |", "|---|---|---|---|---|"]
        for transition in _as_list(item.get("transitions")):
            if not isinstance(transition, dict):
                continue
            lines.append(
                f"| {transition.get('from', '—')} | {transition.get('to', '—')} | "
                f"`{transition.get('trigger', '—')}` | {transition.get('guard') or '—'} | "
                f"{'、'.join(str(r) for r in _as_list(transition.get('actor_roles'))) or '—'} |"
            )
        lines.append("")
        lines.append("**没有列出来的转换就是不允许的。**")
        lines.append("")
    return "\n".join(lines)


def constraints_md(data: dict) -> str:
    bundle = data["bundle"]
    lines = [
        "# 约束与政策", "",
        "约束分三种：**公理**描述领域语义，**约束**验证数据或状态，**规则**从条件推出结论。",
        "缺少事实不等于事实为假——这里是开放世界，没有记录只说明没有记录。", "",
    ]
    for item in sorted(_as_list(bundle.get("constraints")), key=lambda x: x.get("id", "")):
        if not isinstance(item, dict):
            continue
        lines.append(f"- **`{item.get('id')}`**（{item.get('kind', 'constraint')}）"
                     f"{item.get('statement', '')}")
        scope = _as_list(item.get("scope"))
        if scope:
            lines.append(f"  作用于：{'、'.join(f'`{s}`' for s in scope)}")
        if item.get("open_world_note"):
            lines.append(f"  注：{item['open_world_note']}")
    policies = _as_list(bundle.get("policies"))
    if policies:
        lines += ["", "## 政策", ""]
        for item in sorted(policies, key=lambda x: x.get("id", "")):
            if not isinstance(item, dict):
                continue
            lines.append(
                f"- **`{item.get('id')}`**（{item.get('modality', '?')}）"
                f"{item.get('subject', '?')} 对 {item.get('action', '?')}，"
                f"条件：{item.get('condition', '—')}"
            )
    capabilities = _as_list(bundle.get("capabilities"))
    if capabilities:
        lines += ["", "## 能力", ""]
        for item in sorted(capabilities, key=lambda x: x.get("id", "")):
            if not isinstance(item, dict):
                continue
            lines.append(f"- **`{item.get('id')}`** {item.get('intent', '')}")
            if item.get("preconditions"):
                lines.append(f"  前置：{'；'.join(str(p) for p in _as_list(item['preconditions']))}")
            if item.get("effects"):
                lines.append(f"  效果：{'；'.join(str(e) for e in _as_list(item['effects']))}")
    return "\n".join(lines) + "\n"


def glossary_md(data: dict) -> str:
    lines = [
        "# 术语对照", "",
        "用户的说法在左边，模型里的对象在右边。**解析不到就说解析不到**——",
        "挑一个看起来相近的对象，会让后面所有推理都建在错的东西上。", "",
        "| 说法 | 对象 | 类型 |", "|---|---|---|",
    ]
    rows = []
    for identifier, item in data["declarations"].items():
        for alias in _aliases(item):
            rows.append((str(alias), identifier, KIND_TITLES.get(item["_kind"], item["_kind"])))
    for alias, identifier, kind in sorted(set(rows)):
        lines.append(f"| {alias} | `{identifier}` | {kind} |")

    confusable = []
    for statement in data["statements"]:
        if statement.get("classification") == "guidance" and statement.get("statement"):
            confusable.append(str(statement["statement"]))
    if confusable:
        lines += ["", "## 容易混的说法", ""]
        lines += [f"- {item}" for item in sorted(confusable)]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# references/
# --------------------------------------------------------------------------- #

def open_questions(data: dict) -> list[dict]:
    """What this ontology does not settle. The package is only trustworthy if it
    ships this list (白皮书 §8.5: bounded)."""
    found: list[dict] = []
    for statement in data["statements"]:
        status = statement.get("status")
        classification = statement.get("classification")
        if status == "disputed":
            found.append(
                {
                    "kind": "冲突未裁决",
                    "id": statement.get("statement_id"),
                    "text": statement.get("statement"),
                    "detail": f"来源 {statement.get('authority_or_owner') or '未记'}，"
                              f"适用 {statement.get('scope') or '未记'}",
                }
            )
        elif classification == "assumption" and status not in ("resolved", "deprecated"):
            found.append(
                {
                    "kind": "未决假设",
                    "id": statement.get("statement_id"),
                    "text": statement.get("statement"),
                    "detail": statement.get("rationale") or "",
                }
            )
    for cq_id, result in sorted(data["results"].items()):
        if result.get("status") in ("failed", "unsupported"):
            question = data["questions"].get(cq_id, {})
            found.append(
                {
                    "kind": "不承诺的能力" if result["status"] == "unsupported" else "已知回答不了",
                    "id": cq_id,
                    "text": question.get("question", cq_id),
                    "detail": result.get("rationale") or "",
                }
            )
    return sorted(found, key=lambda item: (item["kind"], str(item["id"])))


def boundaries_md(data: dict) -> str:
    unknowns = open_questions(data)
    lines = [
        "# 这份本体不知道什么", "",
        "**碰到下面这些，正确的回答是说明它未决，而不是挑一边讲。**",
        "一个不声明自己边界的模型，会让人把它的沉默当成否定。", "",
    ]
    if not unknowns:
        lines.append("当前没有未决的假设、未裁决的冲突或已知回答不了的问题。")
    else:
        current = None
        for item in unknowns:
            if item["kind"] != current:
                current = item["kind"]
                lines += ["", f"## {current}", ""]
            lines.append(f"- **`{item['id']}`** {item['text']}")
            if item["detail"]:
                lines.append(f"  {item['detail']}")
    charter = data["charter"]
    scope = charter.get("scope") or {}
    if scope:
        lines += ["", "## 范围之外", ""]
        for item in _as_list(scope.get("out_of_scope")):
            lines.append(f"- {item}")
        for label, key in (("时间范围", "time_range"), ("组织范围", "organisational_range"),
                           ("数据粒度", "data_granularity")):
            if scope.get(key):
                lines.append(f"- {label}：{scope[key]}（之外的没有建模）")
    return "\n".join(lines) + "\n"


def competency_md(data: dict) -> str:
    lines = [
        "# 它能回答什么", "",
        "下面是这份本体被明确检验过的问题。**通过**表示在这一版上验过；",
        "**不承诺**表示当前模型契约没有覆盖这项能力，不是缺陷；",
        "没有列出来的问题，既不表示能也不表示不能。", "",
        "| 问题 | 谁问 | 支持什么决定 | 状态 | 证据 |", "|---|---|---|---|---|",
    ]
    status_text = {"passed": "通过", "failed": "回答不了", "unsupported": "不承诺"}
    for cq_id in sorted(data["questions"]):
        question = data["questions"][cq_id]
        result = data["results"].get(cq_id, {})
        status = status_text.get(result.get("status"), "未评估")
        evidence = result.get("execution_evidence") or result.get("rationale") or "—"
        lines.append(
            f"| {question.get('question', '')} | {question.get('business_persona', '—')} | "
            f"{question.get('decision_supported', '—')} | {status} | {evidence} |"
        )
    if not data["questions"]:
        lines.append("| _还没有定义胜任问题_ | — | — | — | — |")
    return "\n".join(lines) + "\n"


def provenance_md(data: dict) -> str:
    """Where each object came from — source ids and anchor locations, never the
    source text itself (流程 §12.4 keeps raw evidence out of what ships)."""
    alignment = {
        item["id"]: item for item in _as_list(data["alignment"].get("mappings"))
        if isinstance(item, dict) and item.get("id")
    }
    facts = {
        item["id"]: item for item in _as_list(data["evidential"].get("facts"))
        if isinstance(item, dict) and item.get("id")
    }
    meta = data["revision_meta"]
    lines = [
        "# 出处", "",
        f"- 版本：`{data['revision']}`" + (f"，发布 `{data['release']}`" if data["release"] else ""),
        f"- 内容摘要：`{meta.get('content_digest', '—')}`",
        f"- 证据快照：`{(meta.get('inputs') or {}).get('evidence_snapshot_id', '—')}`",
        "",
        "这里只给来源编号和定位，不复制原文——要看原句，回到构建工作区按定位去查。",
        "", "| 对象 | 依据 | 来源 | 位置 |", "|---|---|---|---|",
    ]
    for identifier in sorted(data["declarations"]):
        item = data["declarations"][identifier]
        for support in _as_list(item.get("support")):
            if not isinstance(support, dict):
                continue
            kind = support.get("type")
            if kind == "evidence":
                mapping = alignment.get(support.get("alignment_id")) or {}
                fact = facts.get(mapping.get("source")) or {}
                anchor = fact.get("anchor")
                anchor = anchor if isinstance(anchor, dict) else (_as_list(anchor)[:1] or [{}])[0]
                lines.append(
                    f"| `{identifier}` | 证据 | `{fact.get('source_id', mapping.get('source', '—'))}` | "
                    f"{anchor.get('location', '—')} |"
                )
            else:
                lines.append(f"| `{identifier}` | {kind} | `{support.get('id', '—')}` | — |")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# assembly
# --------------------------------------------------------------------------- #

def files(data: dict) -> dict[str, str]:
    """Path relative to the package root -> content. Sorted, no timestamps."""
    bundle_doc = {"bundle": data["bundle"]}
    manifest = {
        "name": slug_of(data),
        "kind": "ontology-skill-package",
        "source_revision": data["revision"],
        "source_release": data["release"],
        "source_content_digest": (data["revision_meta"] or {}).get("content_digest"),
        "domain": (data["bundle"].get("domain") or {}).get("id"),
        "counts": {
            kind: sum(1 for item in data["declarations"].values() if item["_kind"] == kind)
            for kind in sorted({item["_kind"] for item in data["declarations"].values()})
        },
        "open_questions": len(open_questions(data)),
        "competency_questions": len(data["questions"]),
    }
    return {
        "SKILL.md": skill_md(data),
        "package.yaml": yamlio.dump(manifest),
        "ontology/bundle.yaml": yamlio.dump(bundle_doc),
        "ontology/graph.cypher": data["cypher"],
        "ontology/entities.md": entities_md(data),
        "ontology/relationships.md": relationships_md(data),
        "ontology/behaviour.md": behaviour_md(data),
        "ontology/constraints.md": constraints_md(data),
        "ontology/glossary.md": glossary_md(data),
        "references/competency-questions.md": competency_md(data),
        "references/boundaries.md": boundaries_md(data),
        "references/provenance.md": provenance_md(data),
    }


def render(workspace: Path, revision_id: str) -> dict[str, str]:
    return files(gather(Path(workspace), revision_id))


def target_dir(workspace: Path, slug: str) -> Path:
    return Paths(Path(workspace)).exports / PACKAGE_ROOT / slug


def write(workspace: Path, revision_id: str, *, plugin: bool = False) -> tuple[Path, dict[str, str]]:
    data = gather(Path(workspace), revision_id)
    slug = slug_of(data)
    rendered = files(data)
    if plugin:
        rendered[".claude-plugin/plugin.json"] = _plugin_json(data, slug)
        rendered[".claude-plugin/marketplace.json"] = _marketplace_json(data, slug)
    directory = target_dir(Path(workspace), slug)
    if directory.exists():
        import shutil

        shutil.rmtree(directory)
    for relative, content in sorted(rendered.items()):
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return directory, rendered


def _plugin_json(data: dict, slug: str) -> str:
    import json

    return json.dumps(
        {
            "name": slug,
            "description": description(data)[:300],
            "version": "0.1.0",
            "author": {"name": (data["charter"].get("owners") or {}).get("ontology") or "unknown"},
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def _marketplace_json(data: dict, slug: str) -> str:
    import json

    # No `id` key: `claude plugin validate --strict` rejects fields Claude Code
    # ignores, and a package that cannot be validated cannot be installed as a
    # plugin — which is half of what rendering it was for.
    return json.dumps(
        {
            "name": slug,
            "owner": {"name": (data["charter"].get("owners") or {}).get("ontology") or "unknown"},
            "metadata": {"description": description(data)[:200], "version": "0.1.0"},
            "plugins": [{"name": slug, "source": "./", "description": description(data)[:300]}],
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def package_digest(rendered: dict[str, str]) -> str:
    return digest_lib.combined(
        {name: digest_lib.text_digest(content) for name, content in sorted(rendered.items())}
    )
