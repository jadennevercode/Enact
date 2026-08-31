# 变更账本

工作区的 `metadata/change-ledger.jsonl`。记录这个项目对"标准做法"做了哪些偏离，以及为什么。
一行一条 JSON，**只能追加**，和决策日志同一个道理：一份能改写的账本，
记录的就不再是发生过的事，而是现在想让它显得发生过的事。

实现在 `shared/lib/changes.py`；写入走 `scripts/state.py record-change`。

## 为什么单独记一份

因子树最后的样子只说明结论，不说明过程：哪一行是行业包带出来的、哪一行是读了客户报告加的、
哪一行是访谈之后才删的——看最终文件是看不出来的。而下一个项目要复用的恰恰是这些过程。

它同时是知识沉淀的原料。收尾时 `retrospect` 读的就是这个文件。

**和 `shared/skill-feedback.md` 的分工**：这本账记的是这个项目对**客户的生意**做了什么判断，
那本记的是用户对**我们的做法**说了什么。前者收尾时变成知识库条目，后者变成对 Skill 的修改。

## 格式

```json
{"at":"2026-08-07T14:22:00+08:00","what":"add","target":"factor",
 "subject":"即时零售履约时效","where":"artifacts/s1/factor-tree.yaml",
 "why":"三份区域访谈都提到 30 分钟达影响 O2O 转化","source":"interview",
 "evidence":"artifacts/s1/interview/minutes-east.md","decidedBy":"张三",
 "gate":"factor-tree/amend"}
```

| 字段 | 取值 |
|---|---|
| `what` | `add` · `remove` · `merge` · `redefine` |
| `target` | `factor` · `indicator` · `definition` · `enum` · `range` |
| `source` | `knowledge` 行业先例 · `report` 客户报告 · `interview` 访谈 · `data` 数据本身 · `client` 客户口径 · `ai` AI 推荐 |
| `gate` | 哪次确认拍的板；没有对应确认的留空 |

字段的道理：

- **`why` 不能空**，写入时直接拒绝。一条没有理由的变更，一年后没人敢用也没人敢删。
- **`source` 分六类**是因为可信度不同：`knowledge` 是行业先例，`client` 是客户口径，
  两者冲突时要知道该信谁。
- **`decidedBy` 记的是人**，写入时同样不许空。AI 提的建议只有在人采纳之后才进账本——
  一条没有署名的变更，就是一个悄悄变成项目决定的 AI 提案。
- **`gate` 把变更钉在一次裁决上**，这样账本和决策日志能对得起来。

## 谁写

**编排层写**，在人拍板之后：

```bash
~/.local/bin/mmm script state record-change <工作区> \
  --what add --target factor --subject "即时零售履约时效" \
  --why "三份区域访谈都提到 30 分钟达影响 O2O 转化" \
  --source interview --evidence artifacts/s1/interview/minutes-east.md \
  --who 张三 --gate factor-tree/amend
```

产出型 Skill 负责**在呈现选择题时把每条变更的理由和出处摆出来**，
人拍板之后由编排层落账——和裁决本身走同一条路，账本与决策日志因此天然对得上。

## 阈值

上游平台对因子树定了增删幅度：L1/L2 锁定不动，L3/L4 与指标默认全量召回，
允许 10%–20% 的增删，每一项都要人确认并记录原因；超出这个幅度要升级到更高一级评审。

这个幅度本身是提醒而不是硬闸：超了通常说明行业包和这个客户对不上，那是知识库该更新的
信号，不是把变更压回去的理由。真正的硬要求是**每一条都有理由、每一条都有人拍板**。
