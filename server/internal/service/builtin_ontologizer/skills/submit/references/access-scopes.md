# Access Scope 声明

来自流程 §12.3（八条 RFC）与附录 G。产出 `releases/rel-NNNN/access-scopes.yaml`，
模板在 `templates/access-scopes.yaml`。

## 一句话：它声明边界，不授予权限

这是这份文档的全部要点，其余都是它的推论。

Scope 说的是"这一组受治理的资源属于同一个边界"。谁能访问这个边界，
由外部平台的 principal assignment 决定，不由这个文件决定，
也不由这个包的任何地方决定（`shared/decision-points.md` 的 `not_recorded_here`）。

文件里必须原样带这句话，一个字都不能改：

```
Access scopes define governed resource boundaries. They do not grant access to users or groups.
```

`scopes_cover_or_unscoped` 会在 `warning` 字段里找 "do not grant access"。
它存在的理由是：这个文件长得很像一个权限配置，看的人会自然地按权限配置去理解它，
除非页面上明写着它不是。

## 绝对不能出现的键

`scopes_no_principals` **递归扫整个文件**，命中就阻断：

`users` `user` `groups` `group` `roles` `role` `entitlements` `entitlement`
`assignments` `assignment` `grants` `grant` `principals` `principal`
`members_users` `acl` `alice_roles`

嵌在第三层里也会被抓到。写 `accountable_owner: OO1` 可以——那是问责人，不是被授权人；
写 `roles: [controller]` 不行，哪怕只是备注。要说明"这个 scope 大致给谁看"，
写进 `description` 的自然语言里，不要做成结构化的键。

## 覆盖：每个声明要么有主，要么被点名

`scopes_cover_or_unscoped` 拿 candidate 里所有 **access-relevant** 的声明来对：

**算的**：entity、relationship、attribute、event、lifecycle、metric、capability、binding。
**不算的**：constraint、policy——它们是关于资源的规则，不是资源本身。

每个 access-relevant 声明必须出现在某个 scope 的 `member_declaration_ids` 里，
或者出现在**顶层**的 `intentionally_unscoped` 列表里。

注意是顶层 `intentionally_unscoped`，不是附录 G 里那个
`intentionally_unscoped_declarations`——检查读的是前者。两个都写也行，
但只有顶层那个算数。

**"漏了"和"故意不管"必须能分开。** 一个没被任何 scope 覆盖的声明，
在治理评审时是一个问号：是忘了，还是有意的？`intentionally_unscoped` 就是那个答案，
所以列进去的每一条都该有个理由（写在 `intentionally_unscoped_rationale` 里，
检查不管，但人要看）。

## 至少两个 scope

`scopes_cover_or_unscoped` 硬性要求 ≥2。理由是：一个 scope 等于没有 scope——
它没有划出任何边界，只是把整个 bundle 换了个名字。

每个 scope 五个必填字段：`scope_key`（bundle-local，稳定）、`display_name`、
`description`、`accountable_owner`、`lifecycle_status`。

`scope_key` 稳定的意思和对象 id 一样：改展示名不换 key。
已发布 release 里的 scope 身份与成员是**不可变的**（流程 §12.3-5）——
要变就产生一个后继 release，以及一份 authorization-impacting semantic diff。

## 成员用稳定 id，digest 必须对得上

`scope_refs_resolve` 查三件事：

1. 每个 `member_declaration_ids` 里的 id 是候选 revision 里真实存在的声明 id；
2. 每个 `cross_scope_references[].declaration_id` 也能解析；
3. `membership_digest` 与成员列表算得上。

digest 的算法：**每条成员关系一行 `scope_key<TAB>声明 id`**，排序，换行连接，取摘要。

```python
import sys; sys.path.insert(0, "<pkg>")
from tools.validators.process_checks import membership_digest
pairs = [f"{s['scope_key']}\t{m}" for s in doc["scopes"] for m in s["member_declaration_ids"]]
doc["membership_digest"] = membership_digest(pairs)
```

带上 scope_key 是有意的：一个只把 id 摊成一堆的摘要，分不出「从 A 挪到了 B」
和「什么都没动」——而那次挪动正是治理审阅要抓的东西。

**digest 对不上不是格式问题，它的意思很具体：成员在批准之后被改过。**
所以每次改成员都要重算，而重算意味着之前那次 `access_scope_review` 的批准失效了。

## 预览什么

`scopes` 步骤在开决策点之前要摆出四样（流程 §12.3-4）：

| 预览项 | 怎么算 | 为什么要看 |
|---|---|---|
| **覆盖** | access-relevant 声明总数 / 已覆盖 / unscoped | 有没有漏 |
| **重叠** | 出现在两个以上 scope 里的成员 | 只有治理政策允许时才可以存在 |
| **跨 scope 引用** | 关系的两端落在不同 scope | 一端可见另一端不可见时会漏信息 |
| **分类字段暴露** | 成员里 `classification` 非 internal 的属性 | financial、pii 之类的字段落在哪个边界里 |

四项都要报数字，并写出处（哪个 release、哪个 revision 算的）。
**空的也要报**：没有重叠、没有跨 scope 引用，都是结论。

## 怎么起草

默认按业务子域切，不按对象类型切。"总账核心"和"冲销"是两个边界；
"所有实体"和"所有关系"不是——后者会让每条关系都变成跨 scope 引用。

分组呈现，给整组建议让人改例外（和 `review` 的大图呈现同一条规矩）：

> 两个 scope，覆盖 9 个 access-relevant 声明中的 9 个，unscoped 0 个。
> `gl_core`（5）：分录、期间与它们的属性。
> `gl_reversal`（4）：冲销分录、reverses 关系、审批事件、生命周期。
> 重叠 0 项；跨 scope 引用 1 条（`rel.reverses` 从 gl_reversal 指向 gl_core 的
> `ent.journal_entry`）；分类字段暴露 1 项（`attr.journal_entry.amount`，financial，在 gl_core）。
> 这条跨 scope 引用和那个 financial 字段，你要不要调整边界？

然后开决策点 `access_scope_review`（OE/OO/GA，OO 负责）。
