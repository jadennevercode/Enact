# 上下文与交接效率实施记录

2026-09-14 · 分支 `codex/agent-context-efficiency`。配套 [SPEC](agent-context-spec.zh.md) 与[实施计划](agent-context-plan.zh.md)。此记录区分分支交付与生产发布验收。

## 已集成的行为

| 范围 | 实现 |
| --- | --- |
| 当前上下文 | 单独的 native snapshot，与累计计费分开；有效窗口、估算标识、更新时间、每轮首尾和峰值；修正 Codex reasoning 重复计量。 |
| Web / Desktop | 共享 Issue、回复和 Chat 输入框显示会话占用；多智能体明确选目标；按钮与独立 `/compact` 使用同一 API；混合正文照常发送，失败保留草稿。 |
| 原生维护 | 排队、取消排队、租约和 generation / epoch / seq；独立维护进程复用原生会话、provider home 和目录锁。Codex ACK 不算完成；Claude 以 boundary 为证据；成功无新读数则显示待更新。 |
| 故障恢复 | 原生 PID 与启动配置、待上报尾记录、操作回执写入主机私有 sidecar；过期维护先核实，不重复调用 compact；只有进程退出得到确认才能释放占位。 |
| 持续上下文 | 事务快照、来源 manifest 与实际注入 delta 分开保存；已完成 checkpoint 加新/改输入和删除 ID；请求重试返回相同 delta。缺失或超预算时恢复原有有界读取。 |
| 最终交付 | 显式 `--final`，来源执行 / 原线程 / 结果版本幂等；进展评论不再替代最终回执；新协议评论、附件关联、回执、交接目标事务提交。完成回调补交与显式交付复用同一回执。 |
| 交接重试 | 持久化原目标和原评论版本，重试重新验权；暂时不可执行保留 pending；旧目标删除或小队 leader 更换不改投新目标；入队与投递确认同事务。 |
| 原生协作 | 普通 @ / 阻塞 / 提问维持即时路由；leader `no_action`、人工评审、阶段屏障保持；遥测、压缩和 checkpoint 不产生业务唤醒。 |

源码入口：[原生协议](../../server/pkg/agent/context.go)、[daemon 维护](../../server/internal/daemon/agent_context.go)、[会话服务](../../server/internal/service/agent_context.go)、[版本化输入](../../server/internal/service/context_envelope.go)、[交接 outbox](../../server/internal/handler/final_delivery.go)、[共享界面](../../packages/views/context/use-context-controls.tsx)。

## 接入契约与降级

能力来自内置适配器、已有 CLI 版本检测和对应协议实现。版本取当前工作区注册确认值，自定义 profile 探测不会覆盖内置运行时的控制门槛。当前控制契约为 Codex app-server v2（现有最低版本 0.100.0、主版本 0）和 Claude stream-json v2（现有最低版本 2.0.0、主版本 2）；这是适配器兼容范围，不等于范围内每个发行版都已做真实账户认证。

- 版本未知、无法解析、未知主版本、自定义 profile 或没有适配器：不继承 vendor 的原生压缩能力。已支持的基础执行继续工作。
- Windows：可接遥测，首版不开放维护，因为尚无跨 daemon 重启的原生进程组退出证明。
- 原生窗口缺失：显示未知；不使用累计账单 Token 猜百分比。
- 原生完成后没有新快照：保留成功记录，清除旧占用显示，等后续原生读数。
- 旧 daemon 不协商本协议时沿用原执行/交付路径；新 daemon 仅在服务端声明 v1 时使用增强。
- 完全陌生的执行协议仍需基础 runtime adapter。这次增加的是可选上下文能力，不声称能自动执行任何未知协议。

首版只取消排队中的维护。未知结果核实期间不再执行 compact；原生 PID 已退出且结果不可恢复时关闭为 `closed_unknown`。若 sidecar 丢失/损坏，或崩溃落在启动与 PID 持久化之间，系统无法证明主机上的写入者已经退出，会保留 `reconciliation_required`，需要主机侧恢复证据；不能以超时伪造安全。此边界应在生产演练中覆盖。

## 数据与接口

迁移 540–560：会话、维护操作、请求幂等映射、checkpoint、来源/注入 manifest、最终回执和交接 outbox。没有新外键；并发索引各自独立迁移并注册无效索引清理。Issue / Chat / workspace 删除显式清理所属记录。

Chat 消息编辑增加单条 revision；Chat 水位由同一事务快照的头部与消息版本/内容生成，不通过消息触发器更新会话行，避免与现有认领/完成事务争锁。

| 入口 | 用途 |
| --- | --- |
| `GET /api/context-sessions?issue_id=…` 或 `chat_session_id=…` | 有权限的会话与维护历史。 |
| `POST /api/context-sessions/{id}/compactions` | 人类发起；携带 expected_generation 和 idempotency_key。 |
| `GET /api/context-operations/{id}`、`POST …/{id}/cancel` | 读取操作、取消排队。 |
| `GET /api/context-checkpoints?issue_id=…` 或 `chat_session_id=…` | 可见且来源已完成的摘要。 |
| `GET /api/context/current`、`POST /api/context/checkpoint` | 当前可信执行读取 manifest、提交摘要。 |
| daemon `/api/daemon/tasks/{taskId}/context`、`/api/daemon/context-sessions/{id}`、runtime `context-maintenance/claim` | 准入、遥测/终态和维护领取；沿用 daemon 任务/运行时权限。 |

CLI：`enact context get`；`enact context checkpoint --content-file checkpoint.json`；`enact issue comment add <issue> --final --result-revision 1 --parent <original-comment> --content-file result.md`。内置协作技能及 source map 已同步。

checkpoint 预算 16,000 字节。输入包预算 200 条 / 48,000 字节；超出后明确标记 gap 并补读，因此目前不保证超长历史也始终获得增量包收益。普通 Chat 没有可用 checkpoint 时继续原生恢复，避免再注入一遍历史。

## 验证与测量

自动检查结果记录于下表；全部 provider 用例使用显式假 CLI，不调用真实账户。

| 检查 | 记录 |
| --- | --- |
| 全仓 TypeScript | 7 个任务通过，含 core、views、Web、Desktop。 |
| core 完整 Vitest | 142 个文件、1,663 项通过。 |
| views 完整 Vitest | 403 文件中 402 通过，4,652 项通过；另 1 项既有 markdown-paste 性能测试并行超时，单独重跑该文件 26/26 通过。 |
| Go race | `GOFLAGS=-p=2 make test` 全仓通过，含 provider 假 CLI；最后计时/回执改动的 handler、daemon、service 定向 race 回归通过。 |
| 共享输入框最终回归 | 4 文件、83 项通过；core 上下文 schema 3 项通过；相关文件 ESLint 通过。 |
| 数据库迁移 | 隔离数据库从空库应用完整迁移链；559–560 增量应用通过。 |
| 页面 E2E | Chromium 通过：约 25% 显示 → 排队 → 取消；评论数与业务任务数均保持为 0。 |
| 固定样本 | 30 条来源记录 + 1 条新增指令，比较 cold 与 checkpoint delta 的序列化字节；保持人工验收项和新增输入，重试字节相同。cold 22,326 字节，warm 2,966 字节，约减少 87%；只代表此固定输入样本。 |

[只读测量 SQL](agent-context-metrics.sql) 同时查询来源/实际注入字节、排队到开始、执行耗时、首尾/峰值、维护 usage 和 outbox 状态。缺失值保留 NULL。现有 task_usage 仍是业务用量来源，维护 usage 不混入业务完成事件。

字节减少只证明减少了重复注入，不等于账单或耗时下降。真实模型的恢复质量、压缩后继续工作的效果，以及按模型/版本/场景分组的成本和耗时对照仍需发布验收；本次没有真实账户烟测或生产 A/B 结果，不承诺统一降幅。

## 发布控制

现有 FeatureFlagsService 接入四个开关（缺省 true）：`agent_context_telemetry`、`agent_context_compaction`、`agent_context_envelope`、`agent_final_delivery`。生产应按计划逐步启用，而不是把本地 fixture 通过视为真实版本认证。

关闭 compaction 会隐藏/拒绝新请求，在途维护仍完成或核实。关闭 envelope 停止注入，保留来源和既有 checkpoint。关闭 final_delivery 只影响新执行协商，已承诺的最终回执和 outbox 继续处理；不要删表作为回退。遥测显示开关不移除维护所需的租约协调。

本分支未部署、未推送远端，未修改原工作区已有未提交改动。
