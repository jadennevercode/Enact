---
step: data-request/build                # 固定值
skill: data-request
generated: "2026-08-08T17:10:00+08:00"  # 生成时间，带时区
grounding:                              # 只读这两份：因子树和项目档案
  - { path: "artifacts/s1/factor-tree.yaml", chars: 11200, truncated: false }
  - { path: "artifacts/s1/project-profile.yaml", chars: 1840, truncated: false }
knowledgeRecall: none                   # 这一步不召回知识，永远是 none
acceptedDrivers: 87                     # 被采纳的驱动因子行数（不含响应行）
requested: 87                           # 其中被请求到的行数
missing: 0                              # 被采纳但没被请求的行数 —— 不为零就不许过
orphanSheets: 0                         # 一个指标都没有的表 —— 不为零就不许过
responseRequested: true                 # 响应指标在不在这份需求里 —— false 就不许过
counts:
  workbooks: 17
  noUnit: 4                             # 没声明单位的行数
  noOwner: 9                            # 没有对接人的行数
slots:                                  # 回收对账表：每册该回来哪些表、共多少指标。
                                        # 这是发和收之间唯一的耦合点，规则见
                                        # ../references/sheet-names.md
  - workbook: 消费者需求驱动-品牌广告-品牌传播.xlsx
    l3: "消费者需求驱动 / 品牌广告 / 品牌传播"
    expectedSheets:                     # 实际写进文件的表名（已过 31 字符截断与去重）
      - Digital Display
      - TV
    expectedIndicators: 10
---

<!-- 数据需求覆盖报告 —— 这份文件由工作簿应用生成，不要手写、不要手改。
     产出到 artifacts/s1/data-request/coverage.md。
     这份模板是它的形态说明：每个字段是什么、哪几个字段是检查项在读的。
     数字对不上，去改因子树然后重新生成；改这里只会在下一次生成时被覆盖掉。
     生成命令：~/.local/bin/mmm app workbook data_request --workspace <工作区> -->

# Data request coverage

Granularity **Month** · reported by Brand, Channel, Geo

<!-- 每册一行：文件名、它对应的 L3、几张表、几个指标。 -->

| Workbook | L3 | Sheets | Indicators |
|---|---|---|---|
| 消费者需求驱动-品牌广告-品牌传播.xlsx | 消费者需求驱动 / 品牌广告 / 品牌传播 | 5 | 10 |
| 00-response.xlsx | Response (the model's Y) | 1 | 1 |

Every accepted factor row is requested exactly once.

<!-- 树里没有响应行时，这里插入的是一段固定告警，而不是上面这句：
     "**No response indicator is requested.** … Fix the tree, not this file."
     修的是树，不是这份文件。 -->

<!-- 有被采纳但没被请求的行时，多出一段 `## Accepted rows not requested`，逐行列出。
     这一段出现就意味着不许发：那几行的 L3/L4 分组是空的或者写坏了。 -->

## Rows the client cannot act on yet

<!-- 缺定义 / 单位 / 对接人的行。不硬拦，但必须在签收时呈现出来。 -->

| Row | Indicator | Missing |
|---|---|---|
| f-0031 | 社媒活动声量 | unit, owner |
| f-0044 | 冰柜投放个数 | definition |

Fix these in the factor tree, then rebuild. A number with no declared unit is the
one that gets summed with something incompatible later.

## Sheet names the returned files are matched on

<!-- 收数时按这些表名去认。四级打分：完全相同 / 互为前缀（吸收 31 字符截断）/
     被包含 / 包含。规则与实现见 ../references/sheet-names.md -->

| Workbook | Sheets expected back | Indicators |
|---|---|---|
| 消费者需求驱动-品牌广告-品牌传播.xlsx | Digital Display · TV | 10 |
| 00-response.xlsx | response | 1 |

A returned sheet is scored against these names on four levels — exact, either-way
prefix (which absorbs Excel's 31-character truncation), contains, contained.
Renaming a sheet on the way back is survivable; deleting one is not.
