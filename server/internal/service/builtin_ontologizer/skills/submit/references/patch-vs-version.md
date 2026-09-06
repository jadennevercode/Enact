# Patch 还是 Version

**这是整套流程里唯一一个不给推荐的决策点。** 先说这一条，因为其余都是它的做法。

## 为什么不给推荐

流程 §12.2 与 §19.2 写死了：Ontologizer **不自动判断 semantic impact，
也不自动选择 Patch/Version**。最终选择属于用户的治理责任。

给出推荐等于替人做了这个判断。人会点同意——不是因为懒，是因为一个看过全部
diff 的系统说"这看起来是 Patch"，听上去比自己重新判断更可靠。
而这个判断的后果只有他知道：**下游有谁在消费这个 bundle、他们改一次要花多久、
这个季度有没有窗口**。这些东西一条都不在工作区里。

所以：**摆证据，不摆结论。连倾向性措辞都不要。**
"变更看起来是兼容的""三处改动都是新增"——这两句都是推荐，只是没说出那个词。

## 两个选项

| 选项 | 含义（RFC） | 审阅时该问自己什么（METH） |
|---|---|---|
| **Patch** | minor 版本 +1，产出 append-only migration packet | 这些变更能不能在保持现有契约连续性的前提下迁移？ |
| **Version** | major 版本 +1，产出全新的完整 bundle | 有没有身份、结构、语义或治理边界上的实质不兼容？ |

## 要摆出来的三样证据

### 1 · Semantic diff

`revisions/<candidate>/semantic-diff.yaml`。按这个顺序讲：

- **removed**，逐条带它的 `replaced_by` 或 `removal_rationale`。
  这是最该被看到的一类：`replaced_by` 有值说明下游可以改指；
  只有 `removal_rationale` 说明下游引用它的东西全断了。
- **changed 里 `authorization_impacting: true` 的**，逐条列。
- 其余 changed，按对象类型分组。
- added，报数字加类型分布。
- unaffected，只报数字。

### 2 · Authorization-impacting 变更清单

`revision.py diff` 盯六个字段：`classification`、`owner`、`source`、`target`、
`cardinality`、`datatype`。任一变化就标 `authorization_impacting: true`。

这个标记是保守的——宁可多标不漏标。摆出来的时候要说清楚它是保守判定，
不是"这条一定动了授权边界"。同时把 `access-scopes.yaml` 的
**分类字段暴露**和**跨 scope 引用**预览一起放在这里，两者是同一个问题的两面。

### 3 · Migration 材料

Patch 要的是 append-only migration packet：只增不改不删的迁移脚本。
如果 diff 里有 removed，或者有 `cardinality` 收紧、`nullable` 从 true 变 false
这类改动，**append-only 就写不出来**——把这件事作为事实报出来：

> `semantic-diff` 里有 1 条 removed（`con.single_reversal`，replaced_by
> `pol.single_reversal`），append-only 的迁移材料写不出这条替换，
> 只能写成新增 + 保留旧对象。

**这句话是证据，不是推荐。** 它陈述的是"append-only 能不能写出来"，
不是"所以应该选 Version"。差别很细但很重要：前者人还能反驳
（"下游没人引用那条 constraint，保留旧对象没关系"），后者他只会点头。

## 怎么问

按 `shared/decision-points.md` 的四段格式，但第四段只列后果，不列推荐：

> **在定什么**：这次发布是 Patch（minor，append-only migration）还是 Version（major，全量 bundle）？
>
> **依据**：`revisions/r0003/semantic-diff.yaml` —— 新增 1、删除 1、变更 1、未受影响 7。
> 删除的 `con.single_reversal` 有 `replaced_by: pol.single_reversal`。
> 变更的 1 条中 0 条被标 authorization_impacting。
> Scope 预览：跨 scope 引用 1 条，分类字段暴露 1 项（financial）。
> Append-only 迁移材料能不能写出这条 constraint → policy 的替换：写不出，只能写成新增加保留。
>
> **还没定的**：`chg.002` 延后给 PO1，目标版本 next；cq.001 状态 unsupported，等政策裁决。
>
> **选项与后果**：
> - `patch` —— 版本号到 1.1.0，产出 append-only migration packet；下游按增量迁移。
> - `version` —— 版本号到 2.0.0，产出全新完整 bundle；下游按新版本重新对接。
>
> 你选哪个？（这一个我不给建议——下游要不要改，只有你那边知道。）

最后那句括号里的话建议照说。它解释了为什么这里的行为和别处不一样，
否则用户会以为你没想好。

## 落到文件

`patch_version_human` 查四样：`selection` ∈ {patch, version}、`decided_by: human`、
`rationale`、`target_version`、`decided_at`。模板在 `templates/patch-or-version.yaml`。

然后记裁决：

```bash
python3 <pkg>/scripts/state.py decide <ws> --point patch_or_version \
  --verdict patch --role OO --object rel-0001 \
  --rationale "constraint 转 policy 有 replaced_by，下游可改指；本季度无窗口做全量升级"
```

`decision_logged` 反过来查：`patch-or-version.yaml` 在而日志里没有这条裁决，
就是有人先改了状态再补记录。
