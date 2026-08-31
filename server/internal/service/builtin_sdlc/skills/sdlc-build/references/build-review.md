# Build Review：进 QA 之前的那一次人工审查

**什么时候读**：自检全绿、准备把状态切到 `Verifying` 之前。

Gate 的通用规则（四值词表、只认显式肯定、改后重审、拿到批准前不建文件）在
`../../sdlc-core/references/gates.md`，那一份是权威。这里只写 build 环节特有的部分：
**呈报什么、怎么判、批完做什么。**

## 1. 它批的是方向，不是正确性

这个 Gate 为什么存在、批准人该回答哪三个问题，`gates.md` 的 build-review 一节写了，不在这里重复。

只补一句执行层面的：**别在这里预演 QA。** 你没法在 QA 之前证明实现是对的，
硬要证明只会把 build-review 变成一次简陋的 QA——方向没批扎实，正确性也没验干净，两边都做不好。

## 2. 呈报格式

```
## Build Review — WI-### <标题>

**做法**：一句话说清实现路径

**改动**：<N> 个文件，+<X> −<Y> 行
| 文件 | 对应 criterion | 一句话说明 |
|---|---|---|

**自检**：
- check_scope.py：无 violations
- coverage_stats.py --phase build：无 failures，<N>/<N> 条 criteria 有映射
- lint / unit / build：结果原样贴一行

**我自己不确定的**：build-evidence 第 5 节点名的风险，原样搬过来，不要重新措辞成更好听的

**未执行事项**：contract 里有但本次没做的；没有就写"无"

实现已完成，自检全绿。做法是 <一句话>，改了 <N> 个文件。请看一下方向对不对——通过就进 QA。
```

最后一句是**固定话术**，不要改写成"你看行不行"。

### 不要做的三件事

- **不要把 diff 倒进对话。** 批准人要的是组织过的判断材料，不是原材料。要看细节他会打开文件。
- **不要美化第 4 节。** 掩盖不确定性能让这次 review 更快通过，代价是把问题推到更贵的阶段暴露。
  这一节的价值与诚实度成正比，写"无"之前先问自己：真的没有，还是不想写。
- **不要顺手请示别的事。** 这个 Gate 只批方向。范围要扩大走 scope-expansion，
  contract 有缺口走 Amendment——夹在一次呈报里，两件事都得不到干净的决定。

## 3. 结论怎么落

| 责任人说 | 落盘 | 接下来 |
|---|---|---|
| 通过 | `gate: PASS` | 状态 → `Verifying`，交 QA |
| 通过但有保留 | `gate: CONCERNS` + `top_issues` 每条带 `suggested_owner` | 照样进 QA，问题跟着走 |
| 方向要改 | `gate: FAIL`，`reentry_conditions` 留空 | 回来改，改完重新呈报 |
| 这个做法不该用 | `gate: FAIL` + `reentry_conditions` 写明什么条件下可以再提 | 通常要回 contract 谈设计 |

**`CONCERNS` 不是"差不多能过"的委婉说法**：它的意思是这些问题我看见了、我接受、
并且我知道它们由谁负责。写不出 owner 的问题不算 CONCERNS，那是 FAIL。

落盘动作：

```bash
cp "$CORE/templates/gate.yml" .sdlc/work-items/WI-###-slug/gates/build-review.yml
# 填 scope: build-review；approved_by 只能在真实确认之后填；
# PASS / CONCERNS 还要填 merged_revision（本次评审的是哪个版本），否则校验不过
python3 "$CORE/scripts/validate_gate.py" --root . --work-item WI-### --gate build-review
```

再向 `evidence.jsonl` 追加一条 `action: gate_decided`，`input_refs` 指向这个 gate 文件。

**拿到批准之前不要创建这个文件。** 一个 `approved_by: ""` 的空壳会被下游当成一次
已经发生的决定——被统计、被 release 预检读取、被审计当作证据。等待批准的表示方式
是这个文件还不存在。

## 4. quick lane

呈报压到三行：**改了哪些文件、做法一句话、风险有没有。** 就这三行，不要因为 lane 小就省掉第三行。

Gate 文件照样要有、`approved_by` 照样要具名，以及降级为什么必须签名——见 `gates.md` 的
「权重随 lane 变，但不跳过」一节，那里有 `config.yaml` 的确切写法。
