# Quality Traceability Site v2

状态：业务 Site 与独立规模演示已实现并完成本地浏览器验证；真实 Enact 新版 build 的打包、上线及同一个 Issue/run 的联合验收由主集成任务完成。本文不把自动化 fixture 当作真人业务验收。

## 用户看到的内容

用户从“零件异常影响了哪些批次、工厂和车辆”进入追溯。第一层是紧凑的当前案例与调查问题、影响分布、对象关系和下一步判断。问题和案例明细按需展开；已查询指标收进图的标题栏，不以大表单和大卡片占满首屏。世界地图、关系拓扑、对象列表共享一个选中对象；右侧显示它的业务故事、可核实的数量与状态、本体定义的 Action、适用 Policy、关联记录和继续追问的入口。

- 地图选工厂，关系图联动显示真实查询返回的相邻对象；点批次可以继续查关联车辆。
- 数量分别注明库存、在制、交付或关联车辆。关联不等于已经确认缺陷，不把库存与交付直接相加。
- 已交付车辆提示独立的售后影响评估；工厂显示负责团队，行动以前置政策和范围复核为依据。
- 业务报告将已查询事实、有依据的推断、处置建议和未知项分别标明；调查计划可以展开。原生技术 trace、规则结果、精确参数及来源细节保留在次级折叠视图。
- “向分析师追问这个对象”先生成可编辑的人类问题。真实 Site 的“到任务继续追问”只导航所属 Issue；不会代替用户发送问题。演示只能复制问题，不连接真实任务。

## 两种明确隔离的入口

| 入口 | 数据与行为 | 地图 |
| --- | --- | --- |
| Enact 中的已发布 Site | 仅经宿主 SDK 访问当前用户、App/build、固定 release 和调查 run；复用现有 reference API、capability bridge、审批与行动回执 | 本地 Natural Earth SVG + 可交互拓扑与列表，无 worker 或直接网络 |
| 独立 `/?mode=global-demo` 页面 | 同源只读 `/api/demo/*`，独立 SQLite，醒目标注合成记录/政策/位置；不创建真实 run，不发布伪造 release，不接真实系统写入 | MapLibre GL JS 5.20.2 + 本地 Natural Earth，只有此模式创建本地 worker |

Enact SDK 存在时不能用 URL 切换到合成模式。参考系统不混入企业规模 demo 的车辆或地图坐标。CN03、MX01 等编码不推断城市；本轮 reference 查询未返回可信坐标，因此在列表/关系图完整保留，地图说明坐标待补。没有任何可信坐标时默认业务拓扑；有可信坐标时默认地图。全球合成 demo 继续地图优先。

宿主 CSP 保持原值。MapLibre 自带的 CSP 主包和原样 worker 用于独立演示；SVG 是嵌入视图的适配，不依赖放宽宿主 worker/connect 权限。底图版权与库许可证保存在 QualityTraceability/runtime/application/src/map-data/LICENSE.md。

## 数据投影与分页

固定种子 `20260909`：10 国、50 工厂、100 供应商、500 批次、100,000 VIN、200,000 装配关系。工厂坐标明确为示范位置。车辆覆盖生产、在途、经销商库存、已交付各 25,000 条。完整规模来自数据库计数，不由画面上的节点数推算。

- GET `/api/demo/summary`：完整类型数量、装配关系数量、风险数量、流转阶段和只读能力。
- GET `/api/demo/projection`：`level=plants|suppliers|batches|vehicles`，可组合 country/plant/batch/supplier/state/risk/search，cursor/limit；默认 50 条主匹配，limit 1–200。
- 返回 `total_matches`、`returned_matches`、`selected_ids`、`next_cursor`、`nodes`、`edges`、`locations`、`data_nature=synthetic`。
- SQL 在分页前执行筛选与 COUNT。上下文节点与边计入 500 / 1,500 上限；达到上限即停止本页主对象扩展，用实际已返回数量推进游标，不能漏掉下一页。
- GET `/api/demo/nodes/{id}`：选中对象及真实邻域总数；默认返回 25 条邻域，最大 100，保留边方向与下一页游标。
- 详情只加载有限邻域；完整对象通过类型/范围查询继续分页。浏览器不会接收 100,000 VIN 或 200,000 边的整包。
- 数据库只读连接。写方法返回 405；超界分页参数 422；不存在对象 404。reference 标识不属于此 demo 数据集。

百万关系 fixture 使用另一个数据库，100,000 VIN / 1,000,000 装配关系；它只用于性能诊断，不替换用户可见的 200,000 关系演示。

## 真实 Action 与 Policy 交互

本体 Action 通过业务 Entity 匹配，并沿 Action.policy_ids / Policy.action_ids 展示相应政策。API binding 不代替 Action。库存/生产线对象可以加入现有处置范围，再到方案与审批页核对。

v2 binding 带 action_id 时，Site 先调用 `policies`，携带实际成功的数据步骤，取得准许准备的 intent；再将同一步骤的 evaluation_step_id/intent_id 传给 `action.prepare`。缺少 intent 显示政策阻断，不请求执行。

准备只打开具体变更复核对话框，显示目标、状态版本、影响范围、政策结果与精确参数。用户点击“确认并执行本次行动”后，才调用 approval.decide 与 action.execute。回执非 succeeded 时明确待核验，保留原操作链；恢复和重新查询沿用当前 run。

相同目标的草案优先继续：本地 DRAFT 检测跨 evaluation；后端 resumed + 已完成 receipt 直接展示原结果；409 existing_draft 直接调用 issue.open，由后端验证所属用户、工作区和 Issue 访问权后回到原任务；不授予旧版本的数据或执行权限。另建必须由人填写 repeat_reason，并把 create_another=true 原样带到准备请求；新草案仍有最终执行复核。

Site 不自行放大权限、不伪造审批、不把 demo 的建议变成真实系统调用。最终动作许可由后端执行器再次验证。

## 390px 与可访问性

390px 布局为单列；保留地图和地点横向列表，同时提供对象列表替代图操作。列表页仍完整显示当前 50 条匹配并分页，不再重复渲染另一份 50 条列表。选择对象会定位到其详情。对象/地图/拓扑有可读名称和键盘操作；主要按钮至少 44px，焦点可见，尊重 reduced-motion。缺坐标、空结果、加载中和查询失败都有明确文案。

## 已执行的证据

2026-09-09，本地 macOS / Chromium：

- 25 项前端单元测试、6 项独立 demo 单元/API 测试通过；生产 build 通过。
- 独立 demo 浏览器：1440px 地图渲染及 50 个地点、政策切换、工厂到 2,000 辆车、50 条一页与第二页、390px 对象/详情交互、中间请求全部同源 GET、无 JS 错误、两种宽度无横向溢出。
- 嵌入 SDK fixture：1200×600 首屏业务图起点小于 350px，390px 工厂卡与对象列表可直接操作，加载中不提前宣称无可见案例；SVG 无 worker、Issue 跳转只导航、当前目标与 expected version 传递、prepare 不批准/执行、真人确认后调用顺序、恢复草案不重复执行、另建原因传递和再次复核、中英文与 390px 页面。
- 固定 seed 的 200k、1M 关系投影诊断均每项 100 次。1M 数据 warmup 3 次后 p95：工厂 12.86ms，中国车辆 8.25ms，指定批次车辆 346.31ms，指定供应商车辆 283.73ms。最大响应 100 节点 / 500 边（这些查询的实际响应），所有投影同时受 500 / 1,500 硬上限约束。

这些数字是本地进程内 SQLite 查询诊断，未包含 HTTP、LLM、外部源或浏览器渲染；当前主机未固定为 4 vCPU / 8 GB。几次 demo 首屏可交互采样约 2.3–3.2s，最后一次为 3.115s；这不是 100 次 p95，也不能据此宣称达到 3s 目标。**固定主机下保存调查首屏 p95 ≤3s、API p95 ≤2s、本地选中 p95 ≤200ms 的正式性能验收仍待执行。**

证据目录：`/private/tmp/enact-native-integration/site-v2-qa/`，包含 browser.json、projection-benchmark.json、performance-1m.json、desktop/mobile 截图及 reference/ui-validation.json。紧凑首屏的新增证据在 `/private/tmp/enact-native-integration/site-v2-compact-qa/`。fixture 结果不能证明真实用户已审批或业务动作已成功。

## 启动与复验

当前独立入口：`http://127.0.0.1:18280/?mode=global-demo`。

```sh
cd /Users/jaden/PycharmProjects/QualityTraceability/runtime
QT_DEMO_PYTHON=/Users/jaden/PycharmProjects/semantica/.venv/bin/python QT_DEMO_DATABASE=/private/tmp/enact-native-integration/quality-global-demo-v2.sqlite scripts/start_global_demo.sh
```

启动脚本默认只监听 127.0.0.1:18280。已存在不同规模的 demo 数据库会拒绝覆写；用另一路径生成 1M 关系 fixture。运行命令与可配置的 Playwright 路径见 runtime/application/README.md。

未在此子任务中发布真实 Enact Site build，也未触发 reference 系统 Action。真实数据与同一个 Issue/run/release 的端到端证据须由主集成任务记录。
