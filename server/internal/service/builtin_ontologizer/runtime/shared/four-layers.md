# 四层

来自流程 §5.3 与 §8.2。四层不是四种视图，是四份不同的文件，各自回答一个问题。

| 层 | 文件 | 回答 | 里面有什么 |
|---|---|---|---|
| Evidence | `evidential_ir.yaml` | 我们从哪里知道？ | 来源事实、术语、锚点、置信度、限制 |
| Process | `process_ir.yaml` | 业务怎么发生？ | 步骤、参与者、输入输出、事件、决定、衔接、异常 |
| Mapping | `alignment.yaml` | 证据和流程怎么支撑设计？ | 显式对应、依据、置信度、歧义、未映射项 |
| Ontology | `candidate.yaml` | 目标语义模型是什么？ | 实体、关系、属性、事件、生命周期、约束（及可选的政策、能力、绑定） |

## 为什么要分开

流程 §3 把这条写成一条构建原则：**原始 evidence、解释/assumption、建模 guidance/constraint
和最终设计必须分别记录，不能互相覆盖。**

理由是可逆性。三样东西混在一份文件里之后，你没法回答"这个基数是从哪条材料读出来的，
还是我们自己定的"。而这恰恰是审阅时最常问的问题，也是半年后接手的人唯一需要的东西。

## 禁止的隐性混入

`layer_separation` 检查这两件事：

1. **`process_ir` 与 `evidential_ir` 不得出现目标设计字段**——顶层和条目内都不行。
   完整清单：`entities`、`relationships`、`attributes`、`constraints`、`policies`、
   `capabilities`、`bindings`、`metrics`、`bundle`、`declarations`、`domain`。
   一条 step 里挂一个 `entities:` 列表，是最常见的一种：流程读着读着就顺手把设计写下来了。

   **`events` 和 `lifecycles` 不在这份清单里。** 流程 §5.3 把事件和生命周期算作
   Process 层自己的内容，所以 `process_ir` 里写事件是本分，不是越界。
   两层的事件靠形状区分：流程事件说的是谁在哪一步做了什么，
   本体事件带 definition 和 support。
2. **`alignment` 的每条对应都要有 source、target 和 confidence。**
   没有端点的"自动对齐"等于没有依据的断言。

反过来的方向不检查：candidate 引用 process step（`events[].process_ref`、
`lifecycles[].transitions[].trigger`）是设计好的，它让 Process 层与 Ontology 层可以互查。

## 四层与审阅

审阅按这四层走四轮（`skills/review/references/four-pass.md`），顺序不能换：
先确认我们知道什么，再确认业务怎么运转，再确认映射是否成立，最后才评价设计。
反过来审，人会先爱上一个漂亮的模型，然后为它找依据。

## 四层与追溯

追溯链沿层走：

```
Source → 抽取/锚点 → Evidence Fact
                       │
Process Step/Event ────┼→ Alignment → Ontology Object
                       │
Assumption/Guidance/Constraint
```

`trace_complete` 走的就是这条链：candidate 里每个对象至少一条 support，
`evidence` 型 support 要能经 alignment 落到一条带锚点的 evidential fact 上。
落不到，就要么补依据，要么改挂一条显式 assumption，要么删掉这个对象。
