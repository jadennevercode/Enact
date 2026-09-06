# Submission Readiness 检查表 · rel-0001

> 流程附录 H。脚本能判的由脚本勾，判不了的（标 **H**）留给人——
> 一张全靠手工勾的表，勾的是"我记得应该没问题"。
> 每个数字带出处：哪个 revision、哪个 release、哪一次检查算的。

- Release: rel-0001
- Candidate revision: r0003
- 生成时间: 2026-09-03T17:20:00+08:00

## Candidate 与验证

- [x] Candidate generation 完成。（`r0003/revision.yaml.status == ready_for_review`）
- [x] Cypher generation 完成。（`cypher_generated_and_parses`，9 个声明）
- [x] 所有 mandatory 检查项通过。（`ready_for_review` 门，9 项检查）
- [ ] Managed graph import 成功。 **N/A —— V1 无图运行时，本机未配置适配器，未执行。**
- [x] Conformance validation 成功。（`tools/cypher` 静态检查通过）
- [ ] **H** Warnings 和 assumptions 已确认。
      未解决项 2 条，见 `r0003/generation-report.md`：
      asm.001 金额口径按本位币不含税；软关账冲突 cg.softclose 未裁决。
      确认人：______  确认时间：______

## Revision 与评估

- Selected candidate revision: r0003（`releases/rel-0001/selection.yaml`，OO1 选定）
- [ ] **H** Semantic diff 已审阅。
      `r0003/semantic-diff.yaml`：新增 1、删除 1、变更 1、未受影响 7。
      审阅人：______  审阅时间：______
- Evaluation run: `evaluation/runs/ev-0002.yaml`（绑定 r0003）
      —— 没跑评估就写 `none`，不要留空。
- Failed/Unsupported CQ rationale:
  - cq.002 **failed** —— evt.reversal_approved 缺审批人参与者，已开 chg.002。
  - cq.001 **unsupported** —— 契约缺口：软关账能否冲销尚未裁决，模型不承诺未裁决的规则。
  - cq.004 **unsupported** —— 环境缺口：本机无图适配器，graph-answer test 未执行。
  - （评估不阻断提交，但结果要跟着走到 PR 边界。）

## 版本决定

- Selection: **Patch**（`releases/rel-0001/patch-or-version.yaml`）
- Human decision owner: OO1，角色 OO
- Rationale: constraint 转 policy 有 replaced_by，下游可改指；本季度无全量升级窗口。
- Target version: 1.1.0
- [ ] **H** Migration material 已审阅。
      `package/migration.md`；append-only 写不出 constraint → policy 这条替换。
      审阅人：______

## Access Scopes

- [x] Stable identities 和 declaration references 已验证。（`scope_refs_resolve`，9 个成员）
- [ ] **H** Covered、uncovered、overlapping、classified、cross-scope surfaces 已审阅。
      覆盖 9/9，unscoped 0，重叠 0，跨 scope 引用 1（`rel.reverses` → `ent.journal_entry`），
      分类字段暴露 1（`attr.journal_entry.amount`，financial）。
      审阅人：______
- [x] 每个 access-relevant declaration 已覆盖或 intentionally unscoped。（`scopes_cover_or_unscoped`）
- [x] Membership changes 和 digest 已审阅。（digest 由 `scope_refs_resolve` 验；变更 0 项）
- [x] 未写入 users、groups、roles、entitlements 或 runtime grants。（`scopes_no_principals`）

## Package 与治理

- [ ] **H** Target repository、base 和 commit 已审阅。
      `~/repos/ontology-bundles` · `main` · `4f2a9c1`。审阅人：______
- [x] Changed files 和 PR title/body 与 preview 一致。（`pr_matches_preview`，6 个文件）
- [x] Raw evidence、samples、transcripts、detailed logs、local history 已排除。（`package_excludes_raw`，6 个文件）
- [x] Checkout clean 且无 conflict。（`checkout_clean`）
- [ ] **H** Create pull request 已显式批准。
      整条流程唯一的强制人工批准。批准之后 `history/decisions.log` 里有这一行：
      `<时间>|create_pull_request|GA|approve|rel-0001|<理由>`
