# 抽取路径

三条路径，选哪条不是效率问题，是这条证据能被信任到什么程度的问题。
选定之后写进 manifest 的 `extraction_path`，取值只有 `native` / `structured` / `vision` 三个。

## 三条路径

| 路径 | 什么时候用 | 拿到的是什么 | 可信度 |
|---|---|---|---|
| `native` | 文件本身就是文本，且文本层完整：Markdown、TXT、有文本层的 PDF、DOCX、HTML | 原文字符，逐字 | 最高。锚点可以是精确原文 |
| `structured` | 文件有明确的行列或树结构：CSV、TSV、XLSX、JSON、XML、BPMN 导出 | 结构化记录，字段名与取值都在 | 高，但结构解释可能出错（表头在第几行、合并单元格） |
| `vision` | 扫描件、图片、依赖版面才读得懂的页、流程图、截图 | 模型看图后的转述 | 最低。它是一次**重述**，不是复制 |

## native

优先选它。判据：把文件用最朴素的方式读成文本，读出来的东西是不是完整。

不完整的迹象：段落顺序错乱、表格塌成一行、页眉页脚混进正文、公式或图注变成乱码。
出现这些就不要硬用 native，换 structured 或 vision，并在 `known_limitations` 里
写清楚哪一部分不完整。

`process-general-ledger-ch6.md` 与 `reversal-policy-v4.md` 都是 native：
它们本来就是 Markdown，`§6.2/3` 这样的锚点能逐字对回原文。

## structured

CSV / XLSX 走这条。要额外记两件事：

1. **表头在哪一行、有没有合并单元格。** 表头识别错了，后面每一条抽取的字段名都是错的，
   而这种错在锚点层面看不出来——`row 4 / column amount` 看着完全正常。
2. **`prompt_or_schema_version`。** 用哪一版表结构解释这张表。表结构改了，
   旧抽取要重判。

`journal-entries-sample.csv` 是 structured：`tax_included` 这一列的存在本身就是证据——
它说明系统里区分含税与不含税，因此政策 §3.3 那句"未说明是否含税"是一个真实的空白，
不是我们没读到。

## vision

扫描件、图片、流程图导出走这条。三条硬要求：

1. **必须记 `model_version`。** 换了模型，同一张图可能读出不同的东西。
   不记模型版本，以后没法解释两次抽取为什么不一样。
2. **`uncertainty` 从 `medium` 起步。** 视觉抽取是重述。图上一条线的走向、
   一个方框的标签、两个节点之间有没有箭头，都可能读错，而且错得很自信。
3. **锚点用图区，不用行号。** 见 `anchors.md` 的"图区"一节。

`flow-diagram-notes.md` 在真实项目里对应的是一张 Visio 导出图。即使这里已经是文字说明，
它仍然登记为 `vision`：因为这份文字本身是从图上转述来的，转述过程中已经丢过一次信息——
"回滚之后指向哪里，图上没有画"这句话是转述者的判断，不是图上的字。

## 降级必须留痕

从 native 降到 vision（比如 PDF 的文本层坏了，只好按图读）是一件要写进
`extraction_path` 的事，不是一个实现细节。

理由：审阅的人看到 `extraction_path: native` 时，会默认锚点里的
`exact_snippet` 是原文逐字。如果实际上是模型看图重述的，他就在拿一句
可能被改写过的话当原文用，而且不知道自己在这么做。

同时把降级的原因写进 `known_limitations`：

```yaml
extraction_path: vision
model_version: claude-opus-5
known_limitations: PDF 文本层为空（疑似扫描件），改用视觉抽取；第 3、7 页表格线不清
uncertainty: high
```

## 混合材料

一份材料里有些页能 native、有些页只能 vision 时，**拆成两条 evidence 记录**，
各自记自己的路径和锚点范围，不要在一条记录里写"主要是 native，部分 vision"。

一条记录只能有一个可信度。混在一起之后，读的人无法判断他手上这条锚点属于哪一半。
