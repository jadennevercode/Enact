# Expert handoff

流程 §12.5。触发之后**停止提交**，把材料整理成交接包交给本体工程师（OE）。

## 什么时候必须转

| 触发条件 | 来源 | 怎么发现 |
|---|---|---|
| checkout 是 dirty、diverged、conflicted，或有意料之外的本地提交 | [RFC] | `checkout_clean` |
| 认证失败 | [RFC] | `gh` / `git` 报错 |
| Schema 不兼容 | [RFC] | 平台侧拒绝，或 manifest 与目标 bundle 结构对不上 |
| 事务性刷新无法安全完成 | [RFC] | 平台侧 |
| 重大语义冲突 | [RFC→METH] | 审阅记录里有互相矛盾的 reject / accept |
| 无法解释的跨 scope 依赖 | [RFC→METH] | scope 预览里的跨引用讲不清楚 |
| Migration 不可判定 | [RFC→METH] | append-only 写不出来，且 Patch/Version 也定不下来 |
| Validator 反复失败 | [RFC→METH] | 同一个 blocking 检查项修了两三轮还是不过 |

前四条是硬的、机器能报的；后四条是判断，由人或你提出来。

## 绝不做的事

**不重置、不 stash、不 `--force`、不 `--hard`。**

`checkout_clean` 的 `on_failure` 写着：停止提交，转 expert handoff，
系统不会强制重置用户的工作。这条没有例外，**包括用户说"你直接重置吧"的时候**——
那个目录里的未提交改动可能是他同事的，可能是他自己昨天忘了提交的，
也可能就是他随口一说。丢掉之后没有任何办法找回来。

正确的回应是把状态摆清楚，把选项给他：

> `~/repos/ontology-bundles` 有 3 个未提交改动，且落后上游 2 个提交。
> 提交停在这里。
>
> - 你自己去处理那个 checkout（提交、stash 或者换一个干净的克隆），处理完我再跑一遍；
> - 或者我出一个交接包，你把它交给本体工程师，让他在他的环境里提交。
>
> 我不会替你重置——那些改动我看不出是谁的。

## 交接包里放什么

`handoff` 模式导出到 `exports/`。内容按提交包的边界来
（`package-boundary.md`），加上诊断需要的东西：

```
exports/handoff-rel-0001/
├── candidate.yaml              候选 bundle
├── candidate.cypher
├── semantic-diff.yaml          相对 parent
├── access-scopes.yaml
├── generation-report.md        未解决的 assumption 与 warning
├── validation-summary.json     每个检查项的结果与诊断
├── blocked-on.md               为什么停下来：触发条件、已试过什么、卡在哪
└── README.md                   接手的人第一步该做什么
```

**`blocked-on.md` 是这个包的核心。** 其余文件本体工程师自己能读；
"为什么停下来、已经试过什么"只有你知道。写三段：触发的是哪一条、
在什么情况下发现的、已经排除了哪些可能。

不放的：原始证据、样例、访谈记录、`history/`、`revisions/runs/`。
和提交包同一条边界——交接不是"把工作区打个包发过去"。

## 导出前必须脱敏

`handoff_redacted` 扫 `exports/` 下每个文本文件，四类模式：

- `api_key` / `secret` / `password` / `token` 后面跟着值；
- 带口令的连接串（`postgres://user:pass@host`）；
- `sk-` 开头的密钥；
- PEM 私钥块。

命中就阻断，报文件名加行号。**先脱敏再导出**——
一旦导出了，这个文件就可能已经被发到别处去了，事后删除没有意义。

最容易命中的是 `blocked-on.md`：写"连不上，连接串是 xxx"的时候顺手把口令贴了进去。
写成 `postgres://<redacted>@db.internal/gl` 就好。

## 转了 handoff 之后

不要把它记成失败。在 `pr.yaml` 不存在的情况下，`state.py status` 推导出的阶段
仍然是 `candidate_selected`——这是准确的：候选选定了，提交没做完。

记一条裁决说明为什么转（用 `create_pull_request` 的 `reject` 裁决，
`--rationale` 写触发条件）。以后有人问"这个 release 为什么没提交"，
日志里有答案。
