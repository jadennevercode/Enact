# 失败、取消、恢复

来自流程 §8.4。三条硬要求：失败和取消的运行都可保留、可诊断、可恢复、可导出；
blocking failure 要提供诊断与重试；**不显示虚假的完成百分比**。

## 失败的运行不删

`revisions/runs/run-NNNN/` 存每次尝试的时间线与日志。失败的、取消的、超时的，
**全都留着**。

理由：失败的那次运行是唯一记录了"当时读了什么、走到哪一步、为什么停"的地方。
删掉它，下一次重试就是从头猜。而且失败会重复——同一份材料里同一处含糊，
第二次、第三次还会绊住同一个地方，那时候第一次的日志就是最快的诊断材料。

`gate_failed` 的 revision 同样留着，`sealed: true` 但 **HEAD 不动**。
产物还在，可以打开看 `validation/*.json` 里每一条 finding 指向哪个对象哪个字段。

## 三种失败，三种修法

### 1 · 结构不合法（`schema_valid` 没过）

先修这个，别的都先不看。结构不合法时后面的检查会连锁误报——
一个解析不了的 `alignment.yaml` 会让 `refs_resolve` 报出九条"alignment_id 无法解析"，
而真正的问题只有一条：YAML 里某个值以引号开头但没有整体加引号。

诊断方法：finding 里会带解析器的原话和行列号，照着改。

### 2 · 引用断了（`refs_resolve`、`trace_complete` 没过）

findings 逐条指到具体对象。两类：

- **悬空引用**：指向一个不存在的 id。要么补上被指向的对象，要么删掉这个引用。
- **依据落不到锚点**：某对象的 evidence 型 support 顺着 alignment 走过去，
  终点那条 fact 没有可用锚点。**这时候不要去伪造一个锚点**——
  正确的修法是改挂 assumption，或者删掉这个对象。

第二类是最容易走歪的地方：报错报在 candidate 的某个实体上，
最省事的做法是给 evidential_ir 里那条 fact 补一个看起来合理的 `exact_snippet`。
那就是把推断洗成了事实，而且洗得很干净——以后没人看得出来。

### 3 · 语义声明不全（`definition_present`、`relationship_declared` 没过）

补字段。这类失败没有陷阱，照着 finding 补就行。
唯一要注意的是 `definition_present` 报"只是名称的复述"时，
不要靠加几个字绕过去——它核的是定义有没有告诉人新东西。

## 诊断 / 重试 / 保留三选一

blocking failure 之后把选择摆给人，**不要自己替他选**：

```
r0003 未通过机器门，2 项 blocking 失败：

  trace_complete
    !! ent.reason_code: 没有任何 support
    !! con.period_open: 经 aln.011 指向的事实 ev.fact.020 没有可用锚点

  relationship_declared
    !! rel.approved_by: 缺少 source_role、target_role

产物留在 revisions/r0003/，状态 gate_failed，HEAD 仍在 r0002。

可以：
  diagnose  —— 我逐条打开 validation/*.json，定位到具体是哪份材料哪一段
  retry     —— 我只重跑 candidate 与之后的阶段，前三层不动，然后重新 seal
  停下来    —— ev.fact.020 那条锚点缺失可能是证据阶段就漏了，
                回 evidence 补比在这里绕过去便宜
```

`retry` 的关键是**只重跑受影响的阶段**。前三层没问题就不要重写，
理由不是省时间，是可读性：顺手改了不该改的地方，下一版的 semantic diff
就淹没在噪声里，而逐条看 diff 是 Patch/Version 那个决定的全部依据。

## 取消时问保留还是丢弃

用户中途取消，问一句：已经完成的阶段保留还是丢弃。

**默认保留。** 保留下来的部分下次可以接着跑；丢弃了就是从头来。
只有在用户明确说"这版方向就错了"时才丢弃——而那时候也是标记为
discarded 留在 `runs/` 里，不是删掉。

## 不要显示完成百分比

流程 §8.1 AC-G01 明确写了。显示真实的阶段状态和已用时间：

```
intake          ✓  0.3s
process_ir      ✓  1m50s
evidential_ir   ✓  1m10s
alignment       ✓  40s
candidate       ⟳  运行中，已 2m15s
gate（机器门）   —
cypher          —
```

理由：百分比要么是编的，要么是按"完成了 5/10 个阶段所以 50%"算出来的假精度——
而阶段之间的耗时差着一个数量级，`intake` 是零点几秒，`candidate` 是几分钟。
一个编出来的 73% 比什么都不显示更糟，因为人会据它安排自己的时间。

同样的道理适用于报结果：**不要说"生成成功了"**。说 `seal` 写下的那个状态
（`ready_for_review` 或 `gate_failed`），以及没过的是哪几项。
一个自称完成的生成，把"检查过了吗"这个问题从脚本手里拿走交给了措辞。

## 依赖缺失是阻塞，不是降级

`generate` 需要本包自带的 `tools/cypher`（纯 Python，没有外部依赖）。
真实图库导入走可选适配器——本地没有图库时，`conformance` 那一步只做静态检查。

**如实说**：说"Cypher 静态检查通过，本机没有图库，没有做真实导入验证"，
不要说"一致性检查通过"。后者让人以为验证过了两件事，而实际只验证了一件。

`python3 <pkg>/scripts/doctor.py` 报这台机器分阶段能跑什么。
