# AnyHarness：原生页面、本地工程场景

## 范围

此场景只对 `demo@deloittecn.com.cn`、路由 slug `anyharness` 和已经解析的 workspace UUID 生效。正常打开工作区即可使用。没有独立演示入口、替代页面框架或 `demo=1` 模式。

Runtime、Family、Agent、Skill、Issue、子任务、评论、附件预览和下载全部使用 Enact 原有页面。仅在 Runtime 页增加“自建企业 Runtime”配置对话框，以及企业 Runtime 详情中的构建追溯区。其他账号和工作区走原来的数据与界面路径。

执行由前端规则驱动；不调用模型、不执行代码、不安装或启动 Runtime，也不写入后端数据库。界面用于产品流程展示，不构成生产 Runtime 的交付。下载的 JSON manifest 明确包含 `execution: frontend-local` 和 `production_ready: false`。

## 数据边界

- `core/api/index.ts` 提供方法级 resolver；未命中范围时仍调用原 ApiClient。
- `platform/core-provider.tsx` 注入 StorageAdapter，注册每次调用都重新检查账号、当前 slug、UUID 的 resolver。
- `anyharness-demo/native-api.ts` 将本地对象转换成原生 API 响应。身份读取保留原机制；目标工作区未支持的动作拒绝执行，不回落到真实 mutation。显式指向其他 workspace UUID 的请求保持原行为。
- 同步的 `getBaseUrl` 等 transport 方法保持同步转发；它们不是模拟业务操作。
- `native-repository.ts` 保存配置、任务、评论、版本化附件、决定与缺陷状态。React Query 读取这些原生实体；UI 不维护第二套业务状态。
- `views/anyharness-demo/boundary.tsx` 只隔离 QueryClient，不替换 children。身份缓存由外层复制，工作区变更不清除真实缓存。
- 本地 UUID 使用 `a11a0000-` 前缀；离开范围后不能将这些引用交给真实后端。
- 持久化键：`enact:anyharness:native:2:<userId>:<workspaceId>`。旧版独立演示的 schema 1 不会混入。

## 展示路线

默认加载完整示例：任意浏览器首次进入目标账号和工作区时，使用同一套阶段转换生成完整构建、18 个工作项、3 个缺陷和编码试用。`ANYH-101` 可以直接打开，无需先在该浏览器手工走流程。已有的局部记录会继续完成，已有评论和失败证据保留。每个子任务拥有自己的交付附件与独立评审记录。

一次性加载标记为持久化键后缀 `:complete-example-v1`。之后的评论仍按浏览器独立保存，不代表跨浏览器实时同步。下列路线描述从头构建时的交互；自动化测试单独跳过完整示例加载，覆盖同一套状态转换。

1. 正常进入 AnyHarness → 运行时 → 自建企业 Runtime。
2. 比较 Deep Agents、LangGraph、Pi。后两者提供架构评估内容，显式切换 Deep Agents 才进入构建。
3. 填写名称、语言和目标；创建原生构建 Issue。
4. 通过原生智能体团队页查看 1 个 Family、7 个角色、17 个 Skills；构建任务产生 18 个工程子任务。
5. 在 Issue 底部评论输入约束。原生讨论导航可跳到每个阶段。
6. 依次讨论企业基线、适配边界、上下文与知识、工具与沙箱、协作与恢复。
7. 明确通过设计评审，审阅实施分解后开始构建。
8. Independent Verifier 给出 36 项夹具的逐项报告，并建立 CTX-07、AUTH-04、REC-03 三个缺陷任务。
9. 可以单独修复，也可以修复所有阻断项；复验保留原始失败报告。
10. 运行使用验收，审阅发布和运维交接，确认发布 v1.0；也可暂缓发布。
11. 用原生手动创建智能体表单创建企业编码助手，选择发布后的 Runtime。
12. 用原生“新建任务”创建价格计算修复任务，在评论中批准指定测试，审阅结果，再决定是否采纳记忆。

## 可用对话

场景明确显示当前问题及回复建议；不是通用聊天模型。评论均保存原话。

- `主要使用 Python，企业内网部署，命令执行前逐次确认`
- `确认基线` → `确认架构`
- `上下文预算64000，保护字段增加：审批状态、接口契约`
- `名称改为 Finance Code Runtime` / `主要语言：TypeScript` / `目标改为……`
- `记忆必须验证后采纳，不能直接复用`
- `工具执行前需要逐次确认`
- `为什么审批必须绑定参数？`
- `确认上下文方案` → `确认工具方案` → `确认协作方案`
- `通过设计评审` → `开始构建`
- `解释 AUTH-04 的原因` → `修复 CTX-07` → `修复全部阻断项并重新验证`
- `运行使用验收` → `暂缓发布` 或 `确认发布 v1.0`
- `这个 Runtime 是怎么构建出来的？`
- 编码任务：`批准运行测试` → `采纳这条记忆` 或 `拒绝这条记忆`

否定、条件、问句和含糊评论不会被当作批准。实施后修改设计会退回评审，并使旧验证签署失效。已发布 v1.0 的配置不可通过普通评论改写，修改作为后续版本提案记录。

## 交付物

需求与验收基线、框架适配和 ADR、二十领域蓝图、类型化接口、上下文与知识设计、记忆生命周期、工具授权与沙箱、协作与恢复、工程目录与实施包、36 条验收夹具和缺陷历史、发布与运维手册、JSON manifest，以及试用任务的补丁和评审。

子任务保存各角色的交接记录及关联文档。产物按决定和修复生成新版本，首次失败不会被覆盖。

## 重复展示

产品页面不提供演示控制面板。需要重新开始时，在浏览器开发工具中仅删除当前账号和工作区对应的上述持久化键，然后刷新。不要清空所有 localStorage。此操作只丢弃这一场景的本地状态。

## 验证

```sh
pnpm --filter @enact/core exec vitest run anyharness-demo/native.test.ts
pnpm --filter @enact/views exec vitest run anyharness-demo/boundary.test.tsx
PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/anyharness-demo.spec.ts
pnpm --filter @enact/core typecheck
pnpm --filter @enact/views typecheck
pnpm --filter @enact/desktop typecheck
```

Playwright 使用身份读取 fixture，业务对象必须来自应用内的数据适配层。测试记录网络 mutation 和 WebSocket 帧，所有请求都留在测试拦截中，避免创建真实测试任务。

本地预览使用 `http://localhost:3100/anyharness/runtimes`，复用现有登录。此机器上 Docker 后端监听 `127.0.0.1:8080`，另一个开发后端监听 IPv6 8080；预览的 `REMOTE_API_URL` 应明确使用 `http://127.0.0.1:8080`，避免当前登录在错误数据库中得到 `user not found`。这只是预览进程配置，不修改现有服务或身份数据。
