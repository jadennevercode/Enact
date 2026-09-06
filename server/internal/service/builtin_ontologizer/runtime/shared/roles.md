# 角色

来自流程 §4 与 §17。组织可以改岗位名称，但人机决策边界不能改。

| 缩写 | 角色 | 在本包里负责什么 |
|---|---|---|
| DE | 领域专家 / 领域分析师 | 提供并授权证据；纠正抽取；确认事实与假设；**决定证据是否足够**；定义 Competency Question；审阅语义 |
| PO | 业务流程负责人 | 确认流程步骤、角色、事件、记录、异常与生命周期；验证 Process 层 |
| FDE | Forward-Deployed Engineer | 准备材料、解释工作流、处理集成问题；发起生成与修订 |
| OE | 本体工程师 | 审阅复杂语义设计与契约；起草 Access Scope；接手 expert handoff |
| OO | 本体负责人 | 对本体与 Access Scope 负责；**选定 candidate release**；**选择 Patch/Version** |
| GA | 平台治理审批人 | 在 PR 边界审阅预览、diff、检查结果、scope 与 package；**唯一强制批准点** |
| SYS | 本包 + validators | 生成产物、执行检查、记录运行；**不对证据充分性、语义正确性、Patch/Version 或 PR 批准负责** |

在 Claude Code 里这些角色往往是同一个人。记录里仍然要留角色——半年后回看，
"谁以什么身份拍的板"是唯一能解释这个决定的东西。

呈现决策点时说明该谁拍板；用户说"就我一个人"时照记，用 `--role` 记他当时的身份，
不要因为只有一个人就省掉这一栏。

## RACI 摘要

每项原则上只有一个最终 A。SYS 可以 R，但不能对下面四件事 A：
证据充分性、语义正确性、Patch/Version、PR 批准。

| 活动 | R | A |
|---|---|---|
| 目标与边界 | DE, PO | OO |
| 证据上传与分类 | DE, PO | OO |
| 抽取纠正 | DE | OO |
| 证据充分性 | DE | OO |
| 候选生成 | FDE, SYS | OO |
| 四层审阅 | DE, PO, OE | OO |
| 语义建模决定 | OE | OO |
| 生成修订 | FDE, SYS | OO |
| 定义/批准 CQ | DE, PO | OO |
| 起草 Access Scope | OE | OO |
| 选择 Patch/Version | OE | OO |
| 创建 Pull Request | FDE, SYS | GA |
| Expert handoff | OE | OE |
| 运行时授权 | 外部平台 | 外部平台 |
