# status · next · history

## 一条命令，四段输出

```bash
python3 <pkg>/scripts/state.py status <ws>
```

它每次都对着磁盘重算，没有进度文件可读。记下来的状态会和交付物分叉，推导出来的不会。

真实输出长这样：

```
项目 journal-reversal · 阶段 ready_for_review
  r0004 等待审阅

revision:
  r0001  gate_failed        首次生成  未过：relationship_declared, reproducible
  r0004  ready_for_review   HEAD      restore_from r0002

等你决定：
  · 证据是否足够待决（evidence_sufficiency，DE 拍板；系统不替你判断）
  · r0004 等待四层审阅（review）

问题：
  !! decision_logged: define/evidence-snapshots: 产物已存在，但 decisions.log 里没有
     evidence_sufficiency 的裁决——决策先写日志再改状态

下一步：review —— 四层四轮逐项审阅
```

## 你要做的加工，和不能做的加工

**可以**：把阶段名换成人话（`ready_for_review` → "r0004 已经过了机器门，等你审"）；
把"等你决定"里的决策点补上该谁拍板；把「问题」里的检查项名字后面补一句这条检查在防什么。

**不可以**：改写「问题」的任何一行。每一行都来自一次真实的重算，照抄。
一旦转述，"封存的版本被改动过"会变成"历史看起来有点乱"，然后没人再去查它。

**不可以**：凭记忆补充问题。上一轮对话里见过的问题，这一轮要重新跑出来才算数。

## 九个推导阶段

| 阶段 | 什么条件下推出来 | 谁接手 |
|---|---|---|
| `uninitialised` | 没有 `ontologizer.yaml` | orchestrator init |
| `initiated` | 有项目记录，还没有证据快照 | initiate → evidence |
| `defining` | 有证据快照，但证据充分性未决或八项 readiness 还有没二值化的 | evidence / interview |
| `generating` | 有版本处于 running | generate |
| `ready_for_review` | HEAD 已过机器门且还没有审阅记录 | review |
| `in_review` | HEAD 有审阅记录但还有对象没结论 | review |
| `revision_pending` | 审阅已二值化，还有变更请求没落地 | revise |
| `candidate_selected` | 某一版被选为候选发布 | submit |
| `submitted` | 某个发布下已有 PR 记录 | 平台侧 |

条件按顺序求值，第一个成立的就是当前阶段。权威定义在 `shared/manifests/stages.yaml`
的 `derived_phases`，不要背，需要时读它。

## next

同一条命令，只是把话说少。三句：现在在哪 / 下一步做什么 / 它需要你什么。
如果「等你决定」非空，下一步就是那件事——人的裁决排在机器活儿前面，
因为后面每一步都要引用它。

## history

历史有两条线，一起念：

```bash
cat <ws>/history/decisions.log       # 人的判断，只追加，一行一条
python3 <pkg>/scripts/state.py status <ws>   # 版本线：谁是 HEAD、哪些没过门
```

决策日志的字段顺序是 `时间|决策点|角色|裁决|对象|理由`。
念的时候把决策点换成它的中文标题，把角色展开（DE = 领域专家），把理由原样带上——
理由那一栏是半年后唯一能解释这个决定的东西。

同一个决策点出现多行是正常的：改主意的方式是再记一行，不是改旧的那行。
念历史时按时间顺序全念，并指出哪一条是当前生效的（最后一条）。
