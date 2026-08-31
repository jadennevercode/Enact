# 工作簿应用

把散落各处的 Excel 生成收成一条生产线。以前因子树的表、访谈提纲的表、评分卡的表都
是临时写一个脚本扔在临时目录，每次长得都不一样；现在是一个入口、一套排版、一份运行
记录。

## 这个应用是什么

**它只摆样子，不出内容。** 表里的每一个字都来自工作区里已经存在的文件——因子树
YAML、访谈提纲与预答、评分卡 YAML、计算产物 JSON。这个应用不算数、不判断、不补默认
值、不"顺手改一下措辞"。

这就是 App 与 Skill 的分界线：

| | Skill | App（这里） |
|---|---|---|
| 决定 | 生成什么、哪一行采纳、哪个是主指标 | 长什么样 |
| 输入 | 材料、客户说的话、人的裁定 | 工作区里已经写好的文件 |
| 出错时 | 是判断错了 | 是排版错了或解析错了 |

所以：**表里的数不对，去改上游那个交付物，不要改这里。** 下一次生成会把手改的内容
覆盖掉。

立项依据见 `docs/specs/2026-08-08-architecture-and-methodology.md` §4.3：产出有固
定形态、形态要跨 Skill 复用并对客户交付、内容全部来自已有产物——三条都满足。

## 怎么调

```bash
~/.local/bin/mmm app workbook <工作簿名> --workspace <工作区> [--out <路径>] [其它参数]
```

从插件根目录跑。参数：

| 参数 | 说明 |
|---|---|
| `<工作簿名>` | `factor_tree` · `data_request` · `interview` · `scorecard`（连字符写法也认） |
| `--workspace` / `-w` | 工作区目录，就是放 `mmm.yaml` 的那个；给子目录也能找上去 |
| `--out` / `-o` | 产出位置。不给就用默认值，见下表 |
| `--card` | 仅评分卡：`quality` / `stat` / `ols`，或直接给一个 YAML 路径 |
| `--language` | 覆盖工作区声明的产出语言（`zh` / `en`），一般不用给 |

四种工作簿：

| 工作簿 | 读什么 | 默认产出 | 表 |
|---|---|---|---|
| `factor_tree` | `artifacts/s1/factor-tree.yaml` | `artifacts/s1/factor-tree.xlsx` | 因子树 · 待裁决 · 统计 · 说明 |
| `interview` | `artifacts/s1/interview/outline.md` · `pre-answers.md` | `exports/interview.xlsx` | 访谈提纲 · AI 预答 · 说明 |
| `scorecard` | 任意一份评分卡 YAML | 评分卡旁边，例 `artifacts/s2/quality-scorecard.xlsx` | 评分卡 · 统计 · 说明 |
| `data_request` | `artifacts/s1/factor-tree.yaml` · `project-profile.yaml` | `artifacts/s1/data-request/`（一个目录） | 一个 L3 一册、一个 L4 一表 |

例子：

```bash
~/.local/bin/mmm app workbook factor_tree  -w ~/mmm-engagements/acme
~/.local/bin/mmm app workbook interview    -w ~/mmm-engagements/acme -o ~/Desktop/访谈.xlsx
~/.local/bin/mmm app workbook scorecard    -w ~/mmm-engagements/acme --card quality
~/.local/bin/mmm app workbook data_request -w ~/mmm-engagements/acme
```

**零依赖。** 只用标准库，`shared/lib/xlsx.py` 是手写的 xlsx 写出器。一台只装了
Python、没装引擎也没装 openpyxl 的笔记本必须能生成工作簿——所以这里不 import
`mmm_engine`，运行记录也是自己写的一份精简版（`runlog.py`，字段与引擎那份逐个对齐）。

**每次运行登记一行运行记录**到工作区的 `state/tool-runs.jsonl`：什么时候、哪个工作
簿、产出在哪、产出文件的哈希。失败也登记一行，否则事后查不出"到底跑没跑过"。

**因子树工作簿还多一件事：** 它是因子树给人看的唯一形态，逐行确认就在它上面做。
所以它把源文件的指纹写进自定义文档属性（`docProps/custom.xml` 的 `sourceHash`），
`workbook_current` 谓词据此判断它有没有过期——一份过期的评审表比没有表更危险，
人会在上面签字。

**空结果要说话。** 读到的内容是空的时候，工作簿照出，但表里写清为什么是空的（因子树
一行也没有 / 预答还没写 / 评分卡被上一层全筛掉了）。静默产出一个空文件是这条生产线
最不能接受的行为——它和"跑过了，没问题"长得一模一样。

## 排版规范

所有工作簿共用一套长相，实现在 `layout.py`，改那里就是改全部：

1. **第 1 行是标题行**，粗体 14 号。
2. **第 2 行是生成说明**——来自哪个交付物、什么时候生成、依据哪个文件。灰色小字。
3. **第 3 行是表头**，加粗、浅灰底、自动换行。
4. **冻结到 A4**：滚到第 500 行，标题和表头还在。
5. **列宽按内容估算**，中日韩字符按两格算，不是所有列一样宽；长文本列（理由、备注）
   由各 builder 给固定宽度，免得一列吃掉整个屏幕。
6. **表头语言跟工作区走**：`mmm.yaml` 的 `outputLanguage`，`zh` 出中文、`en` 出英
   文；没声明按中文。
7. **最后一张表叫「说明」**，四列：列名 / 含义 / 颗粒度 / 谁来填。加上一两句"这表是
   生成的，改这里没用，去改上游"。
8. **不用架构词汇。** 表里的文案说业务语言——交付物、依据材料、待确认、运行记录。

### 一条例外：`data_request`

数据需求工作簿**不套用上面的排版**，保持它迁移前的原样：第一张 README 表，然后一个
L4 一张数据表，表头就在第 1 行。原因有两条，都比"统一好看"重要：

- 这是**客户签收过的形态**，17 份真实交付出去过的工作簿就长这样；
- 它有对应的自检用例（`scripts/selftest.py` 里 `data-request/build` 那一段），行为一
  变就是把签过字的东西改了。

它从 `skills/data-request/scripts/build_workbooks.py` 原样搬进来，只接了统一入口和运
行记录。

## 怎么加一种新工作簿

1. 在 `builders/` 下新建一个模块，比如 `funnel.py`。
2. 提供四样东西：

   ```python
   TOOL = "workbook.funnel"          # 写进运行记录的名字
   DELIVERABLE = "model-input"       # 它服务的交付物 id（deliverables.yaml 里的那个）

   def default_out(root, options):   # 不给 --out 时的工作区相对路径
       return "exports/funnel.xlsx"

   def run(root, out, language, options):
       # 返回 (主产出绝对路径, 附带产出列表, 终端输出行)
   ```

   一个 builder 服务多个交付物时（`scorecard` 就是，三种评分卡分属三个交付物），再加
   一个 `deliverable(root, options)`，让运行记录写对交付物名。

3. 表用 `layout.sheet()` / `layout.stats_sheet()` / `layout.notes_sheet()` 拼，不要自
   己调 `xlsx.write_workbook` 排版——那样两个月后就会有两套长相。
4. 中英文表头写成模块里的 `TEXT = {"zh": {...}, "en": {...}}`，跟其它 builder 一样。
5. 在 `builders/__init__.py` 的 `BUILDERS` 里登记一行。
6. 用真实工作区跑一遍，用 `openpyxl` 或 `zipfile` 读回来核对内容。

**不要在 builder 里做判断。** 需要"如果这一行的分数是 0.5 就……"这类逻辑，说明那件事
属于上游的交付物，不属于这条生产线。

## 排版能力不够怎么办

`shared/lib/xlsx.py` 是零依赖手写的 xlsx 写出器。缺能力就按 OOXML 规范补它，不要绕过
去装个库。它现在支持：

- 多表、内联字符串、数字
- 四种单元格样式：`plain` / `header`（粗体灰底换行）/ `title`（粗体 14 号）/ `note`
  （灰色斜体小字）
- 冻结窗格（`options["freeze"] = "A4"`）
- 列宽：按内容估算（中日韩字符两格）或由调用方指定（`options["widths"]`）

补完之后跑 `~/.local/bin/mmm script selftest`，必须 0 failed——数据需求工作簿是它的调用
方，改坏了那里就是改坏了一份客户交付物。
