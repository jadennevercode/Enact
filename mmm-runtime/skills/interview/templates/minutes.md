---
step: interview/minutes                 # 固定值，不要改
skill: interview
generated: ""
grounding:
  - { path: "inputs/interview-minutes/<原始文件名>", chars: 0, truncated: false }
  - { path: "artifacts/s1/interview/outline.md", chars: 0, truncated: false }
knowledgeRecall: none
layer: "执行层 · 媒介"                   # 这场访谈的层级与团队，对应提纲里的那一节
interviewedAt: ""                       # 访谈日期
attendees: ""                           # 到场的人；后面引用原话要写「谁说的」，靠这里
counts:
  sections: 0
  questionsCovered: 0
  questionsMissed: 0
---

<!-- 访谈纪要 —— 照这份填，不要自创结构。
     一份原始纪要或转录稿对应一个文件：artifacts/s1/interview/minutes-<来源>.md。
     写法见 ../references/minutes.md。

     客户拿到手的是它渲染出来的 Word：
       ~/.local/bin/mmm app report interview-minutes -w <工作区>

     提纲上的每一题，要么在某个段标签里出现，要么进「## 没覆盖到」。
     两处都没有它，就是这一题在提纲和纪要之间消失了 —— minutes_cover_outline 会拦下来。 -->

# 访谈纪要 —— <层级 · 团队>（<日期>）

## §1 <这一段谈的是什么>  [Q14, Q15]

<!-- 段标签 [Q14, Q15] 让后面消化纪要时不用重读原稿就能定位材料。
     这一段没有对应到任何提纲问题，就不写标签，改标 [unplanned]。 -->

<两三句归纳。>

> "<受访者的逐字原话>" —— <职务或姓名>

**对因子树的影响：** <这一段会让树上哪一行怎么变。没有影响就不写这一行。>

## §2 <…>  [unplanned]

<!-- 提纲没问、受访者主动提起、而且重要的东西。
     这往往是全场最有价值的内容：客户在告诉你，你的树不知道该问什么。 -->

> "<逐字原话>" —— <谁>

**对因子树的影响：** <…>

## 没覆盖到

<!-- 必填。一场什么都覆盖到了的访谈很罕见；声称覆盖到了的纪要通常是纪要的问题。 -->

- Q19（归因窗口）—— 时间不够。
- Q23（竞品反应）—— 受访者推给了品牌团队。
