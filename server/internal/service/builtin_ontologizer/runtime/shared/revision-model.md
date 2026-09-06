# Revision 模型

来自流程 §3、§8.1、§15.1。这是本包的状态单位。

## 一次生成 = 一个 revision

`revisions/rNNNN/` 目录，封存之后只读。里面：

| 文件 | 内容 |
|---|---|
| `revision.yaml` | id、parent、reason、change_request_ids、输入 digest、pins、artifact digests、content digest、validator 结果、未解决项、status、sealed |
| `evidential_ir.yaml` `process_ir.yaml` `alignment.yaml` `candidate.yaml` | 四层 |
| `candidate.cypher` | openCypher 投影 |
| `generation-report.md` | 假设、警告、各阶段结果、版本 |
| `validation/*.json` | 每个检查一份，含 id、结果、诊断 |
| `trace-index.yaml` | 每个对象一条 12 字段追溯记录（脚本生成） |
| `semantic-diff.yaml` | 相对 parent（第一个 revision 没有） |

`revisions/HEAD` 是一个指针文件，内容是 revision id。
`revisions/runs/run-NNNN/` 存每次尝试的时间线与日志，**失败和取消的也留着**——
流程 §8.4 要求失败的 run 可以被保留、诊断、恢复或导出。

## 状态

| status | 含义 |
|---|---|
| `running` | 正在生成，尚未封存 |
| `ready_for_review` | 已封存，机器门通过 |
| `gate_failed` | 已封存，机器门未过。产物留着可诊断，但不会成为 HEAD |
| `superseded` | 有后继 revision（由 HEAD 与 parent 关系推导，不写进文件） |

**Agent 跑完不等于成功。** `revision.py seal` 自己跑 `ready_for_review` 门，
按结果写 status——不是由生成它的那一方宣布。这是流程 §3 "Deterministic success"
和 AC-G02 的落法。

## 三条不变量

**1 · 封存之后不改。** `revision_sealed_immutable` 把目录内容重新算一遍 digest
（`revision.yaml` 自身排除在外，因为一个文件不能包含自己的哈希）与记录比对。
对不上就打 `!!` 并指出是哪几个文件。

**2 · Restore 是向前复制，不是回退。**

```bash
python3 <pkg>/scripts/revision.py restore <工作区> r0002
```

把 r0002 复制成一个新的 rNNNN，parent 指向当时的 HEAD，`restored_from: r0002`，
状态回到 `running`，然后重新过门。r0002 本身一个字节都不动。

**3 · 删除不删历史。** `semantic-diff` 里每个 removed 对象要有 `replaced_by` 或
`removal_rationale`。定位符要么在新 revision 里解析得到，要么在 `trace-index` 里
标 `orphaned: true`——静默断链比 orphaned 更糟，因为没人会去找一条不知道断了的链。

## 只重跑受影响的阶段

修订时不要整包重生成。`unaffected_unchanged` 检查的就是这件事：
被 `semantic-diff` 列进 `unaffected` 的对象，在新旧 revision 中必须逐字相同。

理由不是省算力，是可读性：顺手改了不该改的地方，semantic diff 就淹没在噪声里，
人也就不再逐条看它了——而逐条看 diff 是 Patch/Version 那个决定的全部依据。

## 命令

```bash
revision.py new <ws> --reason "首次生成"        # 开目录，写 revision.yaml，冻结输入 digest
revision.py seal <ws> [r0001]                  # 建索引 → 跑门 → 写 digest → 通过则成为 HEAD
revision.py diff <ws> r0001 r0002              # 语义差异，写进 r0002/semantic-diff.yaml
revision.py head <ws> [r0003]                  # 读或写 HEAD
revision.py restore <ws> r0002                 # 向前复制
```
