# Enact — 三菱形标识

2026-09-08 · 原创品牌标识提案 · 第二版

**让协作成为行动，让行动产生价值。**

将 E 的三条横向笔画抽象为三枚横向扁菱形，沿同一中轴等距排列。
中间整枚使用德勤绿，上下两枚在浅底上为黑色、在深底上为白色。
字标采用 Open Sans Semibold，经间距调整后转为矢量轮廓。

## 预览与文件

- 打开 `index.html`：完整品牌展示、设计释义、四种配色切换及下载。
- `enact-brand-board.png`：1600 × 1040 品牌展示图。
- `enact-logo-preview.png`：1400 × 600 白底标识预览。
- `size-check.png`：16、24、32、48 px 的浅底、深底及单色检查图。
- `enact-brand-kit.zip`：可独立解压使用的完整品牌包。
- `enact-assets.zip`：仅含标识资产与字体许可的便携下载包。

| 文件 | 用途 |
| --- | --- |
| `assets/enact-lockup-light.svg` | 白底/浅底主字标，上下黑色菱形 + 中间绿色菱形 |
| `assets/enact-lockup-dark.svg` | 深底主字标，上下白色菱形 + 中间绿色菱形 |
| `assets/enact-lockup-{black,white}.svg` | 单色印刷、反白应用 |
| `assets/enact-mark-{light,dark,black,white}.svg` | 独立图形，120 × 120 画板 |
| `assets/enact-app-{light,dark}.svg` | 1024 × 1024 方形应用图标母版，由平台施加外部蒙版 |
| `assets/enact-lockup-*-1936.png` | 1936 × 480 透明背景字标 |
| `assets/enact-mark-*-{16,24,32,48,512}.png` | 各尺寸透明背景图形 |
| `assets/enact-app-*-1024.png` | 应用图标位图 |

共 10 份 SVG、26 份应用 PNG，另附展示图与尺寸检查图。
SVG 无外部字体或图片依赖；可导入 Figma、Illustrator、Keynote 或网页。

## 使用规范

- 配色：Black `#000000`、Deloitte Green `#86BC25`、White `#FFFFFF`；辅助文字 Cool Grey `#53565A`。
- 浅底使用 `light`，深底使用 `dark`，品牌绿底使用 `black`。
- 图形最小数字尺寸为 16 px；完整组合建议至少 120 px 宽。
- 三枚菱形宽 96、高 24，中心分别为 (60,28)、(60,60)、(60,92)，层间最小留白 8；独立图形画板为 120 × 120。
- 图形可见边缘外留至少一个菱形高度，即 24 单位。导出画板自带部分留白，排版时补足即可。
- 保持三枚菱形的原始比例、等宽和等距关系。完整组合为 484:120。
- 图标母版中心内容位于画布中央 62.5% 区域，适合圆形与圆角方形裁切。展示稿的圆角只演示平台蒙版。
- 配套排版采用 Open Sans：大标题 Light 300、强调 Semibold 600、正文 Regular 400；中文使用系统无衬线字体。
- 标识图形采用纯色；将渐变、阴影或动画作为其他界面元素处理时，保持标识自身的清晰轮廓。

## 理念依据

德勤公开的使命与价值观强调有意义的影响，以及通过协作创造可衡量的成果。
本方案以三层同向的几何结构表达人与智能体协同，中央品牌绿形成统一的视觉核心。
人与智能体协作的含义是针对 Enact 的原创设计解释。

- [Deloitte — Purpose and Values](https://www.deloitte.com/global/en/about/story/purpose-values.html)
- [Deloitte — Becoming the Green Dot](https://www.deloitte.com/southeast-asia/en/about/governance/network-brand-alliances/becoming-the-green-dot.html)
- 配色、Open Sans 字体与克制的构图参考当前本地 Deloitte 设计技能及 Enact 既有设计系统。

本目录记录新的品牌设计提案，正式产品当前标识规范仍记录于 `design-system/enact/MASTER.md`。

## 构建与检查

`build-assets.py` 使用 `fonttools[woff]` 从随包字体生成转曲字标与 SVG。
`render-assets.mjs` 使用仓库已有 Playwright 导出 PNG 和展示图。
字体来自 `@fontsource-variable/open-sans` 5.3.0，许可见 `fonts/LICENSE`。
预览页面使用本地字体，解压后无需网络即可查看。

已检查：1600px 桌面与 390px 手机布局、图片与字体载入、四种配色及下载目标、
16–48px 图形的深浅底和单色识别。另经独立几何审阅。

Information Classification: Confidential
