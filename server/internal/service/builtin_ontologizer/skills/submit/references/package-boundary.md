# 提交包的边界

来自流程 §12.4。这张表是硬的，`package_excludes_raw` 按路径子串匹配来执行。

| 包含 | 排除 |
|---|---|
| Candidate bundle | Raw evidence |
| Migration material | Samples（样例数据） |
| Submission manifest | Transcripts（访谈记录） |
| Generation report | Detailed logs |
| Canonical scope declarations | Local history |
| `GOVERNS_DECLARATION` membership | Principals、roles、entitlement assignments、runtime grants |

## 排除是按路径子串匹配的

`package_excludes_raw` 遍历 `releases/rel-NNNN/package/` 下每个文件，
把相对路径转小写，命中下面任一子串就阻断：

```
raw evidence · inputs/evidence · evidence-snapshots · extractions · transcripts
interview-state · samples · history/runs.jsonl · revisions/runs · decisions.log
principals · entitlement
```

所以文件名本身就要干净。把访谈记录改名叫 `notes.yaml` 塞进去，检查抓不到——
**但那不是绕过了检查，那是把它骗过去了。** 检查是最后一道网，不是边界的定义；
边界的定义是上面那张表。

包是空的也算失败。

## 为什么排除这些

不是保密洁癖，三条各自不同的理由：

**Raw evidence、samples、transcripts** —— 它们是客户的原始材料，
可能含个人信息、可能有授权范围限制、体积也不合适。提交包送进平台治理，
读它的人是治理审批人，不是领域专家；他要判断的是这个 bundle 的语义和边界，
不是重新做一遍抽取。

**Detailed logs、local history** —— `history/decisions.log` 与
`revisions/runs/` 是审计线索，属于工作区，不属于发布物。
它们留在本地是好事；跟着 PR 走出去就变成了一份谁都能读的内部记录。

**Principals、roles、entitlements、grants** —— 这一条最要紧。
本包从头到尾不创建它们（`scopes_no_principals`），所以包里出现这类东西，
说明有人手工往里放了不该放的东西。授权属于外部平台。

## 包里该有什么

最小形态：

```
releases/rel-0001/package/
├── candidate.yaml          候选 bundle
├── candidate.cypher        openCypher 投影
├── migration.md            Patch 的 append-only packet，或 Version 的全量说明
├── generation-report.md    假设、警告、各阶段结果、版本
├── access-scopes.yaml      canonical scope 声明与 membership
└── submission-manifest.yaml
```

`generation-report.md` 值得单独说一句：它带着未解决的 assumption 和 warning。
**这些恰恰是治理审批人最该看到的东西**，所以它在包里，
而产生它的日志不在。

`readiness-checklist.md` 放在 `releases/rel-NNNN/` 下即可，不必进 package——
它是给本地评审用的，PR 的 body 里放摘要。

## Manifest 与预览一致

`submission-manifest.yaml` 记 `package_files`（包里每个文件的相对路径）、
`preview_digest`、`membership_digest`、`candidate_revision`、`selection`、
`target_repository`。

`pr_matches_preview` 查两件事：

1. `pr.yaml` 的 `preview_digest` 等于 manifest 里的那个；
2. `pr.yaml` 的 `changed_files` 与 manifest 的 `package_files` 逐项相同（排序后比）。

**人批的必须就是发出去的。** 预览之后又往包里加了一个文件，
这两项立刻对不上——那正是它存在的意义。要改就重新预览、重新批准，
不要改 manifest 让它对上。

## 预览怎么摆

`preview` 步骤不是给个摘要，是把人要批的东西完整摆出来：

1. **目标**：repository、base 分支、commit。
2. **changed files**：逐个列出来，带大小。这是包的全部内容，不长。
3. **PR title 与 body**：原文，不是概述。
4. **两个 digest**：`preview_digest` 与 `membership_digest`，写清楚各自是什么算的。
5. **排除确认**：raw evidence、samples、transcripts、logs、local history 已排除——
   这一条也要说出来，因为它是 GA 要在检查表上勾的一项。

然后才问 `create_pull_request`。这是整条流程唯一的强制人工批准，
`create_pull_request` 的 `requires_checks` 是
`package_excludes_raw`、`pr_matches_preview`、`checkout_clean`、`patch_version_human`——
四项不过就记不下这条裁决。
