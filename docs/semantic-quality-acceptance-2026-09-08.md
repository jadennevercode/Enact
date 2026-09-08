# Quality Traceability 本机验收记录

验收日期：2026-09-08。工作区：`Quality Ontology Lab`（`quality-ontology-lab`）。本记录区分实际运行、测试 fixture 与尚未完成的步骤，不保存连接凭据。

## 中文本体生产

- 构建 Issue：`QOL-6`，`01a081e4-89fe-7d45-aaa7-fc81eb081b57`。
- Analyst / Engineer / Reviewer / Steward 子 Issue：`QOL-7` / `QOL-8` / `QOL-9` / `QOL-10`。
- 原生本体：`d07e2152-7a74-4cfe-b380-2f2b45ce956e`。
- 治理修订后的候选 digest：`sha256:be934aff379112f72ce54d524c299d975aaeaa7b9137bab7a778b05becd91db5`。
- 独立评审基线：`sha256:56fa2687109a26e3546b9772becbb9db8aa4e24acdb4f2725ef20cfd4a56c79a`。Reviewer 和 Steward 实际复验通过测试，同时发现治理未决信息未进入冻结工件，要求发布前修订。
- 来源快照：`bf72ec6b-5af3-415c-bfda-461def39489b`，Git commit `2b0c1432252abf485f8aac48295f7eeef759ddaa`，`knowledge-base/docs/en` 共 77 个文档。
- 候选包含 13 个类、20 个属性、30 个来源概念及 28 条来源概念关系。`SourceConcept` 与业务实例分开；这些概念不能作为真实工厂、库存或案件记录。
- 两次成功的实际 Runtime 模型操作提供原始实体/关系抽取，候选复用了持久结果；复核歧义后没有重复调用模型。其余类和概念来自有来源锚点的建模及 Agent 复核，不代表用户已经批准。
- 抽取覆盖不是整个知识库：原始 Runtime 抽取处理了 174 个 chunk 中的 1 个，最终候选引用 4 个文档；`extraction_coverage.complete` 未声明为 true。

## 原生验证

- SHACL：13/13 个目标均有实例，42 个验证实例有效。其中 30 个为来源概念，12 个为独立业务测试 fixture。
- 4/4 个能力问题通过。它们检验本体语义结构，不能代替业务系统的实际数据查询。
- 缺失 supplier、重复 supplier、错误 caseVersion 类型三个负例均被拒绝。
- 实际 SPARQL 检查确认版本属性使用 `xsd:integer`、完整范围使用 `xsd:boolean`，字符串属性使用 `xsd:string`，OWL 与 SHACL 类型一致。
- 原生规则测试涵盖正例、非高严重度、范围不完整、未受影响工厂、跨案件隔离、第二材料/第二批次和空批次数组。跨案件 fixture 保留各次独立查询观察及明确的测试证据 ID；它不创建运行步骤或真实行动授权。
- 独立 Reviewer、Steward 的最终结论以各自 Issue 内对应 digest 的评审为准。
- 治理修订独立差异检查：绑定、知识 Turtle、来源清单、抽取覆盖及 CQ 完全相同；规则仅新增治理元数据，条件、结论和行动参数未改；知识图谱仅更新时间。SHACL 的 135 条三元组只替换了 `ApprovalShape` 的描述，未改约束。
- `native_ontology.governance`、规则元数据和 Approval 描述均保存 GAP-006 未决状态及 DRAFT 边界。治理锚点为 `process-landscape.md` 的 `[6173:6284]`，原文、哈希和 commit 已核验；这不是用户批准记录。

## 实际发布

- 版本 `0.1.0`，release：`7a6d37a1-e96c-42c0-af1d-e880bd3f3f5d`，发布时间 `2026-09-08T20:11:14Z`。
- Release digest：`sha256:a30cd05d07f77c17ecbc94d1e6796e7cc0e20e74495f7964db36faf22ee762e2`。
- 发布工件 digest：`sha256:b27e1ee6ac3ccfd6b00eaa7b6f965922a37c80fedaf8bc892b2df88f5cc5771f`。其 `reviewed_artifact_digest` 保留上述 `be934a…db5` 候选，发布时只重新绑定 release 范围。
- Reviewer 最终事件 `f7d00baa-322c-4c95-8b12-ed1b394c761d`、Steward 最终事件 `c5624947-62cf-4d88-bbb5-e4d4f1e1f0bd` 均无发布阻塞。
- 按用户已授权的本地端到端实施请求完成发布；未记录用户亲自阅读或批准 GAP-006。发布事务写入实际发布记录及 Construction 的 completed 状态。
- QOL-6/7/8/9/10 均已交付完成，中文总交付评论：`01a082a7-99eb-79e5-8d47-34b4713c097b`。

## 真实连接

| 类型 | 已发现和读取的内容 |
| --- | --- |
| Git 知识 | 77 个文档、commit 与不可变快照；使用已授权且 commit 一致的本地只读镜像 |
| PostgreSQL 数据 | 3 张表；resources 的 7 个字段、主键和 2 个外键；真实参考库只读预览 |
| OpenAPI 数据与行动 | 43 个操作及类型化参数、响应、调用方式 |
| MCP 数据与行动 | 4 个工具，查询和创建草案共享参考系统的实际业务函数 |

当前候选保存 15 个数据绑定和 17 个行动绑定。连接来自工作区目录，用户凭据仅保存在加密连接配置中。生产 ERP/MES、私有远程 Git OAuth、额外数据库 reader 授权不属于本次已部署范围。

## 消费和 Site 验收

消费 Issue：`QOL-12`，`01a08258-60ca-7012-840b-d9540512aa57`。目标是在同一运行中查询 `SQC-2026-0187`、批次 `88213`，根据真实跨厂库存生成原生规则证明，创建并读回 AT01 的 DRAFT 遏制计划，再由 Site 恢复同一次调查。

- 实际 run：`5cfce51b-c803-4137-9772-756505f4c518`，绑定上述 release 和原 QOL-12。
- 初始 Agent task：`01a082a6-9a2a-7d79-b784-eee91423925e`。本体查询返回 18 行；5 次 REST 查询、1 次 PostgreSQL 查询和 1 次 MCP 查询均成功。
- Native evaluation：`912ca765-630f-4b1a-a975-207d570f4293`，使用 `semantica.reasoning.Reasoner`，3 个推导及 3 个 `plan.create` 建议，没有 unsupported 或迭代溢出。
- 主评估仅引用 REST case、exposure、3 个 stock 查询步骤；PG/MCP 补充查询没有混入 Site 的主证明。
- 唯一准备并确认的行动：approval `b48598af-f27d-41e6-89eb-c59864d8a861`，AT01 / `STOCK-AT01-88213`，目标版本 1。协调端依据本次实施授权确认参考系统 DRAFT 创建，确认理由明确不批准正式业务审批或冻结。
- 后续实际 Agent task `01a082ad-6462-71cf-a548-533aeba214a4` 沿用原 run 执行，没有创建第二次调查。
- Receipt `1bd4b650-ff46-44e8-8646-8368d4165b53` 于 `2026-09-08T20:21:26Z` 成功。POST 响应与独立 GET 读回均为 `CONTAINMENTPLAN-453b2f06bc0f42e0`、`DRAFT`。
- 计划内唯一行动 `PLANTACTION-c95d5f45671540da` 仍为 `PROPOSED`，`operationIds=[]`。本次没有执行库存冻结、停线或正式审批。
- Site 应用：`8fc38058-4c8a-4ff8-8511-cec166af8d04`。首次打开真实发布构建即恢复原 run 和既有 3 条推导；没有通过点击“复核”另造证明。实际拓扑含 15 个对象，库存按厂分别为 366/120/80；交付数量 80 单独统计。

Site 的最终构建摘要与移动端、回执展示验收在最终界面确认后补充。以上 Issue 执行证据均来自当前真实本机参考系统，未用隔离测试结果替代。

## 业务与复用边界

GAP-006 的跨厂审批负责人仍未获得业务确认。原生规则只建议创建 DRAFT 计划，不授权库存冻结、停线或案例关闭。AT01/Graz 有来源依据；CN03/MX01 不推测城市或地理坐标。

Studio 复用了 Semantica Explorer 的图交互和布局代码，消费使用原生 RDF 查询、规则与来源证据。Python Plotly 仪表盘、Agno 团队、反事实分析和独立时间查询尚未接入 Enact 用户入口。详细复用范围见 [集成说明](semantic-integration.md)。
