# Graph-answer test

本包保留 openCypher 生成与静态检查；Enact 可选运行时位于
`tools/semantic/adapter.py`，直接编译完整候选四层工件为 RDF，再运行查询与规则。
它通过 Enact 的工作区草稿 API，不需要智能体拿到内部服务密钥。

所以 `test_type` 为 `graph_answer_test` 或 `both` 的题目，在没有适配器的机器上：

- **记为 `unsupported`**；
- `rationale` 里写明原因是**缺执行环境**，不是模型缺东西；
- **绝不记成 `passed`**，也不记成 `failed`。

## 为什么不是 failed

`failed` 的意思是"本体意图上应该支持，但检验没过，需要缺陷单或修订"。
没有图库跑不了，说明不了本体的任何事情——记成 failed 会让人去修一个没坏的东西。

## 为什么不是 passed

这条更重要。**没跑过的题标 passed，是这个阶段唯一会造成实际伤害的错误。**
它会在跨 revision 比较里表现为"一切正常"，在就绪检查表里表现为"评估已附"，
而实际上没有任何东西被检验过。

流程 §11.1 的系统职责写着：不得把"查询返回数据"简单等同于"语义正确"。
这里的极端形态是：连数据都没返回，就当作语义正确。

## rationale 该怎么写

区分开这两句话，它们导向完全不同的下一步：

| rationale | 意思 | 下一步 |
|---|---|---|
| 本机没有图适配器，graph-answer test 未执行 | 环境缺口 | 装适配器再跑，或接受只有 rule check 的结论 |
| 模型未声明 ent.X，当前契约不承诺这项能力 | 范围缺口 | 一次范围决定：要不要纳进来 |

两种都是 `unsupported`，但混着写，读的人分不清该去装环境还是去开会。

推荐写法：

```yaml
- cq_id: cq.004
  status: unsupported
  rationale: >-
    环境缺口：本机未配置图适配器，test_type 为 graph_answer_test 的题目未执行。
    rule check 部分已过（ent.journal_entry、attr.journal_entry.status、
    evt.reversal_approved 均存在，聚合维可用），但"按原因分布聚合"的结果形状
    需要在真实数据上验证，本次未验证。
```

## 有适配器的时候

Enact 适配器的配置与命令见 `shared/semantic-runtime.md`。配置后这类题的流程是：

1. 从完整 `candidate.yaml`、process/evidence/alignment 保存选定 revision 的 Enact 草稿，
   预览返回独立的 RDF 图与 source digest。不要用只有标签关系的投影替代完整候选；
2. 将题目的 `required_*` 解析到发布物的 stable-ID map，单独保存只读 SPARQL
   查询文件和测试数据来源；CQ 正文本身保持业务语言，不嵌查询代码；
3. 跑，拿结果；
4. **拿结果的形状和 `expected_answer_shape` 比对**，这一步不能省。
   返回 200 行不代表答对了：可能正好把两个不该合并的概念合并了。
5. `execution_evidence` 记：适配器与版本、图的构建来源 digest、查询、返回行数与前几行样例。

实例验证还需检查实际 SHACL target coverage。空 target 没有证明任何业务案例。
合成数据上的通过是测试证据，真实业务数据必须由正式 semantic run 的绑定查询取得。
草稿规则评估返回的 ActionIntent 只证明规则产生了建议，不会执行系统操作。

第 4 步是 passed 与 "查询跑通了" 之间的全部区别。

## 别做的事

- **不要为了让题目有结果而降级 test_type。** 把 `graph_answer_test` 偷偷改成
  `rule_check` 跑一遍，得到的 passed 是假的：rule check 只能证明模型声明了这些东西，
  不能证明数据上答得出来。要降级就明说，并写进 rationale。
- **不要用样例数据"手算"一个答案然后记成 passed。** 那是人的推理，不是执行证据。
  可以写进 rationale 作为佐证，但状态仍然是 `unsupported`。
- **不要因为一台机器缺环境就把题从登记里删掉。** 登记是跨 revision 的长期资产；
  删了它，以后装上适配器也没人记得曾经想问这个。
