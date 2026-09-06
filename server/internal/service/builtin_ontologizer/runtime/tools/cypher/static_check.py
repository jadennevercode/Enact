"""Static checks on generated Cypher.

Not a parser for the whole language — a check that the script this package emits
is well formed and internally consistent with the bundle it came from. A script
that references a declaration the candidate does not contain would fail at import
time in a graph runtime we do not have here, so it is caught here instead.
"""

from __future__ import annotations

import re

ID_LITERAL = re.compile(r"\{id:\s*'((?:[^'\\]|\\.)*)'\s*\}")
LABEL = re.compile(r":([A-Za-z][A-Za-z0-9_]*)")
BAD_LABEL = re.compile(r":\s*[^A-Za-z\s]")


def _strip_comments(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.strip().startswith("//"))


def check(script: str, declaration_ids: set[str]) -> list[str]:
    """Return a list of problems; an empty list means the script is usable."""
    problems: list[str] = []
    body = _strip_comments(script)

    if not body.strip():
        return ["Cypher 脚本为空"]

    for symbol_open, symbol_close in (("(", ")"), ("{", "}"), ("[", "]")):
        if body.count(symbol_open) != body.count(symbol_close):
            problems.append(
                f"括号不平衡：{symbol_open} 出现 {body.count(symbol_open)} 次，"
                f"{symbol_close} 出现 {body.count(symbol_close)} 次"
            )

    unescaped = re.sub(r"\\'", "", body)
    if unescaped.count("'") % 2 != 0:
        problems.append("单引号数量为奇数——存在未闭合的字符串")

    statements = [item.strip() for item in body.split(";") if item.strip()]
    if not statements:
        problems.append("没有以分号结束的语句")
    for index, statement in enumerate(statements):
        head = statement.split(None, 1)[0].upper() if statement.split() else ""
        if head not in ("MERGE", "MATCH", "CREATE", "SET", "WITH", "RETURN", "UNWIND"):
            problems.append(f"语句 {index + 1} 以 {head or '空'} 开头，不是受支持的子句")

    for label in set(LABEL.findall(body)):
        if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", label):
            problems.append(f"标签或关系类型非法：{label}")

    if declaration_ids:
        referenced = {match.replace("\\'", "'") for match in ID_LITERAL.findall(body)}
        unknown = sorted(referenced - declaration_ids)
        if unknown:
            shown = ", ".join(unknown[:8])
            more = f"（另有 {len(unknown) - 8} 个）" if len(unknown) > 8 else ""
            problems.append(f"脚本引用了 candidate 中不存在的 id：{shown}{more}")

    return problems
