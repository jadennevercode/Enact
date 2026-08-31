# AMD-000 — <一句话标题>

<!--
Contract Amendment：在 Build 或 QA 中发现 Contract 不完整、矛盾或与现实不符时提出。
存放位置：work-items/WI-###-slug/amendments/AMD-###.md

为什么不能在下游自己补意图：Contract 是 QA 与 Release 的唯一锚点。
实现里一旦悄悄夹带了没写进 Contract 的意图，QA 测不到它，Release 也不知道自己批准了什么。

被拒绝的 Amendment 同样保留——它是审计线索，也是 Lesson 的来源。
-->

- 提出环节：build / qa
- 提出时间：
- 基于 contract 版本：1
- 涉及条款：R1 / 1.2

## 发现了什么

具体是哪条 requirement 或 criterion 的什么问题。**附证据**：
冲突的两处说法各自在哪里、报错原文、或实际接口与 Contract 描述的差异。

## 为什么不能在实现里解决

（说明这确实是上游缺口，不是实现难题）

## 影响

不解决会发生什么：实现要么靠猜、要么做不下去、要么无法验证。

## 建议处理

- 建议改哪条、改成什么：
- 或者需要谁做什么决定：

## 处置

- 决定：accepted / rejected / deferred
- 决定人：
- 决定时间：
- 理由：
- 产生的 contract 新版本：
