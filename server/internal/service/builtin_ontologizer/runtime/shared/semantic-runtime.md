# Enact 语义运行时

本地四层文件和封存流程继续负责可重现建模；Enact 负责草稿预览、已发布版本、
连接权限、数据查询、操作批准和回执。`candidate.cypher` 是现有投影，
RDF 编译从完整 `candidate.yaml` 及三个兄弟工件读取，不能用只有实体关系的投影替代。

## 配置和权限

`tools/semantic/adapter.py` 只使用 Enact 注入的 `ENACT_SERVER_URL`、`ENACT_TOKEN`、
`ENACT_WORKSPACE_ID`，走当前工作区草稿 API。生产智能体不持有内部语义服务密钥，
也不把 token 写入 YAML、产物、日志或应用。未配置运行时明确记录 `unsupported`。

```sh
python3 <pkg>/tools/semantic/adapter.py available
python3 <pkg>/tools/semantic/adapter.py save <ws> r0001
python3 <pkg>/tools/semantic/adapter.py preview "$ONTOLOGY_ID" --data-file test-data.json
python3 <pkg>/tools/semantic/adapter.py query "$ONTOLOGY_ID" --query-file answer.rq --data-file test-data.json
python3 <pkg>/tools/semantic/adapter.py evaluate "$ONTOLOGY_ID" --facts-file test-facts.json
python3 <pkg>/tools/semantic/adapter.py graph "$ONTOLOGY_ID"
```

`save` 返回 Enact 草稿 ID；同一草稿下一次用 `--ontology-id` 更新。
它读取四层文件，把 `process`、`evidence`、`alignment` 保留为兄弟工件，
不向封存 revision 写回任何内容。预览结果和测试记录放进 `evaluation/runs/`，
包含 revision、Enact 草稿 ID、source digest、compiler version、查询及预期结果。
`test-data.json` 是 `{content: "实例 RDF", format: "turtle"}`；数据是否合成必须标明。

## 模型声明和可执行语义

属性 datatype、nullable、enum、多值以及关系基数编译为 SHACL。生命周期 guard
和约束 statement 的自然语言保留为文档；它们不会自动执行。
需要执行的规则显式写在 `bundle.runtime.rules`，每条保留 stable id 和 support：

```yaml
runtime:
  rules:
    - id: rule.contain
      support: [{type: evidence, alignment_id: aln.contain}]
      when:
        all:
          - eq: [{fact: [bindings, bind.case, status]}, open]
          - gt: [{count: {fact: [bindings, bind.batches, rows]}}, 0]
      then:
        - action_id: cap.contain
          binding_id: bind.contain
          parameters: {case_id: {fact: [bindings, bind.case, id]}}
```

条件支持 `all/any/not/eq/ne/in/gt/gte/lt/lte/present`；值支持 `fact/count/literal`。
包含点的 binding ID 用路径数组。未知数据保持 unknown，不把缺少记录等同于允许。
声明的 capability、binding 与规则返回的 ActionIntent 均不是执行成功证据。

草稿 `evaluate` 仅用于带标记的测试数据；正式消费通过 Enact semantic run，
使用真实查询步骤的 `source_step_ids`，由服务器恢复数据。数据连接和 action 的
运行配置绑定到发布版本，凭证只在 Enact 管理，不放进四层文件或 access scopes。

## 两类检查不能混用

原有 CQ evaluation 仍是人的问题、非阻断提交的诊断。图查询测试必须比较真实
结果与 `expected_answer_shape`，记录已知样例、负例和缺失数据的结果。
SHACL 的空 target 不能证明实例通过；预览报告必须列出 coverage。

Enact 的运行版发布还要通过执行契约检查：编译、SHACL 与 target coverage、
连接和绑定可用性。这个门决定是否成为可运行发布版，不改变本地 Ontologizer
"Evaluation never blocks submission" 的治理提交语义。人审阅、Patch/Version
决定和既有审批记录继续有效；测试通过不能替代这些决定。
