# 追溯

来自流程 §14。`tools/trace/index.py` 按这份规格构建 `trace-index.yaml`。

## 追溯链

```
Source → 抽取/锚点 → Evidence Fact
                       │
Process Step/Event ────┼→ Alignment → Ontology Object
                       │                 ├→ validator 结果
Assumption/Guidance/   │                 ├→ comment / edit
Constraint ────────────┘                 ├→ revision + semantic diff
                                         ├→ Competency Question 结果
                                         └→ Access Scope + release/PR
```

流程 AC-T02 的要求是：**每个被审阅的对象都能解析到 evidence 或 assumption，以及一个 revision。**
产品还应能显示它的流程引用、检查结果和历史。这三样都在索引里。

## 十二个字段

每个对象一条记录：

| 字段 | 说明 |
|---|---|
| `object_id` | 稳定技术标识 |
| `object_kind` | entity / relationship / attribute / event / lifecycle / constraint / … |
| `object_revision` | 这条表示所在的 revision |
| `source_ids` + `source_digests` | 精确的证据快照身份 |
| `anchors` | 页/区域/行/单元格/图区定位符与原始短语 |
| `support_types` | evidence / assumption / guidance / constraint / process_reference |
| `alignment_ids` | 连接来源与目标的映射记录 |
| `confidence_or_uncertainty` | 抽取与映射的不确定性 |
| `validator_results` | 点到这个对象名字的检查结果 |
| `change_history` | created / added / changed / unchanged，以及相对哪个 parent |
| `evaluation_links` | 依赖这个对象的 Competency Question |
| `scope_membership` | Access Scope 成员身份与 release（**派生，读时计算**） |
| `orphaned` | 这条是一个已经解析不到对象的定位符（**派生，读时计算**） |

## 内在字段与派生字段

前十项由这个 revision 自己的产物决定，封存之后永远不变，存进
`revisions/rNNNN/trace-index.yaml`。

最后两项不是：**scope 成员身份属于后来的 release，orphaned 属于工作区的变更记录**。
封存的 revision 不能在它们变化时被改写，所以它们不进存档索引，
由 `trace` 在回答问题时实时算（`index.build(ws, rev, derived=True)`）。

一个把派生字段存进封存目录的索引，会在起草 Access Scope 的那一刻集体失效——
然后你要么去改封存的历史，要么关掉这条检查。两条路都不对。

## 索引是推导的

索引由脚本从产物构建，不由写对象的人填。它和产物分叉时，**是索引错了**，
重建即可：

```bash
python3 -c "from tools.trace import index; index.write('<ws>','r0002')"
```

`trace_index_current` 检查的就是重建结果与磁盘上的是否一致。这条检查存在的理由是：
一份可以手工编辑的追溯记录，等于没有追溯记录。

## 三条不变量

1. **定位符要么解析，要么明确 orphaned。** 上一版的 comment 指向一个这一版里不存在的
   对象时，那条变更请求自己要带 `status: orphaned`。标在变更记录里而不是索引里，
   是因为那是人会读的地方——索引重建一次就把标记抹平了，没人会注意到链断过。
2. **每次 revision 记录版本。** engine/skill-pack 版本、模型、输入 digest、产物 digest。
3. **删除对象不删除历史 trace。** `semantic-diff` 说明它被什么替代或为什么不再需要。

## 怎么用

问对象级的问题，用 `trace` Skill（`skills/trace/`）：

- `why <object>` —— 完整的十二字段
- `unsupported` —— 哪些对象没有证据支持
- `orphaned` —— 哪些定位符断了
- `assumptions` —— 还没解决的假设，以及它们各自影响了什么
- `impact <source|assumption>` —— 改这条证据会动到哪些对象
- `history <object>` —— 它在各 revision 之间怎么变的
