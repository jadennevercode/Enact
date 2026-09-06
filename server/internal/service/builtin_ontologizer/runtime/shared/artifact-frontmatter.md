# 交付物的元信息块

每份 YAML 交付物顶部带一个 `meta:` 块。它回答三个问题：**这份东西是谁在什么版本下写的、
它读了什么、里面的数字从哪次运行来。**

```yaml
meta:
  produced_by: evidence            # 哪个 Skill
  step: confirm                    # 哪一步
  produced_at: 2026-09-03T14:20:00+08:00
  pins:                            # 来自 ontologizer.yaml，出问题时用来复现
    spec_version: "0.2"
    skill_pack_version: 0.1.0
    model: claude-opus-5
  read:                            # 实际读了什么，不是允许读什么
    - inputs/evidence/process-general-ledger-ch6.md
    - inputs/evidence/reversal-policy-v4.md
    - define/project-charter.yaml
  truncated:                       # 只读了一部分的，逐条说明
    - path: inputs/evidence/journal-entries-sample.csv
      read: 前 6 行
      why: 样本文件，只需要看列结构与取值形态
  numbers_from:                    # 文中每个计数、比例、digest 的出处
    - revisions/r0002/validation/trace_complete.json
  network:                         # 联网取材，URL 与访问日期缺一不可
    - url: https://example.org/ifrs/reversal
      accessed: 2026-09-03
```

## 为什么

**读了什么要如实申报。** 一个越界去捞材料的步骤，产出的东西人没看过依据；
一个只读了半份材料却不说的步骤，产出的东西人以为看过全部依据。两种都让确认失去意义。

**截断要留痕。** 大文件只读一部分是正常的、常常也是对的。不正常的是不说。

**数字要有出处。** 交付物里任何一个计数、比例、覆盖率、digest 都来自一次真实运行，
不由模型写。说不出出处的数字就不写——这是 `shared/conventions.md` 第 5 条说话规矩的落法。

## 什么时候可以省

`revisions/rNNNN/` 里的产物不需要 `meta:`：`revision.yaml` 已经记了 pins、
输入 digest、产物 digest 和检查结果，再写一遍是两份会打架的记录。

其余交付物（章程、证据 manifest、FAGC 登记、访谈状态、模型卡、审阅记录、
CQ 登记、评估运行、release 下的文件）都带。
