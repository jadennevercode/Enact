# 图册应用

把业务校验要给客户看的东西收成一页：**一个 `L1›L2›L3` 因子路径一张卡**，销量作底图，
这个因子的指标叠在上面，读的人可以当场换粒度、换渠道、往下钻、换指标。

一个入口、一套画法、一份运行记录，同一份数据两次生成逐字节相同。

## 这个应用是什么

**它归约，但不判断。**

页面上的数是它自己在浏览器里按你选的条件算出来的 —— 这是架构文档 D10 有意推翻的一条
旧决定（原来是「所有切法预先算好、页面只换视图、页面自己不做算术」）。推翻的理由是
算术：这套筛选器的状态空间是

> 时间粒度 × 品牌 × 渠道 × 区域 × 数据来源子集 × L4–L8 路径 × 指标子集

预先算好不是「不算」，是把同一批算术做一百万次再塞进页面。

所以界线重新划在**判断**上，而不是**算术**上。所有能被决定的东西仍然在上游定好、
作为数据下发：

| 决定 | 谁定的 | 怎么到页面的 |
|---|---|---|
| 哪些行在范围内 | 台账（更早的层已经否掉的） | 它们根本不在 payload 里 |
| 哪个指标怎么滚动 | **因子树**（人定、过了门）> 指标登记表 > 名字分类器 | `metricMeta[m].agg` · `.source` |
| 哪条是响应变量 | 长表里 `metric_type == "Y"` | `response` |
| 单位、货币、数字格式 | 同上登记表 | `metricMeta[m]` |
| 每个指标画成什么形状 | `metric_type` | `metricMeta[m].role` |
| 什么算异常 | `validation.anomalies` | `anomalies.json` |
| 一张卡是什么 | `validation.panel` | `cards[]` |

页面一个都不挑。它套一个掩码，然后归约。

**而归约被验证过两次**：生成页面之前，node 拿页面内联的同一份 `js/fold.js` 重放
`validation.panel` 枚举出来的几百个筛选态，和 Python 侧逐位比对，**对不上就不写这一页**；
页面打开时，它再重放一次内嵌的 32 个，**对不上就一张图都不画**。

契约写在 `shared/fold-contract.md`，八条规则每一条都有理由。

| | Skill | App（这里） |
|---|---|---|
| 决定 | 生成什么、异常怎么处置、解读写什么 | 长什么样 |
| 输入 | 材料、客户说的话、人的裁定 | 工作区里已经算好的产物 |
| 出错时 | 是判断错了 | 是画错了、搬运错了，或者归约漂了 |

**图上的数不对，去改上游那个交付物，不要改这里。** 下一次生成会把手改的内容覆盖掉 ——
而且页面自带的校验和会认出它被改过，然后拒绝作图。

## 怎么调

```bash
~/.local/bin/mmm app charts book --workspace <工作区> [--out artifacts/s2/chart-book.html]
```

| 参数 | 说明 |
|---|---|
| `book` | 目前只有这一种页面 |
| `--workspace` / `-w` | 工作区目录，就是放 `mmm.yaml` 的那个；给子目录也能找上去 |
| `--out` / `-o` | 产出位置，默认 `artifacts/s2/chart-book.html` |
| `--title` | 页面标题，也是浏览器标签上的名字 |
| `--skip-foldcheck` | **只在调试时用。** 跳过跨端比对；运行记录会如实写 `skipped` |

要先跑完这几个：

```bash
~/.local/bin/mmm tool validation.panel     --workspace <工作区>   # 顺带写出 validation-foldcheck.json
~/.local/bin/mmm tool validation.facts     --workspace <工作区>
~/.local/bin/mmm tool validation.analyses  --workspace <工作区>   # 每张卡一个解读槽位，预填计算读数
~/.local/bin/mmm tool validation.anomalies --workspace <工作区>
```

一次运行写两份产物：`chart-book.html` 与 `business-validation.md`。后者是解读表的
markdown 视图，不是另一份源——改它没有用。

## 一张卡上有什么

**图**：双轴，角色定死 ——

| 序列 | 图形 | 轴 | 为什么 |
|---|---|---|---|
| 响应（销量） | 填充面积，青色 | **右轴** | 背景板 / 参照物 |
| 花费类 | 折线 | **左轴** | 投入的节奏 |
| 其余一切 | 柱状 | **左轴** | 驱动因素 |

销量在右、驱动在左，是因为两者单位根本不同（箱 vs 元 vs %），不能共用一条刻度；而图上
大多数序列是驱动，所以把默认先读的那条轴留给它们。**同一份数据换个形状，读起来就是两个
发现** —— 这是定过的决定，不重新讨论。

**筛选器全在卡上，一行，从左到右**（标签一律英文，与产品一致）：

```
Year | Half-year | Quarter | Month · Source · Sub-factor (L4) · Level 5…8 ·
Indicator · Brand · Channel · Region ·〈弹性空隙〉· Axis range
```

粒度按钮**粗→细**排（`GRAIN_DISPLAY`），而撑不起时的降级**细→粗**（`GRAIN_FALLBACK`）。
两个数组，永远不合并成一个：拿显示顺序当降级顺序，「十二个月凑不出一年」会变成
「十二个月合成一年」——一根柱子取代一条趋势线。理由见 `shared/fold-contract.md` R7。

**作用域没变，变的只是按钮位置**：

| 作用域 | 有哪些 | 动它会怎样 |
|---|---|---|
| 两端都动 | 时间粒度 · 品牌 · 渠道 · 区域 | 销量底图和驱动一起动 |

| 只动叠加层 | 数据来源 · L4–L8 下钻 · 指标 | 驱动变，**销量底图纹丝不动** |

后者有业务理由：不管你现在看的是哪个文件来的、哪个子因子下的花费，参照系必须保持不变，
否则「投入 vs 产出」就没有基准了。

这三列的取值**从销量底图和驱动两边取并集**。区域通常只出现在底图上——驱动大多按全国
报——只数驱动的话每张卡都没有区域可选，读的人到不了一个归约和 `validation.read --region`
都支持的视角。选了之后按 R5 全国口径的驱动会退出画面，页面把退出的条数写出来。

每个筛选器是一个 pill + popover：选过东西的 pill 描强调色并带计数徽标；这张卡报不到的
层级渲染成灰色 `<span>`（**不是按钮**，键盘不停在死控件上），但留在行里——梯子长度恒定，
读的人才看得见「这个因子就是没报到那么深」。

**图下面依次是**：刷选条 → 居中图例 → 说明 → AI analysis → 年度表。图例点一下隐藏，被隐藏
的序列**退出轴域计算**，所以藏掉一条量纲巨大的指标，其余会自动放大。

**图型可以换，默认锁死。** 每个图例项有一个 `▾`，能在柱/线/面积之间切（响应只给线和面积
两个选项——柱状底图会挡住画在它上面的驱动）。默认值仍来自上游的 `metricMeta[m].role`，
换过之后卡头出现 `Chart type edited · N` 与 `Reset to default`，解读区块打上「这段解读对应
的是默认视图」的标记。**图型不进归约**：它是在数出来之后才选的，跨端契约完全不受影响。

**汇总口径来自因子树。** `artifacts/s1/factor-tree.yaml` 的 `rows[].aggregation` 是整条
链路上唯一由人定、且过了确认门的那一份（`p_aggregation_declared`）。指标登记表
`coverage.yaml` 看起来更靠近数据，但它那一列是 `classify_indicator` 按名字猜出来再存下
来的 —— 存过一遍的猜测还是猜测，所以它排第二。页面上每个指标都标着它的口径从哪来。

归约的算子集是封闭的四个：`sum` · `average` · `min` · `max`。因子树允许人定
`weighted_average` 这类做不了的规则，**替换在工具里完成并写在页面上**，页面自己不做
任何重新解释。

## 空、缺、被排除掉的，都要说出来

这一页最容易犯的错不是画错，是**静默地少画**。所以：

- 缺的月份画成断开，**不是零**；图下面数出来「XX 缺 N 期」
- 没铺满的时间桶打斜纹，并写明「求和类指标在这些桶上必然偏低」
- 撑不起的粒度按钮**置灰不删**，鼠标停上去说明为什么
- 下钻梯子里没有可选项的那一层是**虚线灰框**，不隐藏 —— 梯子长度恒定，读的人才看得见
  「这个因子就是没报到那么深」
- 全国口径的行被渠道/区域筛选排除时，数出来告诉读的人 —— 图上它只是显得线变短了
- 汇总口径不是因子树里人定的（登记表或按名字推断）时，页面上标出来
- 因子树定了归约做不了的口径（加权平均）时，把替换和理由写出来
- 只有一个取值的维度不做成能点的筛选，但写明它有哪个取值

## 每张卡都有一段解读，而且没有一张是空的

解读不是自由散文，是一张受校验的表：`artifacts/s2/chart-analyses.yaml`，一张卡一条，
结构定死（一句话结论 + `trends` 2–4 条 + `anomalies`/`inflections`/`caveats` 各 ≤6 条），
引的每个期间必须真实存在于那张卡。

以前它是 markdown，页面按标题字符串去找：标题差一个字，那一段不报错、不提示，只是不出现。
现在对不上就是一次响亮的失败（`chart_analyses_bind`）。

**没写的卡显示 `validation.analyses` 预填的计算读数**，页面上写明它是计算读数。所以页面上
永远没有「待写入」——与其编一段，不如给一份刻意平实、不会被误当成谁的判断的东西。

数在解读写完之后动过（`seriesDigest` 对不上），那一条自动退回计算读数并说明原因。

## 页面里没有签核

**一个签核控件都没有。** 签核是状态，页面是视图；两处都能写就一定会分叉，而分叉要到下
一次重出图册时才暴露，那时人已经以为签过了。客户否掉的指标记在别处。

## 颜色

八个分类色位，**按名称排序分配，不按排名** —— MT 掉到第三名就换个颜色，那不是配色变化，
那是误导。色位在一张卡的**全部候选指标**上分配，不是在当前选中的子集上：按选中集分配的
话，加第七个指标会让前六条全部换色。

响应用两个单独的令牌（`--response-fill` / `--response-line`），**不占分类色位**：它画在
另一条轴上，是所有驱动共用的参照系，不是和它们争区分度的第 N 个实体。

aqua / yellow / magenta 在浅色底下低于 3:1，补偿规则是可见的直接标签**或**表格视图。
所以每张卡都必须留着年度表 —— 这不是可选项。

## 验收

```bash
W=/tmp/chart-book-fixture

# 1 · 故意做坏的工作区（见 _fixture.py 里那张坑表）
~/.local/bin/mmm app charts._fixture $W

# 2 · 产物
~/.local/bin/mmm tool validation.panel     --workspace $W
~/.local/bin/mmm tool validation.facts     --workspace $W
~/.local/bin/mmm tool validation.analyses  --workspace $W
~/.local/bin/mmm tool validation.anomalies --workspace $W

# 3 · 页面（内部调 node 比对；对不上就不写）
~/.local/bin/mmm app charts book -w $W

# 4 · 跨端算术，全部状态，硬失败
node "$(~/.local/bin/mmm where | awk '/^  root/{print $2}')"/apps/charts/js/foldcheck.mjs $W/data/derived/validation-foldcheck.json

# 5 · 确定性
~/.local/bin/mmm app charts book -w $W -o /tmp/a.html
~/.local/bin/mmm app charts book -w $W -o /tmp/b.html
cmp /tmp/a.html /tmp/b.html

# 6 · 没有响应变量是一个答案，不是崩溃
~/.local/bin/mmm app charts._fixture /tmp/no-y --no-y
~/.local/bin/mmm tool validation.panel     --workspace /tmp/no-y     # 期望失败 + 指出去标 KPI 角色
~/.local/bin/mmm tool validation.anomalies --workspace /tmp/no-y     # 期望 0 条 + 原因，绝不是一张求和表
```

然后手动打开 `$W/artifacts/s2/chart-book.html`，在深浅两套主题、1440 与 390 两种宽度下
逐项确认：

- [ ] `window.__foldSelfCheck.ok === true`，且 `<html data-selfcheck="ok">`
- [ ] 没有横向溢出；没有重叠或被裁的标签；控制台无报错
- [ ] 没有页签行、没有签核控件、没有页面顶部的全局筛选条
- [ ] 粒度读作 `Year | Half-year | Quarter | Month`，Month 高亮
- [ ] 只有 12 个月的切片（西北）选「年」会降到 **Month**（不是 Half-year），并写明从哪一档降的
- [ ] `Level 8` 在报不到 L8 的卡上是灰 pill，每张卡的筛选行长度一致
- [ ] `Indicator` 默认无徽标；选两个变 `Indicator 2` 且描边强调色
- [ ] 刷选条在图例**之上**，图例居中，响应读作 `本品销量箱数 (Y)`
- [ ] 左轴读作 `0 / 300.0万 / … / 1,200.0万`；tooltip 读作 `名称 : 值 · sum`，按名称排序、带色
- [ ] **每张卡都有 AI analysis 区块**——包括一张没写解读的，它显示计算读数并说明自己是计算读数
- [ ] 换一次图型：图例标虚线、卡头出现 `Chart type edited`、解读打上过期标记
- [ ] 温度显示 `avg` 且来源是**因子树**（登记表说 sum，因子树赢），三个缺失月是断开不是零，
      图下数出「缺 3 期」
- [ ] 加权铺货率显示 `avg` 并写着「weighted_average → average（没有权重列）」
- [ ] 库存水位显示 `min`，年粒度下是该年最小值而不是三年之和
- [ ] 选了渠道之后全国口径的电视/GRP 退出画面，**并且图下说明了原因**
- [ ] 只选华南时「年」当场置灰，鼠标停上去说明「只有 12 个月」
- [ ] 品牌传播卡的级联：选 L5=抖音 之后 L6 只剩抖音下的达人层级，指标标签变成
      「指标（抖音下 N 个）」，且原来的指标选择被清空
- [ ] 门店运营卡标签读作「指标（14 个）」，默认只画 6 条
- [ ] 切到「季」之后 2025Q4 打斜纹，图下写明求和类在这些桶上偏低
- [ ] 同比口径选 3 月，每一年只用 3 月的数
- [ ] 两次生成的 HTML 逐字节相同

**故意破坏一次，确认机制真的会拦：** 把 `js/fold.js` 里 `total / seen.length` 改成
`total / cells.length`（违反契约 R2），再跑第 3 步 —— 必须拒绝写页面，并报出是哪个状态、
哪个位置、两边各是多少。改回来。

## 文件

| 文件 | 干什么 |
|---|---|
| `__main__.py` | 入口；调 node 比对，写页面，登记运行记录 |
| `book.py` | 外壳：HTML 骨架、空槽位、内联 payload 与脚本、服务端渲染解读区块。**不画几何、不写数字** |
| `analyses.py` | 合并计算槽位与写下来的解读（written / computed / stale），并渲染 markdown 视图 |
| `palette.py` | 深浅两套 CSS 令牌；八个分类色位 + 响应的两个专用色 |
| `runlog.py` | 一行运行记录（含 `selfCheck` 结论）。写入那一刻取哈希 |
| `js/fold.js` | **归约内核**，与 `mmm_engine/charts/fold.py` 是同一份契约的两个实现 |
| `js/format.js` | 数字与期间怎么写出来，全部跟着 `metricMeta` 走 |
| `js/render.js` | 全部 SVG 几何。**唯一的渲染器** |
| `js/controls.js` | 筛选器、级联、面包屑、图例、轴范围、刷选 |
| `js/table.js` | 年度表 + 同月对比 |
| `js/selfcheck.js` | 首屏绘制前重放内嵌状态；不过就不画 |
| `js/boot.js` | 接线、懒加载、重画 |
| `js/foldcheck.mjs` | node 侧的跨端重放（不内联） |
| `css/page.css` | 页面样式 |
| `_fixture.py` | 带坑的合成工作区，验收用的脚手架（要 pandas；应用本身只依赖标准库） |
