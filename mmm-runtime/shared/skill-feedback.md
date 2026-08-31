# Skill 反馈账本

工作区的 `metadata/skill-feedback.jsonl`。记录用户在过程中纠正了什么、他习惯什么样，
以及他期望的做法是什么。一行一条 JSON，**只能追加**。

实现在 `shared/lib/feedback.py`；写入走 `scripts/state.py record-feedback`。
唯一的读取者是收尾时的 `retrospect`。

## 和变更账本的分工

| | 变更账本 `change-ledger.jsonl` | 反馈账本 `skill-feedback.jsonl` |
|---|---|---|
| 记什么 | 这个项目对**客户的生意**做了什么判断 | 用户对**我们的做法**说了什么 |
| 例子 | 加了「即时零售履约时效」这个因子 | 「以后先给我表格再给结论」 |
| 收尾时变成 | 知识库条目 | 对 Skill 文件的修改 |

判断标准是一句话：**这条东西换个客户还成立吗？** 成立的多半是做法，进反馈账本；
只对这家客户成立的是业务判断，进变更账本。两边都不属于的（工具报错、脚本 bug），
是仓库的 issue，哪个账本都不该记。

## 格式

```json
{"at":"2026-08-11T14:22:00+08:00","skill":"scoping","step":"project-profile/clarify",
 "kind":"habit","quote":"以后先给我表格再给结论","expected":"澄清项先出表格，结论写在表格后面",
 "where":"skills/scoping/references/clarify.md","note":""}
```

| 字段 | 取值 |
|---|---|
| `skill` | 哪个 Skill 的行为被纠正。这是修的单位 |
| `kind` | `correction` 这样不对 · `habit` 我一向要这样 · `missing` 少了一步/少问了一句 · `wording` 说法不对 |
| `step` | 发生在哪一步，`<交付物>/<步骤>`；说不准就留空 |
| `where` | 你认为该改哪个文件；只是线索，收尾时会重新判断 |

字段的道理：

- **`quote` 记原话，不能空**，写入时直接拒绝。转述过的反馈过两周读回来，
  分不清哪句是用户说的、哪句是 AI 以为他说的。
- **`expected` 不能空**。「这不对」改不成任何东西，「先给表格再给结论」可以。
- **没有 `decidedBy`**，这一点和变更账本不同，是有意的：记一条反馈是观察，不是决定。
  它要不要变成对 Skill 的修改，收尾时才拍板，拍板留在签核过的复盘报告里。

## 谁写

**谁被纠正谁记**——任何 Skill 在工作中被用户纠正，当场记一条，不要攒到最后：

```bash
~/.local/bin/mmm script state record-feedback <工作区> \
  --skill scoping --kind habit \
  --quote "以后先给我表格再给结论" \
  --expected "澄清项先出表格，结论写在表格后面" \
  --step project-profile/clarify
```

这条和裁决不同，不需要等人拍板——记录一句用户说过的话不需要审批，
而等到收尾再回忆，回忆出来的就已经不是原话了。

## 谁读

收尾时 `retrospect` 读它，按 Skill 归拢：同一个 Skill 上出现两条以上相似的反馈是强候选，
单条明确的纠正也是候选。逐条问人「改 Skill / 不改」，批准的才动插件文件。
判断标准与呈现格式见 `skills/retrospect/references/optimize.md`。
