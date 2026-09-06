# restore · 向前复制，不是回退

```bash
python3 <pkg>/scripts/revision.py restore <ws> r0002 --by OE
```

它把 r0002 完整复制成一个新的 rNNNN，parent 指向当时的 HEAD，
`reason: restore_from r0002`，状态回到 running。**r0002 本身一个字节都不动。**

流程 §15.1 的原话是"Restore as HEAD 创建新的 HEAD，而不是覆盖历史"。
理由不是洁癖：一旦某个版本可以被覆盖，追溯链上任何一环都不再可信，
而追溯链是审阅、评估、提交三件事共同的依据。

## 复制出来的那一版不会自动成为 HEAD

新版本状态是 running。要成为 HEAD，得重新过一次机器门：

```bash
python3 <pkg>/scripts/revision.py seal <ws> r0006
```

## 一件必须知道的事

复制出来的版本连同来源的 `revision.yaml` 一起带过来了，里面记着**来源那一版**的
输入摘要和产物摘要。`seal` 会重建追溯索引（索引里带新的版本号和构建时间），
再拿它跟复制过来的旧摘要比——于是第一次 seal 往往报 `reproducible` 未过：

```
r0003 sealed · gate_failed · 未通过：reproducible
     trace-index.yaml: 内容与记录的 digest 不一致
```

**这不是可以手工绕过的。** 不要去改 `revision.yaml` 里的摘要值让它变绿——
那是在伪造"这一版可重现"的记录，而 `reproducible` 存在的全部意义就是它没被人手写过。

正确的路是：restore 给你一个可写的工作副本，接着交给 `revise` 重跑受影响的阶段，
让产物和记录一起被重新写出来，再 seal。restore 单独用只有一个场景——
把某一版的内容捞回来看看，看完不 seal。

## 什么时候该用 restore

- 新版本越改越差，想回到 r0002 的形态重新出发。
- 某次生成失败或被取消，要拿一个已知能过门的版本当基线。

什么时候不该用：想"撤销"一个已经记进决策日志的裁决。撤销的方式是再记一条裁决，
不是把版本恢复回去装作没发生。
