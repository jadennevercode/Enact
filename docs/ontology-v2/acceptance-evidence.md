# Ontology v2 验收记录

记录日期：2026-09-09 至 2026-09-10。功能规格见 [总 SPEC](README.md)。这份记录区分代码测试、运行服务验证和业务审阅；未完成项目不会由测试数量代替。

## 当前运行

Enact 前端为 `http://127.0.0.1:3000`，后端为本机 8080。原生 Semantica 服务使用本轮实现。截至 2026-09-10 01:28 UTC，当前后端镜像为 `9a6c7fe50077b7b4c8ab38108ce2513a783ae9e9825adca4b787d1c6d4a06b43`，二进制 SHA-256 为 `d682d29feb6578ebc18b6ba5d19ac036617ab2b95c8d6d187953355d257994c8`；Semantica 镜像保持为 `f8ae90272889eff7efdd5ebbadf0fb81a976ecec92254a1ea13964cc1b5f780a`。8080 健康检查、Semantica 容器健康检查及 backend 到 semantic 的认证只读请求均通过。数据库迁移 529–531 已应用并核实采用记录表、并发幂等索引和 release `test_data` 列。当前后端嵌入 scoped authoring query 修复、受限 HTML/JSONL 报告读取、`review <run_id> <approval_id>` 窄读和已知 409 的静态 `[action_evidence_stale]` 恢复诊断；未知 409 正文仍不透传。目标 operating overlay 已同步连续刷新、窄读和失败回执后由成员明确创建新尝试的规则；最后一条相同 builtin Skill 文案已写入源码但晚于 `9a6…` 构建，当前运行由目标 overlay 即时提供，须在下次必要后端构建时嵌入。后端重启曾漏带 semantic Compose overlay 并造成三次历史 `native_service_unavailable`；恢复包装配置后路由恢复，本次受控 `/v1/native/adopt` 的真实安装预览与目标验证均返回 200。部署证据见 [native adopt 部署记录](/private/tmp/enact-native-integration/native-adopt-fixture-deploy.log) 和 [行动冲突 helper 部署记录](/private/tmp/enact-native-integration/action-conflict-helper-deploy.log)。下文旧镜像哈希和阶段描述都是相应验收时点的历史快照。

质量追溯来源的创建与发布已经完成：受托成员批准 operations 审阅包 `a33ddcde…`（决定 `4b8b022b…`）和 release 审阅包 `eda4ad1b…`（决定 `5fcdee2b…`），随后由真实成员发布本体 `5af3daaf-bcb9-45d6-85a7-85fe3d9d546a` 的 `1.0.0`。不可变 release 为 `5369e80c-d2fd-492d-b7cd-504517e0f59f`，digest 为 `sha256:50baf4dc30dbf355df531a91df2f40dc32860c6e48f295fcb10bb0480169aaaa`，创建于 2026-09-09 21:53:39 UTC；发布验证 `valid=true`、`conforms=true`，纯合成实例覆盖 23/23 个目标。构建 `c2a50a09-08a4-48ad-ad17-6a7fdcfd441c` 的服务端状态为 `completed`；最终 coordinator 于 21:55:57 UTC 完成，QOL-13 随后以 `expected_revision=35` 更新为 `done`（revision 36）。本体中的行动当前为 14 个草稿、1 个启用。可读入口：[来源 Studio](http://127.0.0.1:3000/quality-ontology-lab/agents?tab=ontologies&ontology=5af3daaf-bcb9-45d6-85a7-85fe3d9d546a)、[QOL-13 Issue](http://127.0.0.1:3000/quality-ontology-lab/issues/01a0869f-6336-7da9-85af-961c177b1326)。证据：[release JSON](/private/tmp/enact-native-integration/source-release-1.0.0.json)、[completed construction](/private/tmp/enact-native-integration/source-published-construction.json)、[QOL-13 完成回执](/private/tmp/enact-native-integration/source-issue-complete-result.json)、[Studio 标签 QA](/private/tmp/enact-native-integration/source-studio-action-labels-qa/evidence.json)。

用户随后明确授权在 `quality-traceablity` 中安装消费内容并跑通 Case，覆盖目标 OpenAPI/MCP 开发凭据绑定及这 23 个纯合成验证 fixture 的跨空间复制。受控预览固定来源 release digest、目标连接映射、目标目录和 fixture digest；确认安装创建目标本体 `da7662ad-b4bf-4577-99e4-9648dcaafe86` 及 release `c342b24f-1a76-4fc9-895c-0b90ff12a2f1`，目标 digest 为 `sha256:caab39cc3d3c4ad525879aa7d1a9523e0d176ff5f73fc7bb54c0166bb323ba9b`。重新采用后的 native scope 与持久 release 一致，绑定只使用目标连接，来源业务定义和 native rules 未变，合成 fixture 精确保留；目标验证 `valid=true`、`conforms=true`，覆盖 23/23。目标“质量追溯小队”由分析师 leader 和调查员 `acb1983c…` 组成，同一 QUAL-6 / run `871925db…` 已保存计划、真实目标连接查询、Policy/Action Review、可读 HTML/JSONL 报告及 trace。应用 `43a0c127-0e5c-492a-b618-808e073537b5` 已发布 build `af6e81f6-73d0-4622-9e66-a78ad9a159e9`（digest `e868d5f4…`）；默认入口恢复同一 run，`context → run.attach → run.get → query → run.trace` 均为 200，业务报告可见且页面无错误。最终 Evidence 新审阅 `18247378-ec4c-47ab-a490-c86669d44ebf` 已由成员批准并由同一受托调查员执行；receipt `c33dc3e3-8a84-4fb3-bc48-0bbe5aff0a4f` 为 `succeeded`，独立绑定回读得到不可变证据 `EVIDENCE-50c4f4e0ca7a47cc`，完整正文与已审参数及 SHA-256 `44e64018…` 精确一致。案例由 0 条变为恰好 1 条证据，原有 2 份方案、2 项拟议措施均未改变，operations 仍为 0；旧失败 receipt 被保留。调查员随后只同步 durable report/workbench，未重查或重做 Action；2026-09-10 02:09:46 UTC 的评论 `01a08914-0705-7590-a17c-1ee72ef8edc1` 附带 HTML `01a08914-06ea-7c75-a627-203e4796a65f`（1,229,369 bytes）和 JSONL `01a08914-06fd-7580-8390-04932ddc7818`（640,577 bytes），独立 GET 已核实。最终 Site QA 在同一 app/build/run 上显示唯一 Evidence、当前成功回执及最新成功报告，旧失败仍作为历史且不遮蔽当前结果；13 次受限调用均成功，禁止操作为 0，桌面及 390px 无横向溢出。成员最终将 Enact 交付任务 QUAL-6 更新为 `done`（revision 48）。至此，本次 reference Case 的创建、发布、受控安装、消费调查、人审、Evidence 执行与独立回读、报告及 Site 展示闭环完成；来源业务案例 `SQC-2026-0187` 仍为 `UNDER_TRIAGE`，本记录不宣称质量问题已经关闭。证据：[授权范围](/private/tmp/enact-native-integration/authorized-published-fixture-proof.json)、[目标连接认证](/private/tmp/enact-native-integration/quality-target-connection-auth-result.json)、[安装预览](/private/tmp/enact-native-integration/target-install-preview-result.json)、[安装回执](/private/tmp/enact-native-integration/target-install-result.json)、[目标只读核验](/private/tmp/enact-native-integration/target-installed-readback-proof.json)、[Evidence 成功回读](/private/tmp/enact-native-integration/target-evidence-success-readback-proof.json)、[当前成功报告](/private/tmp/enact-native-integration/target-consumer-evidence/report.json)、[最终报告评论及附件回读](/private/tmp/enact-native-integration/target-final-report-comment-readback.json)、[最终 Site QA](/private/tmp/enact-native-integration/target-site-final-evidence-qa/evidence.json)、[QUAL-6 完成回执](/private/tmp/enact-native-integration/target-consumer-acceptance-result.json)。

参考来源 API 的 `EvidenceCreate.content` 已改为保留成员审阅原文的首尾空白，避免序列化层删掉结尾换行而造成 `EVIDENCE_HASH_MISMATCH`；内容 hash 校验本身没有放宽，OpenAPI canonical 内容未变。两项隔离 SQLite 定向测试通过，18180 健康检查为 200；部署后的只读核验确认当前仍是 reference/dev 环境、调用者只看见 AT01/CN03/MX01，案例 `SQC-2026-0187` 在修复时仍有 0 条证据且未产生业务写入。该修复只保证已审原文字节与 hash 一致，不把参考数据称为生产事实，也不补出 VIN、车辆谱系、不可见工厂或跨工厂批准权。证据见 [来源 Evidence 原文保真部署](/private/tmp/enact-native-integration/quality-reference-evidence-whitespace-deploy.json)。

本体名称为“质量追溯”，构建任务为 **QOL-13 / 制作质量追溯本体**。正文只有“请基于连接的质量追溯知识和绑定的数据系统帮我制作本体”。用户已明确委托本次实施助手代其与 Agent Family 交互；决定通过成员接口保存，理由记录委托。Family 的任务身份仍不能批准自己的提案。这次运行不替代未来真实用户的可用性测试。

## 已取得的证据

| 范围 | 证据 | 边界 |
| --- | --- | --- |
| Semantica 原生服务 | 既有完整套件为 80 项测试、90 个子测试通过；本次受控 adopt 与普通 rebind 不放宽的定向集 5 项通过 | 真实 preview 已证明 adopt 与验证路由可用；不代表任意来源或生产数据都适合跨空间采用 |
| Enact 本体后端 | 当前隔离 PostgreSQL 选择集为 78 个顶层测试通过、1 个 Native E2E 按命令明确跳过；fixture transfer/adopt 安装定向测试 12 个通过，409 静态诊断与窄读 helper 定向测试 2 个通过，既有 scoped helper 测试、handler vet、workspace 删除清单和 migration lint 通过 | 真实 Evidence 执行、独立回读、最终报告附件与 Site 刷新均已验收；跳过项不由此变成通过 |
| 发布版受控采用 | 迁移 529–531 已上线；服务端实现来源成员可读、目标真人 owner/admin、来源发布治理链、精确连接映射、目标目录重发现、独立采用理由、预览 digest、事务写入及并发幂等守卫；实际目标安装及只读回查通过 | 只在成员显式 `include_test_data=true` 且给出精确 fixture digest 时复制已冻结的纯合成 fixture；目标重新采用、scope 校验和 23/23 验证均未绕过 |
| Native 路由与受控采用 | 20:45 UTC 的三次历史失败均未抵达 semantic；恢复 overlay 后认证 `/v1/connectors` 返回 200。本次 `/v1/native/adopt` 先校验来源 artifact/scope，只允许目标执行 pin 变化，再生成目标 scope/digest；真实 preview 的 adopt 与 `/v1/validate` 均返回 200 | 普通 compile/rebind 仍拒绝跨 scope；采用入口不接受调用者替换业务定义或治理产物 |
| Native HTTP + Enact DB | 原生编译、业务定义、上下文、Policy 与动作集成测试通过；真实成员审批后的 `CreateEvidence` 由受托 Agent 执行，durable receipt 与独立数据绑定回读一致 | 只证明追加这一份调查证据；没有冻结库存、停线、创建方案或其他 operation |
| 草稿 Policy 解释器 | 7 个有明确预期的中文合成用例全部符合预期；结果由服务端调用真实 Semantica `native/policies` 并持久保存 | 合成输入不是真实连接数据，不产生行动意图、审批、回执或业务执行证据 |
| 人审完整性 | 已批准四关后，仅修改人回答和对象卡、保持技术产物不变：模型及下游审批失效，发布被阻止 | 无关行动变化保持模型批准有效；普通交接事件不会取消等待审阅状态 |
| 前端与应用桥 | 完整 views 类型检查、定向 lint 与应用测试通过；当前前端镜像 `e1d87cdbc2d3ef71c90b7857f8e05095194698fb69caa15739a0e1f56cfcb5b2` 返回 200。目标 Site build `af6e81f6…` 已发布；最终桌面/390px QA 在同一 app/build/run 上显示唯一 Evidence、成功回执和最新报告 | Site 刷新没有产生业务写入；草稿交接本身也没有自动发送评论或执行行动 |
| 当前与历史 Site | 当前目标 Site 固定目标 release `c342b24f…`，默认入口恢复 QUAL-6 的同一 run；13 次受限调用均成功，禁止操作为 0，旧失败历史与当前成功清楚区分 | 旧 `0.1.0` 调查、旧 build 或过时报告只保留为历史，不能替代当前最终行动回执与独立回读 |
| 实际范围交互 | 小队读取 77 份 Git 文档，提出 3 个问题；成员回答及卡片决定持久保存；scope、model、operations、release 四关均完成，operations 决定为 `4b8b022b…`，release 决定为 `5fcdee2b…`；用户另行明确授权目标凭据绑定及 23 个纯合成 fixture 的安装复制 | 来源 `1.0.0` 已发布、目标安装且本次 reference Case 消费闭环完成；授权和结论只覆盖本次明确范围 |
| 执行结果时间契约 | 参考 API 已更新；22 条业务资源快照前后相同；REST 实际重发现 43 个条目，包含可空 `verifiedAt`；隔离测试 39 通过、1 跳过；本次 Evidence append 已完成真实执行、成功回执及绑定回读 | 其他写行动、失败分支及更广时间语义仍未以生产数据完成验收 |
| 全球规模 Site | 独立合成示例覆盖 10 国、50 厂、100 供应商、500 批次、10 万 VIN、20 万装配关系；390px 与桌面交互检查通过 | 合成数据在界面标示，不能混入连接系统调查 |

实际范围已确认：保留车辆及已售车辆的追溯目标，缺少 VIN 和谱系数据就显示缺口；生产批次与检验批分开，跨系统身份只按明确映射连接；跨工厂可以分析影响和提出建议，最终处置批准权继续未知。客户交付数量不能当作车辆清单。

## 尚未完成的验收

- 本次 reference Case 的创建到消费交付闭环已经完成；来源业务案例 `SQC-2026-0187` 仍为 `UNDER_TRIAGE`。没有启动库存冻结、停线、外部通知或其他处置，也没有证明质量问题已经关闭；跨工厂最终处置批准权仍未知。
- 当前来源本体只有 1 个启用行动；其余 14 个草稿行动未在本次运行中开放或验收。23 个纯合成 fixture 只证明 schema 覆盖，真实查询证据来自目标 reference/dev 连接，两者继续分开标示。
- reference/dev 数据只覆盖当前可见 AT01/CN03/MX01；VIN、单车谱系、不可见工厂、真实生产规模和跨工厂批准事实仍缺失，不能据此作生产结论。
- 尚未完成固定 4 vCPU / 8 GB、记录浏览器及网络、预热后 100 次的正式性能验收。现有百万关系本地诊断不是端到端 SLO 证明。
- 仍需企业真实凭据的 Snowflake、SAP 等连接器现场验证；向量检索和完整双时态界面未启用。

## 验证记录位置

本任务临时证据在 `/private/tmp/enact-native-integration/`，包括 `native-final-tests.log`、`tests-final-native-diagnostics.log`、`scope-review-packets.json`、`scope-approval-result.json`。这些是本机运行记录，重启或清理临时目录后可能不可用；不要将其当长期审计存储。真正的回答、批准、版本及执行记录保存在 Enact 服务中。

## 实际 Site 最终浏览器复验

前端 `9722cbf52d99`、后端 `0539ff78c84f`，2026-09-09 最终复验使用 Chromium、`--no-proxy-server`、原生登录及 CSRF cookie（凭据仅保存在内存），没有 API 数据拦截或模拟数据。选择保存构建 `96a34d6d-ef46-40de-bc08-8c3f6e3a61e6` 的预览，沿用调查 `5cfce51b-c803-4137-9772-756505f4c518`，未发布、未批准或执行业务行动。

- 最新构建通过 `context → run.attach → run.get → query → run.trace`；真实绑定包括 `bind.qt.context`、`bind.qt.cases`、`bind.qt.case`、`bind.qt.exposure`，均返回 HTTP 200。选中 CN03 后拓扑联动为 5 个邻域对象；业务刷新再次完成 case/exposure 查询及 run.get/run.trace，验证同一 iframe 通道在页面重渲染后仍可用。
- 显示 3 家工厂、库存 566、交付 80；完整关系投影为 15 对象 / 14 关系。调查问题 textarea 的实际值与服务器 question 一致。390px 宿主 scrollWidth=390、内部 iframe 宽及 scrollWidth=340，无页面横向溢出。
- 此构建兼容既有 0.1.0 调查的读取流程；发布暂缓，先压缩首屏标题、案例和摘要，让地图与拓扑更早出现。这不等于新五要素旅程验收完成。3 家工厂缺少经验证坐标，地图明确标记待补；旧发布物未给出 v2 可读政策声明，界面明确缺口而不假设允许执行。少数旧对象状态仍显示原枚举，历史证据列表较长，后续可继续改进阅读体验。
- 宿主后台 `GET /api/semantic/runs` 仍有间歇连接 reset/empty，已单独记录，不能归因于 iframe 桥；本次受控 Site invoke 初始化及刷新通过。直连同一 8080 后端读取确认，旧调查 release/Issue 不变，application_id/application_build_id 仍为 null；既有发布指针仍为 `ecf86414-61b8-4e29-9d53-3d0f0c7151e1`。

证据均在本机临时目录：

- 桌面选中工厂与政策：`/private/tmp/enact-ui-qa/final-site-selected-factory.png`，同名 `.json` 包含真实问题字段与调用摘要。
- 桌面世界地图：`/private/tmp/enact-ui-qa/final-site-worldmap-desktop.png`；390px 地图详情：`/private/tmp/enact-ui-qa/final-site-mobile-map-detail.png`，各有同名 `.json`。
- 刷新后通道与实际查询：`/private/tmp/enact-ui-qa/final-site-after-refresh-desktop.json`。
- 旧调查与发布指针未变：`/private/tmp/enact-ui-qa/final-site-preservation.json`。

### 紧凑首屏候选复验

保存构建 `8a16fd58-bdc5-4722-811c-d442ca6ab4b1`（digest `8e400fe94e829d49d45cb0a4115abfaf95ee6b99e6c3f92461912837916e8499`）已沿用同一旧 app/run 完成只读复验：桌面不滚动即可看到调查问题、影响摘要和拓扑主体；390px 首屏显示摘要、工厂卡和对象入口，无页面横向溢出。CN03 节点与政策页联动正常；刷新后实际 case/exposure 查询、run.get、run.trace 均为 HTTP 200。该候选通过本轮首屏及兼容读取检查，发布由主任务另行决定；本轮没有批准或执行业务行动。

本轮截图与同名 JSON：`/private/tmp/enact-ui-qa/compact-site-first-screen-desktop.png`、`compact-site-first-screen-mobile.png`、`compact-site-map-visible-mobile.png`、`compact-site-after-refresh-desktop.json`。

同一浏览器还检查了真实草稿 `5af3daaf-bcb9-45d6-85a7-85fe3d9d546a`：Studio 正确显示 20 个主体、40 条关系、行动 0 / 政策 0，并以中文业务含义展示所属属性和未绑定状态。此次未使用响应样例；模型还在构建中，不将其视为已审阅或已发布。首次导航曾遇静态 chunk 网络加载失败，重新加载后进入真实模型；截图 `real-studio-model-settled-desktop.png` 和 `real-studio-entity-cards-desktop.png` 位于同一目录。

## 已发布的 Site 更新

紧凑首屏构建 `8a16fd58-bdc5-4722-811c-d442ca6ab4b1` 已在实际旧调查完成桌面/390px 只读复验后发布。地图与拓扑上移；无可信坐标时默认拓扑。当前发布仍关联既有 0.1.0，不能据此宣称新本体的生产到消费流程完成。发布回执在 `publish-site-compact-result.json`。

模型审阅的实际修改请求：保留已确认质量问题的完整生命周期；区分生产线、围堵方案及方案项；改进属性的业务说明。决定保存并自动恢复协调者，尚未批准模型或发布。

## 磁盘故障恢复与新增待验项

2026-09-09 16:31 UTC 左右主机磁盘写满，Docker 虚拟磁盘出现 I/O 错误并转只读，导致 API 返回误导性的 `invalid token`。清理可再生 webpack/Go 编译缓存后恢复约 26 GiB 空间，正常重启现有 Docker 环境；原 token 随即恢复 API 200，数据库、原生服务健康。未重置卷、账号或业务数据。

修订任务的本地候选保留，但服务端没有收到结束结果，仍显示 running。确认本地执行进程已结束后，通过成员任务接口停止失效执行记录，将已保存的恢复评论接续到原 Issue。候选尚未提交及审阅，不计为新模型完成。

消费合约审查发现的审批后续跑缺口已在后端补齐：决定先持久保存，再以同 Issue 的耐久评论恢复原协调者；排队失败可从已保存决定重试。成员可见评论只显示业务行动名称、决定、理由和下一步，不铺陈 run、approval 或 action 的机器 ID。机器字段只在 daemon 领取任务时注入内部 instructions，并严格限制到同 workspace、Issue、Agent、原请求成员和原准备任务；它们只用于定位记录，不授予审批或执行权限。真实新 consumer 旅程尚未完成，因此该后端证据不等同于业务执行验收。

实际图谱的 FA2 worker 正常，默认显示全部关系文字造成重叠。已将关系文字改为按选择、悬停和路径显示，静态检查通过；新镜像和实际浏览器复验仍待完成。

## 行动审阅版本与自然称呼验证

新增回归已通过：同一业务草案在证据变化或审阅过期后生成待复核的新版本，原批准、理由和继续状态保留；并发刷新仅生成一个新版本；已有执行回执（包括结果未知）始终复用并核对，不能借刷新再次派发操作。旧版本通过 `superseded_by` 指向新版，不能继续批准或无回执执行。

模型随后修订为 23 Entity / 137 Attribute / 54 Relationship。只读草稿 context 入口已部署，并以真实保存产物重新验证四个日常短语；四次均得到 1 个正确匹配，证据为 `/private/tmp/enact-native-integration/draft-context-live-verification.json`。该入口只验证自然语言定位草稿模型，结果不能当作业务查询证据。真实 model gate 审阅 `3342fc7a...` 已于 2026-09-09 17:36:43 通过；operations 与 release 尚未批准。

## 实际业务图与审批版本交互复验

实际本体 `5af3daaf-bcb9-45d6-85a7-85fe3d9d546a` 已更新为 23 类对象 / 53 条关系。生产前端 `e44605559abd` 的只读检查确认总览关系文字按上下文显示，但搜索定位暴露相机坐标时序问题。后续最小修复使用 Sigma 公共坐标转换，路径选择恢复完整视图，并让路径标签优先于邻域筛选；选中对象不再强制绘制遮挡其他标签的悬浮卡，实际指针悬停仍保留。

修复已在临时前端 3011、同一实际后端与真实草稿上复验，没有 API 响应拦截或示例替换。总览显示 23 个中文对象标签、0 条关系文字；搜索“质量问题”后选中对象位于画布内；“质量问题 → 来料生产批次 → 供应商”三个对象及方向可见。390px 宿主 scrollWidth=390。短边名称依 Semantica/Sigma 原生规则省略，完整关系名称保留在详情列表。开发端口不在业务 WebSocket 允许来源中，因此记录到 `/ws` 403；本次本体、版本、构建及修订的实际 HTTP 读取均为 200，图谱 worker 无错误。3011 已在截图后停止，未改变生产来源配置。最终生产镜像部署由主任务另行记录。

截图及同名 JSON 在 `/private/tmp/enact-ui-qa/`：`final-actual-graph-overview.png`、`final-actual-graph-neighborhood.png`、`final-actual-graph-path.png`、`final-actual-graph-path-mobile.png`、`final-actual-graph-path-mobile-details.png`。JSON 记录原生画布实际绘制标签与请求状态；属于本机临时验证记录。

审批版本界面显式接受 `supersedes_approval_id` / `superseded_by` 的 UUID 或 null。旧决定继续展示，已被替代的草案不提供批准、拒绝或执行；宿主可以只读查看新版/上一版，但不更改原始 `approval.decide` 请求 ID，也不自动批准新草案。运行页保留旧卡片和新版锚点。4 个相关测试文件、12 项测试通过（宿主请求身份、旧版操作限制、可读行动审阅与图路径/分组）；相关 lint 与类型检查通过。此处组件测试使用测试数据，不代表执行或批准了任何真实业务行动。

### 最终生产前端复验

前端镜像 `119bd5f14d5be646ac885b59121bcca665b5edb7a0bdbee0b03281e2c7f0edbf` 已在 `127.0.0.1:3000` 完成简短生产复验。当前真实模型为 23 类对象 / 54 条关系；“质量问题 → 来料生产批次 → 供应商”三个路径节点及名称可见，桌面绘制完整的两条关系名称；390px 无页面横向溢出。生产浏览器与图谱 worker 无错误。此次没有启动开发服务或修改前端源码。

已发布 Site 构建 `8a16fd58-bdc5-4722-811c-d442ca6ab4b1` 沿用原调查 `5cfce51b-c803-4137-9772-756505f4c518` 初始化，`context/run.attach/run.get`、四个真实查询绑定及 `run.trace` 均返回 200；业务刷新再次完成 case/exposure 查询与 run.get/run.trace，均返回 200。浏览器无控制台错误，只有导航时的 client-usage 请求被取消。未创建、批准或执行真实行动；新版审批后端在该时点尚待部署，审批版本交互仍以组件回归为证据。

本轮证据：`/private/tmp/enact-ui-qa/production-final-actual-graph-path.png`、`production-final-actual-graph-mobile.png`、`production-final-site-refreshed.png` 及各自同名 JSON。


## 行动续跑部署记录（早于当前 Skill 版本）

当时后端镜像 `8affb7af2ac30650720db01e479577161744b49488d3c61b91fab19f8596b9c6` 已部署；当前版本见文首。数据库迁移 `524` 保存行动决定后的协调者续跑状态；迁移 `525` 保存审批版本的 `supersedes_approval_id` / `superseded_by` 链路。隔离数据库最终 `TestSemantic` 结果为 60 个顶层测试通过、1 个旧 E2E 按设计跳过，`go vet ./internal/handler` 通过。

行动续跑回归证明：批准与拒绝都会通知同一 Issue 的原协调者；重复决定不会重复创建评论；排队失败复用原评论恢复；跨 Issue、跨 Agent 或跨成员的审批上下文不会进入当前任务。成员可见评论不显示 run、release、approval 或 action 的协议 ID；所需机器字段仅出现在经过服务器范围查询的 daemon claim instructions，最多 20 条，并明确不是授权。Agent 仍不能代替成员审批，过期或已被替代的审批也不能继续批准或在无既有回执时执行。

真实质量追溯模型现为 23 类对象、137 个属性、54 条关系。model gate 审阅 `3342fc7a...` 在 2026-09-09 17:36:43 记录为通过。operations gate、release gate、正式发布以及新 consumer 的自然问题到行动回读旅程均未完成；当前证据不能宣称端到端业务验收完成。该次前端 QA 对应镜像 `119bd5f14d5be646ac885b59121bcca665b5edb7a0bdbee0b03281e2c7f0edbf`；后续草稿功能已更新宿主，见文首当前镜像。


## 执行结果时间契约的实际部署

参考 API 已以进程 `89133` 在 `127.0.0.1:18180` 更新运行，沿用原 QT 配置并关闭启动时重新播种。健康检查为 `ok/reference`，重启前后 22 条业务资源的快照对比一致；没有数据库迁移或业务记录重置。18280 的独立全球 demo 不受影响。保存证据为 [reference-time-contract-live.json](/private/tmp/enact-native-integration/reference-time-contract-live.json)。

REST 连接 `a3d9939a-5480-4eb5-8ad8-19ff39709c1d` 已于 2026-09-09 17:49:14 UTC 重新发现，目录 `5439fafb-caab-4cfd-b361-5cfbed9a5683` 状态为 `ready`，43 个条目、无发现警告；来源 digest 为 `sha256:8f8aa678e36a3ec3f85b479797fc5f7bd23329da0c9a521b8d1b18c8d7f44a36`。实际 `qt.operation.read` 输出保留必填的 `readAt`，新增非必填、可空的 `verifiedAt`；完整目录见 [rest-catalog-time-contract.json](/private/tmp/enact-native-integration/rest-catalog-time-contract.json)。

`readAt` 是每次读取的观察时间，不能映射为成功核验时间。`verifiedAt` 仅在操作成功且已核验时投影已有的持久 `completedAt`；处理中、失败或历史证据缺失时为空。重复 GET 保持操作 ID 和来源版本不变，后续目标状态变化也不改写原成功核验时间。Enact 对原回执的核对使用已绑定 GET；业务 `POST /operations/{id}/reconcile` 可能推进命令并写目标，仍须独立 Action、Policy 和审阅，不能因名称相同而自动调用。

隔离 SQLite 回归包含 6 项新增时间契约测试：契约、发现及指导测试 14 通过、1 跳过（未连接隔离 PostgreSQL）；既有运行时与 MCP 测试 25 通过。JUnit 记录为 [时间契约测试](/private/tmp/quality-operation-time-verify.xml) 和 [既有流程回归](/private/tmp/quality-operation-regression.xml)。这些测试不等于实际业务行动已执行。

Agent Family 的工程子任务已收到中文说明，获知观察时间与确认完成时间已分开、目录已刷新、处理中和失败不能显示完成。该说明不构成审批；本次部署没有修改候选绑定、旧目录或旧发布。后续仍需在新候选绑定新目录修订，验证状态与时间映射的正反例，并完成 operations 审阅。文件指纹与修复说明见 [operation-time-contract-fix.md](/private/tmp/enact-native-integration/operation-time-contract-fix.md)。


### Site 追问 → 任务草稿（宿主已部署，新版 Site 待发布）

Site 的“带到任务继续编辑”调用 `issue.open({run_id, draft_message})`；宿主先用现有服务端接口核验该调查所属任务，只把 `run_id` 发给 API。正文保存到现有按空间持久化的 `new:<verified issue id>` 评论草稿，网址只有任务路径。编辑器准备好后追加到当前正文，保留上传附件；用户仍需检查并点击发送。没有发送评论、创建调查或执行业务行动。重复点击不重复追加；切换空间后的迟到响应不保存或导航；发送旧评论时到达的新问题会保留到发送完成后再加入。插入失败保留本地问题并提供重试。

验证：views 的 ApplicationFrame + CommentInput 回归（含稳定 MessageChannel、旧审批版本限制），core 的草稿持久化/刷新恢复，Quality Site 本地测试全部通过。独立本地浏览器组件检查仅使用说明性 fixture，没有连接生产 API：输入阶段调用数为 0；失败和重试均只调用 `issue.open`；失败后正文完整保留；390px 页面宽度为 390px，没有 pageerror。证据：`/private/tmp/enact-ui-qa/followup-local-evidence.json`；截图 `followup-local-desktop.png` 与 `followup-local-390.png` 在同目录。

宿主已部署到文首前端镜像；61 项 views、24 项 core、28 项 Site 测试通过。Site 源码已保存构建但旧发布物的目录已变更，未发布该旧版本候选。新本体发布后将创建新应用并完成真实追问草稿验证。


## 行动审阅修订与 Skill 更新（18:48 UTC）

Family 已保存 15 个 Action、18 个 Policy、17 个 Data Binding、16 个 Action Binding。最新工程候选将跨工厂未知批准权落实为禁止，区分只读状态查询与可能继续执行的业务操作，并加强措施—方案—目标关联及整案闭环缺失处理。当前没有 operations 审阅批准或新版本发布。

独立复核仍发现：8 个绑定含 15 处不受支持的回读参数引用；方案批准缺方案所属案例与查询案例的身份校验；17 个数据绑定尚无原生事实映射，不能把手工构造的规则事实标为连接查询证明。已让协调者继续组织检查。

最新创建 Skill 已部署且核实进入恢复任务的运行目录。检查要求覆盖双向 Action/Policy 关联、精确对象与版本、正确回读模板、真实查询事实投影、正反例分离，以及 specialist 完成后的真实调度交接。成员仍只在中文 Issue 中表达业务要求。记录位于 `operations-current-candidate.json`、`operations-parent-review-request-result.json` 和 `live-v2-state.json`。

## 草稿 Policy 解释器与页面复验（19:53 UTC）

发布前草稿已用 7 个中文业务用例调用真实 Semantica `native/policies` 解释器，7/7 的实际判断均符合各自明确预期；服务端保存 artifact digest、解释器、预期与实际判断，并明确标记 `fixture=true`、`execution_evidence=false`。这些输入是独立合成 fixture，只验证规则和 Policy 的正反例，不代表已查询真实连接数据，也没有创建行动意图、审批、回执或执行真实行动。记录见 `/private/tmp/enact-native-integration/live-policy-fixtures-results.json`。

生产前端页面已在桌面与 390px 视口读取这 7 条服务端测量结果；用例卡、预期/实际判断和展开后的 Policy 原因均可见，390px 下 `documentWidth=390`，没有页面错误。证据为 `/private/tmp/enact-ui-qa/policy-live/evidence.json`，截图为同目录的 `desktop.png`、`mobile.png` 与 `expanded.png`。这项复验只覆盖草稿 Policy 测试展示；创建流程仍在 operations 最终复检，构建来源尚未发布，`quality-traceablity` 消费空间尚未安装新版本，因此不能宣称创建到消费全程完成。
