# 图运行时适配器

V1 不带适配器。`tools/cypher` 只做两件事：把 candidate 投影成 openCypher，
以及对生成的脚本做静态检查（括号、引号、语句、标签合法性、引用的 id 是否在 candidate 里）。

流程 §5.2 的 `managed graph import & conformance` 在这里只完成了能在笔记本上验证的那一半。
这是一个明确的边界，不是一个待办：**没有适配器时，`evaluate` 的 graph-answer test
记为 `unsupported`，不是记为失败。**

## 要加一个适配器，需要实现什么

```python
# tools/cypher/adapters/<name>.py

def available() -> bool:
    """这台机器能不能连上。返回 False 时调用方把相关检查记为 skipped，不是 fail。"""

def import_bundle(script: str, *, database: str) -> dict:
    """在一个干净的库上跑一遍脚本。返回：
       {"ok": bool, "statements": int, "nodes": int, "relationships": int,
        "errors": [str], "duration_ms": int}
       必须在一个可丢弃的库或命名空间上跑——导入一次候选本体不应该动到任何现有数据。"""

def conformance(*, database: str, bundle: dict) -> dict:
    """导入之后，图里的东西和 candidate 说的是不是一回事。返回：
       {"ok": bool, "missing": [id], "unexpected": [id], "mismatched": [{"id":..., "field":...}]}"""

def answer(query: str, *, database: str) -> dict:
    """跑一条只读查询，给 evaluate 的 graph-answer test 用。返回：
       {"rows": [...], "shape": {...}, "duration_ms": int}"""
```

## 接进来之后要改哪两处

1. `tools/validators/revision_checks.py` 的 `cypher_generated_and_parses`：
   静态检查之后追加一次真实 import + conformance，结果并入同一个检查。
2. `shared/manifests/checks.yaml`：把这条检查的 `asserts` 改写成实际断言的内容。
   **不要新增一条检查而把旧的留着**——两条名字相近、断言不同的检查，
   审阅的人分不清哪条才算数。

## 为什么不默认带一个

目标机器是领域专家和顾问的笔记本。为了一个 V1 用不到的能力要求他们装 docker，
会把 Define 到 Review 这一整段本来只用标准库就能跑的流程一起挡在门外。
依赖分层的规矩写在 `shared/conventions.md` 第 6 条：缺依赖是明确阻塞，
不是悄悄降级——反过来，也不为了以后可能用到的东西现在就收费。
