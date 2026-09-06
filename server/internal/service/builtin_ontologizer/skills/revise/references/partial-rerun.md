# 只重跑受影响的阶段

`unaffected_unchanged` 检查的就是这件事：`semantic-diff.yaml` 的 `unaffected` 列表里的对象，
在新旧 revision 中必须逐字相同（比的是规范化之后的整条声明，不只是 id）。

## 为什么不整包重生成

**不是为了省算力，是为了让 diff 还能被读。**

整包重生成一次，模型会顺手改掉一堆没人要求改的东西：换一个更顺的措辞、
统一一下命名风格、补一个"看起来应该有"的属性。每一处单独看都无害，
加起来 diff 从 3 条变成 40 条。人第一次会认真看完，第二次开始翻页，第三次就不看了。

而 diff 是 `patch_or_version` 那个决定的全部依据。一份没人读的 diff，
等于把那个决定交给了一次点击。

## 阶段与依赖

生成管线的阶段顺序（`stages.yaml` 的 `pipeline_stages`）：

```
intake → process_ir → evidential_ir → alignment → candidate → gate → cypher → conformance → trace → seal
```

依赖是单向的：下游读上游。所以**受影响阶段集合是"最上游的那个受影响阶段"以下的全部**。

| 变更从哪里起 | 要重跑 | 可以逐字复制 |
|---|---|---|
| 证据纠正 | evidential_ir → alignment → candidate → cypher | process_ir |
| 流程变更 | process_ir → alignment → candidate → cypher | evidential_ir |
| 只改一句定义 / 一个基数 | candidate → cypher | process_ir、evidential_ir、alignment |
| 只改 view_label / aliases | candidate → cypher | 同上 |
| Scope 成员变动 | 都不重跑 | 全部——它改的是 `releases/`，不是 revision |

`gate`、`trace`、`seal` 每次都跑，它们不是生成阶段，是判定与索引。

## 做法

`revision.py new` 创建的新目录是空的。步骤是：

1. **先把父 revision 的全部产物逐字复制过来**（`revision.yaml` 除外，它由 `new` 写）；
2. **只重写受影响阶段对应的文件**；
3. 重生成 `candidate.cypher`（只要 candidate 变了就要重生成，否则
   `cypher_generated_and_parses` 会报标签对不上）;
4. 重建 `trace-index.yaml`；
5. `revision.py diff` 算出 `unaffected` 集合；
6. `revision.py seal` 跑门。

复制不是"参考着重写一遍"。**逐字**的意思是字节相同——
`unaffected_unchanged` 比的是规范化后的声明，一个多余的空格不会让它失败，
但一句改写过的定义会。

## 边界情况

**改了一个对象，它的邻居算不算受影响？** 看它们的声明内容有没有变。
`rel.reverses` 的基数从 1:1 改成 1:many，`ent.journal_entry` 的声明一个字都没动，
那么 `ent.journal_entry` 就是 unaffected——即使它在业务上确实被这个改动影响了。

这两种"影响"不是一回事：`unaffected_unchanged` 判的是**文本有没有变**，
`references/impact-matrix.md` 说的是**人要重新看什么**。后者是给人的清单，
前者是给机器的断言。别把它们混在一起，也别因为"业务上受影响"就去改一个不需要改的声明。

**改名怎么算？** `view_label` 变了，声明就变了，它进 `changed` 不进 `unaffected`。
但 `id` 不能变（`ids_stable_unique` 会拿父 revision 对一遍）。

**新增的对象呢？** 进 `added`，不在 `unaffected` 里，也不在比对范围内。

## 什么时候该整包重生成

只有一种情况：**输入变了**——新的 evidence snapshot，或者访谈状态更新了。
这时候 `reproducible` 会立刻报出 `revision.yaml/inputs` 的 digest 与磁盘不符。

处理方式不是就地改旧 revision，是开一个新的：输入变了就开新版本。
这种情况下 `unaffected` 可能是空的，那是诚实的结果——
声明一个不成立的 `unaffected` 集合，比声明一个空的糟得多。
