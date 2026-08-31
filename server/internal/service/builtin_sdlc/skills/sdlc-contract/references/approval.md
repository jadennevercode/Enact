# Contract Approval 呈报

**什么时候读**：确定性预检全绿、渲染完 `review/contract.html`、准备开口请求批准之前。

Gate 的通用规则（四值词表、只认显式肯定、改后重审、拿到批准前不建文件）在
`../../sdlc-core/references/gates.md`。这里只写 contract 这一次批准特有的部分。

## 为什么呈报格式值得单独规定

Gate 退化成扫一眼签字，通常**不是因为人不负责，是因为材料读不过来**。
把 contract 全文或 HTML 内容在对话里再倒一遍，"读不过来"这个问题原样还在——
所以呈报的形状是**路径 + 组织过的摘要**，不是原材料。

## 先确认要谁签

`config.yaml` 的 `gates.contract-approval.require` 说了这道 Gate 要哪几个角色（默认
业务负责人 + 架构 + 运维）。呈报时**按角色分别点名**，并说明各自该看哪几块——
块的划分来自 `role_views`，不要让人自己猜：

```
这次 Contract 需要三个角色各确认一次：
- 业务负责人（张三）：outcomes / requirements / criteria / scope —— 这次要达成什么、怎么算达成
- 架构（李四）：design / boundary / policies —— 打算怎么做、什么绝对不能动
- 运维（张三，你同时担这个角色）：release / design.nfr —— 怎么发、发坏了怎么退
```

同一个人担多个角色就明说，但**两块内容仍然分开请他确认**——合并成一句"你看行吗"
就等于没有分角色。落盘时写成一条 `approvals` 记录里的多个 `roles`。

## 模板

```
## Contract Approval — WI-### <标题>

**要决定什么**：<一句话>

**确定性预检**：<N> 项通过 / 0 项失败（coverage_stats.py --phase contract）

**关键内容**：
- 目标：<O1 一句话>
- 验收标准 <N> 条，其中 <n> 条自动验证、<m> 条人工确认（责任人：<姓名>）
- 明确排除：<最重要的 1-2 条 excluded>
- 方案：<design.approach 一句话> + <最关键的一条 decision 及被放弃的备选>
- 可动范围：<boundary.may_change 概括>；绝对不动：<最重要的 1-2 条 must_not_change>
- 发布与回退：<release.strategy>；<release.rollback 一句话，退不回去的在这里点名>
- 未决问题 <k> 个，均已处置：<D1 accepted：接受了什么风险，谁接受的，<日期> 复查>

**已知问题**：<有就列，没有就写"无">

**如果通过**：contract.yaml 冻结为 v1，WI 进入 Contracted，交给 sdlc-build 声明变更范围。
**如果不通过**：回到 <explore / 本环节>，需要补 <具体什么>。

Contract 内容确认无误吗？确认后进入 Build，之后修改需要走 Amendment。
```

摘要控制在 3-5 条。要看细节时批准人会问，或者直接打开文件。

**呈报时给路径 + 上面这份摘要，不要在对话里复述 HTML 的内容。** 把长材料在对话里再倒一遍，"读不过来"这个问题原样还在——Gate 退化成扫一眼签字，通常不是因为人不负责，是因为材料读不过来。批准人按自己的角色打开标签页读（业务负责人看 outcomes 与 criteria，运维看 release 与 nfr）；打印时会自动展开全部角色，**归档的 PDF 不该取决于打印那一刻点了哪个页签**。**角色既是视图，也是权限**——这两件事现在是同一套词表。`role_views` 决定谁看哪几块，`config.yaml` 的 `gates.contract-approval.require` 决定哪几个角色必须签。

两者必须对得上：`coverage_stats.py --phase contract` 会检查**签署角色的视图合起来盖住 contract 的每一块**。盖不住就意味着有一块内容没有任何签署人看过——那个签字签的不是它。（实测：只要 业务负责人 + 架构 时，`release` 块无人认领，回退方案就没人看过。）

HTML 是生成物：改了 contract.yaml 重新跑一次渲染即可，**不要手改 HTML**。它是按需生成的快照，不是要维护的门户（D13）——没有人维护它，也不要让它长成看板。

