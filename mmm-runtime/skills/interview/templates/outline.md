---
step: interview/outline                 # 固定值，不要改
skill: interview
generated: ""                           # 生成时间，带时区
grounding:                              # 读过的每份材料，一份一条，字数必须是真的
  - { path: "artifacts/s1/factor-tree.yaml", chars: 0, truncated: false }
  - { path: "artifacts/s1/project-profile.yaml", chars: 0, truncated: false }
  - { path: "artifacts/s1/knowledge-package.md", chars: 0, truncated: false }
  - { path: "artifacts/s1/materials-index.md", chars: 0, truncated: false }
  - { path: "inputs/org-structure/<文件名>", chars: 0, truncated: false }
  - { path: "knowledge/methodology/interview-framework.yaml", chars: 0, truncated: false }
  # 数据题那一段是套模板生成的，产出时不经过判断，读它也不经过判断。
  # 按 conventions §7：照实标 truncated，chars 只算真正被读进判断的部分。
knowledgeRecall: none                   # 用了行业题库就写 kb:<行业锚点>@<版本>，没用就 none
counts:
  targets: 0                            # 访谈对象节数
  businessQuestions: 0                  # 业务题数
  dataQuestions: 0                       # 数据题数 = 4 × 去重后的因子行数，算出来的
  questions: 0                          # 两者之和
assumed: []                             # 没问到人、按推荐项走的澄清点，逐条写清楚理由
---

<!-- 访谈提纲 —— 照这份填，不要自创结构。
     产出到 artifacts/s1/interview/outline.md。
     写法与出题来源见 ../references/outline.md。
     题号 Q<n> 是跨文件主键：预答、纪要、改动建议都按它对齐，全文不许重号。

     这份 Markdown 是真相。客户拿到手的是它渲染出来的 Word：
       ~/.local/bin/mmm app report interview-outline -w <工作区>
     Word 里改的东西下次重新生成就没了，要改改这里。 -->

# 访谈提纲

<!-- 一句话交代这份提纲要解决什么：因子树上哪几处只有客户能回答。 -->

## 访谈对象一览

<!-- 这张表是客户拿去排会的东西。参与人和档期留空给客户填，不要替他们编。 -->

| 层级 | 团队 | 时长 | 题数 | 参与人 | 建议档期 |
|---|---|---|---|---|---|
| 高层 | | 60 分钟 | | | |
| 管理层 | | 60 分钟 | | | |
| 执行层 | | 90 分钟 | | | |
| 数据团队 | | 90 分钟 | | | |

<!-- 时长是查表来的，不是估的：高层/管理层 60 分钟，执行层/数据团队 90 分钟。
     「数据团队」这一层是从因子树派生出来的，客户组织图上不一定有这个名字；
     没有独立数据团队时，把数据题按 L3 拆进对应的执行层团队那一节。 -->

## 高层 · <团队名>

<!-- 每一节的抬头四件事：层级、团队、时长、题数。一节一个访谈对象。 -->

**时长 60 分钟 · 本节 N 题**

- Q1 <问题原话> [factor: f-0001]
  - **追问：** <不问会怎样；答不上来的题不该出现在提纲里>
- Q2 <问题原话> [factor: f-0002]
  - **追问：** <…>

## 管理层 · <团队名>

**时长 60 分钟 · 本节 N 题**

- Q3 <问题原话> [factor: f-0003]
  - **追问：** <…>

## 执行层 · <团队名>

**时长 90 分钟 · 本节 N 题**

- Q4 <问题原话> [factor: f-0004]
  - **追问：** <…>

## 数据团队 · 数据可得性

<!-- 这一节是机械生成的：每个 status: accepted 的因子行（含响应行），按
     L1 › L2 › L3 › L4 › 指标 组成的路径去重，每条路径出同样的四问，逐字照抄，
     不改措辞、不合并、不裁剪。题数必须等于 4 × 去重后的行数。 -->

**时长 90 分钟 · 本节 4 × M 题**

- Q5 [消费者需求驱动 › 品牌广告 › 品牌媒体 › Digital Display › 曝光量] 该指标当前是否可获得？主要来源系统 / 供应商是什么？ [factor: f-0041]
- Q6 [消费者需求驱动 › 品牌广告 › 品牌媒体 › Digital Display › 曝光量] 可提供的最小时间颗粒度与可回溯的历史区间是什么（周度 / 月度，起止时间）？ [factor: f-0041]
- Q7 [消费者需求驱动 › 品牌广告 › 品牌媒体 › Digital Display › 曝光量] 可按哪些业务维度拆分（品牌 / 区域 / 渠道 / 平台），各维度的颗粒度如何？ [factor: f-0041]
- Q8 [消费者需求驱动 › 品牌广告 › 品牌媒体 › Digital Display › 曝光量] 数据口径是否已与业务现实对齐？是否存在已知缺口、口径调整或可比性问题？ [factor: f-0041]

## 没有出题的地方

<!-- 空是一个发现。因子树上哪些行没有对应问题、为什么（比如口径已经在材料里写死了），
     以及本轮刻意不问的层级。这一段不写，提纲看起来就是全覆盖的。 -->

-
