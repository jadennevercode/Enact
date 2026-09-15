# Ontology v2 构建与人审

状态：已实现后端契约与 Agent Family/Skill 协议；路由、native 保存和发布钩子由语义总入口接入。本文是构建与人审模块的权威 SPEC。

## 业务流程

构建从一句普通请求开始，例如：“请基于连接的质量追溯知识和绑定的数据系统帮我制作本体”。Issue 正文保留用户原话，不自动拼入工作流程、技术交付要求或五类构件清单。读取知识、发现资源、识别候选、分派小队、组织四次人审和编译测试均为 Skill 默认职责。用户不需要先会描述本体规格，也不需要知道 construction、snapshot、IRI 或 Agent system key。运行时用当前任务的 `issue_id` 调用 `GET /api/semantic/constructions/for-issue/{issueID}`，沿父任务找到关联 construction。

主协调者是根任务中唯一与成员对话的 Agent。领域分析、生成、独立审阅和发布准备各自在真实子任务中完成，通过持久 construction event 和 ReviewPacket 交还主协调者。专员不能直接向成员索取确认，协调者也不能代写专员产物。每次分派后释放运行时槽位，靠子任务完成事件恢复。

每轮工作先读完已选择材料和已有回答，再问一至三个会改变结果的问题；同一时间最多保留五个未答问题。历史问答永久保留；新证据产生新的真实决策点时，可以进入下一轮继续提问。候选用中文业务卡片呈现，内容较多时按类型或邻域分组，每组五至九项。正文始终区分：

| 分类 | 含义 |
| --- | --- |
| `fact` | 由已选择材料及明确 source reference 直接支持 |
| `recommendation` | Agent 提议的建模选择，附业务后果 |
| `human_confirmation` | 真实成员通过服务器接口记录的回答或决定，必须带 `decision_id` |
| `unknown` | 材料缺失、互相冲突或成员明确不知道 |

实现任务的授权只允许 Agent 构建；它不是范围、模型、操作或发布的业务确认。

## 原生业务定义

唯一业务定义使用 `definition.schema_version = 2`，包含五类构件和两类 binding：

- `entities`、`attributes`、`relationships`、`actions`、`policies`；
- `data_bindings`、`action_bindings`。

Attribute 引用所属 Entity；Relationship 引用 source/target Entity；Action 引用业务目标和 Policy；Policy 表达 permission、prohibition、obligation 或 constraint，但不授予 Enact 平台权限。Data Binding 和 Action Binding 固定发现到的源操作及 catalog digest，并引用它们实现的业务构件。

Action 可声明 `identity_parameters`，只能引用 `input_schema.properties` 的顶层字段，用来界定“同一业务目标”的草稿去重，例如 caseId 与 leadPlant。没有声明时运行时按完整参数精确去重；构建 Skill 和服务器都不能按字段名猜业务身份。

`POST /ontologies/{id}/native` 接收当前 definition、源快照、规则、胜任问题和可选 runtime extraction。Semantica 从同一份 definition 编译 RDF/OWL、SHACL、SKOS、图、规则、来源和质量结果。`bundle.native_artifact` 是唯一原生事实来源；发布得到的是原生 Ontology package，不是 SkillPackage。只有成员明确要求兼容导出时才生成 SkillPackage。

## 持久 authoring state

`semantic_construction` 增加 `authoring_revision`、`interview_state` 和 `candidate_cards`。revision 是乐观并发保护。Agent 提案与成员回答使用不同接口，服务器保留成员字段，Agent 全量 patch 也不能覆盖。

### 查询

`GET /api/semantic/constructions/{id}/authoring`

```json
{
  "construction_id": "uuid",
  "revision": 4,
  "interview": {
    "scope": {},
    "status": "collecting",
    "round": 2,
    "questions": [{
      "key": "boundary-refunds",
      "topic": "boundary",
      "prompt": "本轮包含退款订单吗？",
      "why": "这会改变订单范围和退款关系",
      "status": "answered",
      "answer": "包含已完成退款，不包含申请中退款",
      "answer_kind": "human_confirmation",
      "answered_by": "member uuid",
      "decision_id": "decision uuid"
    }]
  },
  "cards": [{
    "key": "order",
    "kind": "entity",
    "label": "订单",
    "description": "客户提交并由企业履约的购买请求",
    "classification": "human_confirmation",
    "source_refs": ["source anchor"],
    "status": "corrected",
    "rationale": "成员补充了履约边界",
    "decided_by": "member uuid",
    "decision_id": "decision uuid"
  }]
}
```

Question `topic`：`goal|boundary|decisions|objects|process|exceptions|terminology|granularity`。Card `kind`：`entity|attribute|relationship|action|policy|data_binding|action_binding`。

### Agent 提案

`PATCH /api/semantic/constructions/{id}/authoring/proposal`

```json
{
  "expected_revision": 4,
  "interview": {
    "scope": {},
    "status": "collecting",
    "round": 3,
    "questions": [{"key":"q","topic":"exceptions","prompt":"…","why":"…","status":"unanswered"}]
  },
  "cards": [{
    "key":"return-order",
    "kind":"entity",
    "label":"退款订单",
    "description":"…",
    "classification":"recommendation",
    "source_refs":[],
    "status":"proposed"
  }]
}
```

Agent 只能写 `fact|recommendation|unknown`；fact 必须有来源。它不能写 answer、answered_by、decision_id、confirmed/rejected 状态或 `human_confirmation`。每轮新增一至三题，同时未答问题最多五题；服务器保留全部已答历史。revision 不匹配返回 409。

### 成员回答

`POST /api/semantic/constructions/{id}/authoring/respond`

```json
{
  "expected_revision": 4,
  "answers": [{"question_key":"q","answer":"目前不知道，需查授权表","answer_kind":"unknown"}],
  "card_decisions": [{
    "card_key":"return-order",
    "decision":"correct",
    "rationale":"业务称为退款单，并且不是订单子类型",
    "correction":{"kind":"entity","label":"退款单","description":"…"}
  }]
}
```

`answer_kind` 请求值为 `answer|unknown`，响应保存为 `human_confirmation|unknown`。Card decision 为 `confirm|correct|unknown|reject`；correct 至少给一个 correction 字段。每个回答和卡片决定写入 `semantic_human_decision`，响应返回完整新 state。

## 四个固定 ReviewPacket 关口

顺序固定为：

```text
scope → model → operations → release
```

前一关当前摘要没有真实成员批准时，服务器拒绝创建或批准下一关。Agent 创建精确 packet 后，construction 进入 `awaiting_review` 并停止；只有已登录工作区成员能批准或要求修改。Agent task token、agent actor 和 machine credential 均返回 403。普通 construction event 必须等于当前 gate，并且不能用 `review_requested` 跨关。

ReviewPacket envelope：

```json
{
  "id":"uuid",
  "construction_id":"uuid",
  "gate":"model",
  "sequence":2,
  "status":"pending",
  "artifact_digest":"sha256:…",
  "review_subject_digest":"sha256:…",
  "packet":{
    "title":"请确认业务模型",
    "summary":"…",
    "groups":[{"title":"订单对象","items":[{
      "label":"订单",
      "value":"客户提交并由企业履约的购买请求",
      "classification":"fact",
      "source_refs":["source anchor"]
    }]}],
    "checks":[{"label":"关系端点完整","status":"pass","detail":"…"}],
    "unresolved":[],
    "proposal":{}
  },
  "created_by_task_id":"uuid",
  "created_at":"RFC3339",
  "stale_reason":null,
  "decision":null
}
```

`status`：`pending|approved|changes_requested|stale`。每组最多九项。item classification 为前述四类；`human_confirmation` 还必须带本 construction 中真实存在的 `decision_id`。check status 为 `pass|warning|fail`。

Agent 创建：

`POST /api/semantic/constructions/{id}/review-packets`

```json
{"gate":"model","artifact_digest":"sha256:…","review_subject_digest":"sha256:…","packet":{}}
```

成员决定：

`POST /api/semantic/review-packets/{id}/decisions`

```json
{
  "decision":"approve",
  "rationale":"定义、边界和关系方向符合当前业务",
  "expected_artifact_digest":"sha256:…",
  "expected_review_subject_digest":"sha256:…"
}
```

decision 为 `approve|request_changes`。两个 expected digest 防止页面基于旧 packet 提交；artifact digest 必须等于 packet 创建时的完整版本，subject digest 还必须等于服务器当前关口内容。过期、已决定或缺前关批准返回 409。

## 分区摘要与失效

每个 packet 保存两种摘要：`artifact_digest` 记录当时完整候选，用于审计；`review_subject_digest` 决定批准是否仍有效。

| gate | 摘要内容 | 改变后失效 |
| --- | --- | --- |
| scope | 选择的 sources、成员确认范围、scope 问答、胜任问题 | scope、model、operations、release |
| model | Entity、Attribute、Relationship（兼容 native classes/properties） | model、operations、release |
| operations | Action、Policy、Data/Action Binding、native rules、binding config | operations、release |
| release | 完整 native artifact 和 binding config | release |

因此首次 native 生成只要范围/CQ 没变，就不会使 scope 批准过期；新增 Action/Policy 不会使 model 批准过期。内容即使后来改回相同摘要，已经标为 stale 的历史批准也不会自动复活，必须生成新 packet。

native revision 落库后，在同一事务调用：

```go
h.semanticInvalidateOntologyReviews(ctx, tx, workspaceID, ontologyID)
```

它重算所有未完成 construction 的分区摘要，仅使改变关口和下游的 pending/approved packet 变 stale。authoring proposal/response 在自己的事务中调用 construction 级失效。

发布在锁定当前 ontology、确认编译/验证字节未变化后调用：

```go
h.semanticRequireReleaseReview(ctx, tx, workspaceID, ontologyID)
```

它要求最新 construction 当前 release subject 存在 approved packet；失败则不插入 release。发布记录最终当前 digest，历史 packet、决定、revision 和 receipt 不修改。

## 路由集成与清理

语义根路由内调用 `h.registerSemanticReviewRoutes(r)`。该 hook 注册：

- `GET /constructions/for-issue/{issueID}`；
- `GET /constructions/{id}/authoring`；
- `PATCH /constructions/{id}/authoring/proposal`；
- `POST /constructions/{id}/authoring/respond`；
- `GET|POST /constructions/{id}/review-packets`；
- `POST /review-packets/{id}/decisions`。

迁移 510 添加 state 和两张无 FK 表；511–514 各用单语句 concurrent index 建立查询和唯一 identity。工作区删除必须先显式删除 `semantic_human_decision`、`semantic_review_packet`，再删除 construction；禁止 FK 和 cascade。

## 恢复与验证

重试总是先 GET construction、authoring 和 packets。409 后不得复用旧 expected digest；刷新、合并并创建新 packet。请求修改保留旧 packet 和决定，后续 packet 使用新 sequence。任务失败不删除提案；新的真实子任务可从持久 state 恢复。

自动验证至少覆盖：Agent/machine 不能审批、无前关不能越级、stale packet 不能审批或发布、scope/model/operations 的分区失效、request_changes 使下游失效、同一请求重试不产生第二次业务决定，以及发布只接受当前 release subject。自动 fixture 只证明机制，不代表成员完成业务确认。


## 服务端审阅依据与自动继续

Agent 在创建每关确认内容之前，调用 `GET /constructions/{id}/review-subject?gate=scope|model|operations|release`，取得同一候选的 `subject`、`artifact_digest` 和 `review_subject_digest`。只允许当前关口；POST 创建时再次校验。Agent 不复制服务器哈希算法，也不向用户询问技术摘要。

成员的访谈答复或关口决定提交后，决定先持久化，再经正常 Issue 评论与 Family 队列恢复协调者。API 与 GET authoring 都返回 `coordinator_resume`：`queued|coalesced|deferred|failed`、可读 `message` 和可选 `comment_id`。运行中状态为延后继续，不重复派发；失败不能冒充成功，也不会回滚已保存的决定。

`POST /constructions/{id}/resume` 只重试最新已保存决定的继续消息，优先复用已有评论，不重新提交业务决定。界面将“回答已保存”和“小队是否继续”分别呈现，并提供失败后的恢复入口。

本次用户已明确委托 Codex 代为和 Family 交互制作及消费本体。受托操作使用成员接口并保留审阅理由；这不允许 Family 的 task token 自批，也不将未知业务权限变成已批准。未来真实用户使用同一套交互接口。

### Natural-language retrieval checks

Before claiming that a daily term resolves, run `POST /api/semantic/ontologies/{id}/context` against the saved draft with `{question, entity_ids?: [], hops?: 2}`. The server compiles the saved workspace model and reuses Semantica context resolution. It returns matches, paths and missing context without creating a published investigation, operational query evidence or approval. Retain the measured result in the review artifacts. A schema ASK that finds a class or label does not prove that an ordinary question will retrieve it.
