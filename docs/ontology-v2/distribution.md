# 已发布本体的受控采用

状态：来源 release 会冻结实际验证 fixture；采用的治理、映射、显式 synthetic fixture 传递和审计契约已实现。需要实例数据的 schema-only 本体必须带同一份获确认的合成 fixture 在目标重新验证，缺少 fixture 或验证不通过都会返回 422，不会降级为假通过。本模块不提供市场、公共分享、实业务数据搬运或跨组织权限提升。

## 业务边界

采用者必须同时是来源工作区的有效成员，以及目标工作区的 owner/admin。来源版本必须仍为 active，并且服务器必须找到与版本 ID、digest 一致的发布事件、release gate 审阅包和成员批准决定。发布时实际通过验证的 `test_data` 会冻结在 release 内并进入 digest；旧 release 不会从后来可变的来源 draft 回填。仅有旧 `semantic_release` 行而没有这条真实治理链路的版本不可采用。

目标工作区不会重复进行来源工作区已经完成的业务建模审阅。采用记录保留来源工作区、本体、版本、digest、原始 release 决定和发布事件；同时记录目标成员的采用行为。这是“采用一个已批准的发布版”，不是伪造目标工作区的 Family 审阅。采用后形成新的目标 ontology/release ID。若目标成员以后编辑导入的 draft，再次发布仍需走正常的新 construction 和四关审阅。

每一个来源 `connection_id` 都必须明确映射到目标工作区已有的 `connection_id`，而且映射键必须刚好覆盖发布版使用的连接。服务器保留 binding 的业务字段和扩展字段，只改连接及目录 pin。它使用目标成员在目标连接上的凭据重新发现目录，按原 `catalog_entry_id`、path/method/tool 和 capability 校验契约，再在目标 scope 编译、验证并固定新的目录快照。来源凭据、来源目录返回值或调用者提交的 artifact/validation/governance 均不会进入采用流程。

跨工作区 test data 默认不传递。当前契约只接受来源不可变 release 中同时满足以下条件的合成 Turtle fixture：`facts.fixture_kind=synthetic_positive_schema_coverage`、`facts.live_business_data=false`，每条 RDF 语句的 subject 都是 `urn:fixture:`，且来源发布验证为 valid/conforms 并覆盖全部 target。采用者必须显式设置 `include_test_data=true` 并提交精确 digest；预览只返回 digest、格式、字节数、实例/target 数、分类和警告，不返回 fixture 内容。确认时同一摘要进入 `preview_digest`，目标 ontology/release 冻结同一份 fixture 并把它计入目标 release digest。

## HTTP 契约

两个请求都以目标工作区作为 `X-Workspace-ID`，并以来源 release UUID 作为路径 `{id}`。

`POST /api/semantic/releases/{id}/install-preview`

```json
{
  "source_workspace_id": "uuid",
  "expected_source_release_digest": "sha256:...",
  "include_test_data": true,
  "expected_test_data_digest": "sha256:...",
  "connection_mapping": {
    "source-connection-uuid": "target-connection-uuid"
  }
}
```

`expected_test_data_digest` 是来源 release `test_data` 经 Go `encoding/json` 规范化后的 SHA-256：对象键稳定排序、不增加空白，默认把 `<`、`>`、`&` 分别编码为 `\u003c`、`\u003e`、`\u0026`，再按 UTF-8 计算并以 `sha256:` 开头。预览返回来源治理证据、目标名称/版本、完整映射、目标 binding、目录契约摘要、目标验证结果、可读 `test_data` 摘要和 `preview_digest`。它不返回任何连接 secret 或 fixture 内容。preview digest 由不可变来源版本、原发布决定、精确映射、目标目录契约、去除随机目录 revision ID 后的 binding 和 fixture 摘要计算，因此独立重编译产生的运行时间元数据不会让同一份业务预览失效。

`POST /api/semantic/releases/{id}/install`

请求重复以上字段并增加预览返回的 `preview_digest`，以及 1 到 5000 字符的 `rationale`。后者是目标 owner/admin 对采用范围、fixture 传递和限制的可读说明，独立于来源 release 审阅理由保存。服务器从数据库重新读取来源版本、冻结 fixture 和治理证据，重新发现目标目录、重新编译并以该 fixture 验证；随后再次确认来源版本仍 active 且全部不可变内容与 digest 相符、成员权限未撤销、目标连接未改变且目录二次发现一致，最后在一个事务中写入目标 ontology、release、目录快照和采用记录。

同一目标工作区、来源版本 digest 与 preview digest 的重复请求返回已有目标记录，并标记 `idempotent: true`。唯一并发索引保证两个同时确认的请求最多产生一次采用。来源或目标发生变化时返回冲突，调用者必须重新预览。
