---
name: submit
description: 把已选定的 candidate revision 送进治理：起草 Access Scope 声明（稳定 bundle-local key、owner、生命周期状态，成员用稳定 declaration id 不用标签，预览覆盖 / 重叠 / 跨 scope 引用 / 分类字段暴露，每个 access-relevant 声明要么属于某个 scope 要么显式 intentionally_unscoped，文件里绝不出现 users / groups / roles / entitlements / grants），请人显式选择 Patch（minor，append-only migration）还是 Version（major，全量 bundle），填就绪检查表，打 package（排除原始证据、样例、访谈记录、日志、本地历史与主体），预览与 PR 逐字一致之后由人做**整条流程唯一的强制批准** Create pull request；checkout 是 dirty / diverged / conflicted 就停下转 expert handoff，绝不强制重置用户的工作。另有独立的 handoff 模式导出脱敏交接包。用于"准备提交""建 access scope""这算 Patch 还是 Version""出 PR""打个包给治理评审""导出给本体工程师接手""checkout 脏了怎么办"这类请求。Patch/Version 只摆证据不给推荐。
---

# Submit · 提交与治理

交付物都在 `releases/rel-<NNNN>/` 下：`selection.yaml`、`access-scopes.yaml`、
`patch-or-version.yaml`、`readiness-checklist.md`、`submission-manifest.yaml`、
`package/`、`pr.yaml`；另有 `exports/` 里的交接包。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `scopes` | C→H | 起草 scope 声明，预览覆盖/重叠/跨引用/分类暴露；决策点 `access_scope_review` |
| 2 | `patch-or-version` | H | 决策点 `patch_or_version`。**只摆证据，不给推荐** |
| 3 | `readiness` | S | 填附录 H 检查表（`templates/readiness-checklist.md`） |
| 4 | `package` | S | 打包，排除清单见 `references/package-boundary.md` |
| 5 | `preview` | C | 把 changed files、title/body、digest 完整摆出来给人看 |
| 6 | `create-pr` | H | 决策点 `create_pull_request`——**整条流程唯一的强制人工批准** |

独立模式 `handoff`：导出脱敏交接包到 `exports/`，走 `handoff_redacted` 扫描。
什么时候必须转 handoff，见 `references/expert-handoff.md`。

开工先记 `selection.yaml`：`candidate_revision`、`selected_by`、`rationale`。
没有它，`scope_refs_resolve` 不知道拿哪一版的声明去解析成员。

## Access Scope：声明边界，不授予权限

`access-scopes.yaml` 里**绝不能出现** users、groups、roles、entitlements、
assignments、grants、principals 这些键（`scopes_no_principals`，它递归扫全文件，
嵌在第三层里也会被抓到）。principal assignment 与运行时放行属于外部平台，不由本包记录。

文件必须原样带这句话，一个字都不能改（`scopes_cover_or_unscoped` 查它）：

```
Access scopes define governed resource boundaries. They do not grant access to users or groups.
```

三条硬要求：

- **至少两个 scope**，每个有 `scope_key`、`display_name`、`description`、
  `accountable_owner`、`lifecycle_status`。
- **每个 access-relevant 声明**（entity / relationship / attribute / event /
  lifecycle / metric / capability / binding）**要么是某个 scope 的成员，
  要么在顶层 `intentionally_unscoped` 里被点名**（`scopes_cover_or_unscoped`）。
  constraint 与 policy 是关于资源的规则，不是资源，不算 access-relevant。
- **成员用稳定 declaration id**，不用 label、不用画布位置；
  `membership_digest` 必须和成员列表算得上（`scope_refs_resolve`）。
  digest 对不上的意思很具体：**成员在批准之后被改过**。

起草方法、重叠与跨引用怎么预览，见 `references/access-scopes.md`。

## Patch/Version：这一个不给推荐

**其他所有决策点都给"候选 + 推荐 + 后果"。这一个只给证据**——
semantic diff、authorization-impacting 变更清单、migration 材料。

理由在 `shared/decision-points.md`：流程 §12.2 与 §19.2 写死了 Ontologizer
不自动判断 semantic impact，也不自动选择 Patch/Version。给出推荐等于替人做了这个判断，
而人会点同意；这个判断的后果——下游消费者要不要改——只有他知道。

`patch_version_human` 查 `decided_by: human`，外加 `rationale`、`target_version`、
`decided_at`。两个选项各自意味着什么，见 `references/patch-vs-version.md`。

**连倾向性措辞都不要。** 一句"看起来是兼容的"就足以让人不再自己判断。

## Package 与预览

排除清单是硬的（`package_excludes_raw`，按路径子串匹配）：原始证据、
evidence-snapshots、extractions、样例、访谈记录、详细日志、`revisions/runs/`、
本地历史、`decisions.log`、principals 与 entitlement。包含什么、为什么这么切，
见 `references/package-boundary.md`。

`pr_matches_preview` 查两件事：`pr.yaml` 的 `preview_digest` 等于
`submission-manifest.yaml` 里记的那个；`changed_files` 和 `package_files` 逐项相同。
**人批的必须就是发出去的。** 预览之后又改了一个字，就重新预览、重新批准。

## checkout 脏了就停

`checkout_clean` 报 dirty / diverged / conflicted 或有意料之外的本地提交时，
**停止提交，转 expert handoff**。不强制重置、不 stash、不 `--force`——
系统不动用户的工作，哪怕用户说"你直接重置吧"：那些改动可能是别人的。

## 记录三个裁决

```bash
python3 <pkg>/scripts/state.py decide <ws> --point access_scope_review --verdict approve --role OO --object rel-0001 --rationale "..."
python3 <pkg>/scripts/state.py decide <ws> --point patch_or_version    --verdict patch   --role OO --object rel-0001 --rationale "..."
python3 <pkg>/scripts/state.py decide <ws> --point create_pull_request --verdict approve --role GA --object rel-0001 --rationale "..."
```

`decision_logged` 反过来查：产物在而日志里没有对应裁决，就是有人先改了状态再补记录。
**决策先写日志再改状态。**

## 取材范围

| 可以读 | 为什么 |
|---|---|
| `revisions/**` | 候选版本的声明、diff、检查结果 |
| `releases/**` | 本次与历史 release |
| `evaluation/**` | 就绪检查表要附 failed/unsupported 的 rationale |
| `history/**` | 裁决记录、未闭环的变更请求 |

## 这个 Skill 不做什么

- **不选候选版本。** 那是 `revise` 的 `candidate_selection`。
- **不替人判 Patch/Version，不给推荐、不给倾向。**
- **不创建 ACL、role、entitlement 或 grant。** 本包只声明受治理资源边界。
- **不重置、不 stash、不强推用户的仓库。**
- **不因为评估有 failed 就拦住提交。** 评估永不阻断（`evaluate`）。
- **不改 revision。** 要改就回 `revise` 出新版本，再重新选候选。
