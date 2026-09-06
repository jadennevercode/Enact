# 证据充分性的决策点

`evidence_sufficiency` 是人的决策点，不是机器门。系统报事实，人下结论。

三个裁决词：`sufficient` / `proceed_with_warnings` / `insufficient`。
前两个是"关门"裁决，记下之后 `define/evidence-snapshots` 冻结，可以开始生成。

## 系统绝不自己判定这件事

流程 §19.2 明确列在"不做"清单里：不自动判断 evidence sufficiency。理由：

充分与否取决于**这个本体要回答什么问题**，以及**答错的代价由谁承担**。
同一批材料，对"帮会计判断能不能冲销"是够的，对"支撑内审出具结论"可能远远不够。
这个判断只有拍板的人做得了。

所以不要说"证据基本充分，建议继续"。这句话已经替他做了判断，而他会点同意。

## 按四段呈现

顺序照 `shared/decision-points.md`，不要重排。

### 1 · 在定什么

> 现有证据足以开始生成候选本体吗？薄弱和冲突之处你接受吗？

原话摆出来。

### 2 · 依据

产物路径 + 一份按状态计数的摘要。数字要报出处——哪一次检查、算的是哪个快照。

```
快照 es-0001 · 5 份材料 · 全部经 DE1 确认（2026-09-03）
检查项四项全过（scripts/validate.py --stage evidence）

陈述 23 条
  fact         14   全部有锚点
  assumption    4   全部有 rationale
  guidance      3
  constraint    2

抽取路径   native 3 · structured 1 · vision 1
不确定度   low 3 · high 1（ev.003 流程图，二手转述，制作人不详）
高风险条目 6 条，全部已由人过目
```

### 3 · 还没定的

**这一段是决策点的真正内容。** 每条单列，写清后果，不要合并成一句"存在若干未决项"。

```
未决 1 · ud.001 软关账期间能否冲销（owner OO1）
  手册 §6.3 说经批准可以，政策 §3.2 说一律不可。两条都在 FAGC 里，都标 disputed。
  不裁决的后果：lc.journal_entry 的 posted → reversed 转换 guard 只能挂假设，
  cq.006「软关账期间提交的冲销申请按哪条规则处理」答不出来。

未决 2 · ud.002 50,000 阈值含税与币种（owner DE1）
  政策 §3.3 自己写明未定义。样本 JE-2026-0110 正好卡在 50,000 且含税，
  两种口径下审批人不同。
  不裁决的后果：attr.journal_entry.amount 的口径挂 asm.001，
  cq.002「这条分录的冲销该由谁审批」在边界金额与跨币种上算不准。

缺口 3 · 「复核」环节无依据
  流程图右下角孤立方框，政策 §3.4 提到复核是三职之一，但没有任何材料
  说明它在冲销流程里做什么、什么时候做。
  后果：cq.005「一条分录从制单到冲销经历了哪些状态和谁的动作」会缺一环。
```

### 4 · 选项与后果

```
sufficient
  证据完整，未决项不影响建模。
  冻结快照，进入生成。以后改材料要显式重开。
  —— 现在有 2 条未决 + 1 处缺口，这个选项与事实不符。

proceed_with_warnings
  接受带着这些未决项开始生成。
  未决项作为 assumption 进入 candidate，相关对象挂 assumption 型 support，
  在审阅时会被逐条摆出来。快照同样冻结。

insufficient
  停在 Define。要补的是：找政策部与 FSSC 就 ud.001 出一个口径，
  或调授权表确认阈值口径，或补一份说明复核环节的材料。
```

**有未决项时不要把 `sufficient` 作为默认推荐。** 这里正确的推荐是
`proceed_with_warnings` 或 `insufficient`，取决于这两条未决项会不会让
第一版生成白做。

## proceed_with_warnings 不是妥协

它是一个正当选择，`decision-points.yaml` 把它列为 closing 裁决。

用它的场景：未决项影响的是**局部**，先建出来能让人看见形状，反而更容易推动裁决。
软关账这一条正是——把两条冲突都摆进模型、把 guard 写成带问号的假设，
拿着这版去找政策部，比空口讨论有效得多。

不该用它的场景：未决项影响的是**核心对象的身份或粒度**。那种情况下建出来的东西
整体要推翻，警告会淹没一切。

## 怎么落

```bash
python3 <pkg>/scripts/state.py decide <工作区> \
  --point evidence_sufficiency --verdict proceed_with_warnings --role DE \
  --rationale "ud.001 软关账口径与 ud.002 阈值口径未裁决，接受带 warning 继续"
```

`--rationale` 写具体是哪几条未决，不要写"暂时可以"。半年后有人问
"当初为什么带着这个洞就开始建"，理由那一栏是唯一的答案。

裁决之后 `define/evidence-snapshots` 冻结。要改材料就再记一条裁决说明为什么重开，
然后往前重跑——不是回去改那一行。
