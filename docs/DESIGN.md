---
name: dsh-desk-kit 随手台
description: Apple 式玻璃与留白:石墨做动作,系统蓝只做选中与焦点,红只报失败
colors:
  paper: "var(--dsw-alias-bg-layer-1)"
  ink: "var(--dsw-alias-label-primary)"
  canvas: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 96%, #000)"
  surface: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 93%, #fff)"
  grouped: "color-mix(in srgb, var(--dsw-alias-label-primary) 6%, color-mix(in srgb, var(--dsw-alias-bg-layer-1) 96%, #000))"
  ink-2: "color-mix(in srgb, var(--dsw-alias-label-primary) 66%, var(--dsw-alias-bg-layer-1))"
  ink-3: "color-mix(in srgb, var(--dsw-alias-label-primary) 42%, var(--dsw-alias-bg-layer-1))"
  rule: "color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)"
  rule-2: "color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)"
  fill: "color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)"
  mat-thin: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 66%, transparent)"
  mat-regular: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, transparent)"
  mat-thick: "color-mix(in srgb, var(--dsw-alias-bg-layer-1) 90%, transparent)"
  mat-border: "color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)"
  accent: "var(--dsw-alias-brand-primary)"
  accent-ink: "color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, var(--dsw-alias-label-primary))"
  danger: "color-mix(in srgb, #ff3b30 58%, var(--dsw-alias-label-primary))"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI Variable Text, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0.005em"
  footnote:
    fontFamily: "same as body"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.005em"
  caption:
    fontFamily: "same as body"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.005em"
  label:
    fontFamily: "same as body"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.005em"
  tile:
    fontFamily: "same as body"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  badge:
    fontFamily: "same as body"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontFeature: "tnum"
rounded:
  micro: "6px"
  segment: "9px"
  control: "12px"
  field: "12px"
  card: "18px"
  panel: "24px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.footnote}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.footnote}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 14px"
  search-field:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "42px"
  input:
    backgroundColor: "{colors.grouped}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  segmented:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.footnote}"
    rounded: "{rounded.control}"
    height: "38px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.footnote}"
    rounded: "{rounded.pill}"
    height: "28px"
  list-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "13px 14px"
    boxShadow: "none"
  panel:
    backgroundColor: "{colors.mat-thick}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "344px"
---

# 界面基调：玻璃与留白

## Overview

**Creative North Star: "一块浮在桌面上的玻璃"**

这个面板只服务一个场景：你正在别处，脑子里闪过一件小事，想把它扔进来。所以界面要像 macOS 的一块浮层——**玻璃只出现在"浮起来的东西"上**（面板、浮标、提醒、回执、底栏），里面的内容则是一片冷灰的画布，用留白和层级说话，不用框和线。

这是第三次换世界。3.0「纸与仪器」解决了"彩色太多"，却也把界面压成了一张表格；4.0 先补了材质与留白，这一版按 [cupertino-craft](https://github.com/Tera-Dark/cupertino-craft) 把方法量化成数值：**60-30-10 的色彩预算、同心圆角、四档 Vibrancy、弹簧曲线、发丝线纪律**。

方法论取自 [impeccable](https://github.com/pbakaus/impeccable) 的 Operate 模式与 cupertino-craft 的 Apple HIG 推导：世界只提供字体、配色、密度和一个签名动作，其余交还给任务。**签名动作是"玻璃浮层 + 分段控件"**。

成功标准不变且可测：**存一件事不超过一次输入 + 一次回车，存完不跳页，回执可撤销；三天后能用一次搜索找回。**

**界面模式：Utility（工具）。** 不是 Showcase，所以不要 80px 的章节留白；不是 Reading，所以正文不做 65ch 限制；不是 Ambient，所以不做全屏氛围层。工具模式的空间纪律是：**区块之间 24px，组内 8px，一屏一个主操作。**

### 仲裁顺序

冲突时，低优先级不得破坏高优先级。写代码前先按这个顺序判：

1. **功能完备**：每个控件都有真实响应，没有假图标、空占位、点了没反应的装饰。
2. **可读与可达**：正文 ≥4.5:1，大字与控件 ≥3:1；`focus-visible` 有线；热区桌面 ≥32px、触屏 ≥44px；响应 `prefers-reduced-motion`。
3. **空间与几何**：外边距 ≥ 内部间距；同心圆角 `r_inner = max(0, r_outer − padding)`；不溢出、不截断、按钮不折两行。
4. **内容与层级**：一屏一个视觉焦点 + 一个主操作；静态元数据用 `·` 分隔，不套胶囊。
5. **材质与动效**：60-30-10；玻璃只给浮层；过渡只合成层属性，面板 ≤200ms、换页 ≤280ms。

**Key Characteristics:**
- 材质五档：画布（96% 纸 + 4% 黑）/ 实体面（93% 纸 + 7% 白）/ 内凹（6% 墨）/ 发丝线（8% 墨）/ 玻璃（三档）。
- 色彩 60-30-10：画布 60、实体面 30、系统色 ≤10。
- 大圆角 + 药丸：面板 24、卡片 18、控件 12、分段内格 9、微件 6、胶囊 999。
- 两种彩色：系统蓝 = 选中/焦点/进度，系统红 = 失败。其余一律石墨灰，不做按分类的配色。
- 字阶 22 / 17 / 15 / 13 / 12 / 10.5，字重只用 400 / 500 / 600。
- 悬停不位移：只换底色与描边；Apple 的控件不会在鼠标下跳。
- 动效两档：微交互 150ms `cubic-bezier(.2,0,0,1)`；面板 200ms、换页 280ms，Smooth 曲线 `cubic-bezier(.22,1,.36,1)`。

## Colors

一支墨，一张纸，加两种系统色。所有色值都是**推导式**：用宿主的 `paper` / `ink` 混出来，所以亮色宿主和暗色宿主共用一套代码。

### 三层表面（60-30-10）

| 角色 | 配方 | 实测（亮 / 暗） | 面积 |
|---|---|---|---|
| 画布 canvas | 96% 纸 + 4% 黑 | `#f1f1f3` / `#1b1b1d` | ~60% |
| 实体面 surface | 93% 纸 + 7% 白 | `#fdfdfe` / `#2b2b2d` | ~30% |
| 内凹 grouped | 6% 墨 + 画布 | `#e9e9eb` / `#26262a` | 控件底 |

**画布比纸暗一档，表面比纸亮一档**——这个方向在亮宿主和暗宿主里都成立，所以不需要两套色值。深色下"抬升 = 更亮"，与 Apple 的 `#0B0B0D → #1C1C1E → #2C2C2E` 阶梯同向。

### Neutral
- **纸（paper）**：宿主给的底层，`17.2:1`（亮）/ `14.0:1`（暗）对墨。
- **二级墨（ink-2, 66%）**：次要信息、节标题、占位符、元信息。**实测 4.93:1（画布）/ 5.95:1（实体面），是文本的地板。**
- **三级墨（ink-3, 42%）**：**不是文本色**。只给装饰与禁用态，实测 2.37:1（画布）。
- **发丝（rule 8% / rule-2 14%）**：分格用 8%，需要"看见一条边"时用 14%。不再有 20% 以上的边框。
- **填充（fill 6%）**：次级按钮、开关轨道、悬停加深一档的 wash-2（9%）。

### Primary
- **系统蓝（accent）**：宿主品牌色，缺省 `#0a84ff`。只做**填充**：开关、复选框、进度、焦点环、选中底。
- **文字蓝（accent-ink）**：70% 品牌色 + 30% 墨。所有**蓝色文字**用它——实测 5.63:1（亮）/ 5.40:1（暗），而纯 `#0a84ff` 只有 3.53:1，不能当正文色。

### Semantic
- **红（danger）**：58% `#ff3b30` + 42% 墨，随纸墨自适应。实测 6.96:1（亮）/ 5.92:1（暗）。只报失败与不可逆确认。

### Named Rules

**The 60-30-10 Rule.** 一屏的像素预算：中性画布六成、实体面三成、系统色不超过一成。当你想给第四类东西上色时，答案是用层级，不是用颜色。

**The Two-Color Rule.** 界面上只有两种彩色：蓝=选中/焦点/进度，红=失败。分类、标签、域名、待办都不许各配一个颜色。

**The Two-Blues Rule.** 蓝色填充用 `accent`，蓝色文字用 `accent-ink`。只因为一个色号在深色底上好看，就在浅色底上拿它写 13px 的字，是这条规则要拦的错。

**The Adaptive-Ink Rule.** 新颜色一律从 `ink` / `paper` 混出来，不写死第二套亮暗色值。写死 hex 的那天，就是深色宿主开始出错的那天。

## Typography

**Body Font:** Apple 系统栈 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei"`。
**Mono Font:** `ui-monospace, "SF Mono", Menlo, Consolas`。

**Character:** 无衬线是主体，字重差是层级；等宽是量具。Windows 上没有 SF Pro，会落到 Segoe UI Variable / PingFang / 微软雅黑——**这是许可与可用性的现实，不是设计妥协**，不要在 CSS 里塞一个假 SF。

### Hierarchy

比例 1.1–1.2，产品界面不需要展示级跳动；只有 20px 的格子首字和 10.5px 的角标是特例。对照 SF 的 Display / Text 分界（20px）：Display 收紧字距，Text 保持 0。

- **Display**（600, 22px, -0.02em）：面板大标题（随手台），一屏一处，`text-wrap: balance`。
- **Title**（600, 17px, -0.01em）：浮层面板标题、卡片标题，`text-wrap: balance`。
- **Body**（400, 15px, 1.65, +0.005em）：便签正文、输入框、条目主文本。
- **Footnote**（400, 13px, 1.5, +0.005em）：元信息、时间、按钮文字、提示（`ink-2`）。
- **Label**（500, 13px, +0.005em）：分组标题（"今天 / 常去 / 最近记的"）。**中文不做大写，也不做 0.06em 的字距**——那是拉丁小标签的语法。
- **Mono**（400, 12.5px, `tabular-nums`）：时间、计数、键值、路径、快捷键。只在需要"对齐着看"的地方出现。
- **Tile**（600, 20px, -0.01em）：网页格子的首字，只出现在 52–56px 的方块里。
- **Badge**（600, 10.5px）：唯一允许低于 12px 的位置，只放不可交互的数字角标。

### Named Rules

**The Two-Weight Rule.** 一屏最多两档核心字重（400 正文 / 600 标题），控件与节标题允许 500。**700 与 800 不出现**——靠字号和灰度做层级，不靠加粗堆叠。

**The Optical-Spacing Rule.** ≥20px 的标题负字距（-0.01 ~ -0.03em），≤13px 的正文字距 0 ~ +0.005em。字号越小、字距越宽的老网页习惯，在大屏上会让标题散架。

**The Mono-Is-Measurement Rule.** 等宽只量机器数据。分组标题、按钮、正文一律无衬线——等宽标题是装扮。

**The Readable Floor Rule.** 功能文字不低于 12px，正文不低于 15px；10.5px 只留给角标。

**The Tabular Rule.** 一切会变的数字加 `font-variant-numeric: tabular-nums`。

## Layout

**一块 344px 宽的窄玻璃，从上到下一条阅读线。**

- 面板宽 200–344px（默认 344），高 ≤660px，永远夹在视口内；左右 20px，纵向 16–20px。
- 间距只有五档（4 / 8 / 12 / 16 / 24），**父容器 padding ≥ 子项 gap**：面板体 20 / 卡片间 8；表单组 14 / 组内 10；列表行 16 / 行内 8。
- 单列，无栅格。网页收藏是 52–56px 见方的格子流（`auto-fill, minmax(76px, 1fr)`），是全界面唯一的二维布局。
- 320px 宽是验收线：标题、时间、主操作都要在；420px 以下收 padding、缩标题。
- 响应是结构性的（折叠、换行、隐藏次要提示），不用流式字号。

### Named Rules

**The Panel Truth Rule.** 设计按 344px 画、按 320px 收。宽屏成立、窄屏塌了不算完成。

**The One-Column Rule.** 不加第二列、不套浮层、不做抽屉。要更多空间就折叠和分页。

**The Outer-Gap Rule.** 容器外边距不小于它内部的间距。外边距 8、内间距 12 会让分组看起来像散落的碎片。

## Elevation & Depth

**四档 Vibrancy + 两种实体面 + 一种内凹。一个元素只取一种。**

| 层 | 做法 | 用在哪 |
|---|---|---|
| 玻璃 Thick | 90% 纸 + `blur(24px) saturate(180%)` + 1px 8% 墨边 + 顶边高光 | 主面板 |
| 玻璃 Regular | 78% 纸 + `blur(26px)` | 回执、提醒坞、底栏、确认框 |
| 玻璃 Thin | 66% 纸 + `blur(20px)` | 浮标 |
| 实体面 | 93% 纸 + 7% 白 + 1px 8% 发丝，**无阴影** | 条目、表单组、设置行、卡片 |
| 内凹 | 只有 6% 墨填充，无描边无阴影 | 输入框、开关轨道、分段槽 |

阴影只有两种：`shadow-control`（滑块、选中药丸）与 `shadow-sheet`（浮层）。**卡片没有阴影**——抬升靠表面色差与发丝线，不靠投影。深色下抬升表现为更亮的表面，不是更黑的影子。

### Named Rules

**The Hairline-XOR-Shadow Rule.** 一个表面要么用发丝线，要么用阴影，绝不叠加重边与重影。卡片走发丝线，浮层走阴影。

**The Glass-Only-Floats Rule.** 玻璃只给"浮在宿主之上的东西"和底栏。列表项、卡片、表单一律实体面——玻璃套玻璃会让字看不透。

**The Elevation-Up Rule.** 深色模式里"更高"= 更亮，并且带 1px 顶部高光。深色底上再压黑色投影，等于没做层次。

**The No-Lift Rule.** 悬停只换底色与描边色，不 `translateY`、不 `scale`、不加阴影。控件在鼠标下跳动，是网页的习气，不是 Apple 的。

## Shapes

- **圆角六档：** 微件 6px、分段内格 9px、控件 12px、卡片 18px、面板 24px；胶囊与开关是 999。
- **同心公式：** 内层圆角 = `max(0, 外圆角 − 内边距)`。分段控件 12 − 3 = 9；卡片内贴边图 18 − 10 = 8。**内边距 ≥ 圆角的一半时，内层回到控件标准档 12**——这时两条弧已经不相交，再套公式只会得到方角。
- 药丸只给"一条输入"和"一个筛选"：搜索框、捕获条、chips、开关。**静态元数据不许用药丸**。
- 全界面没有装饰性正圆，除了复选框（状态）与开关滑块（物理）。
- 网页列表用卡片：左边是圆角方块的站点图标（形状本身在说"这是一个站点"），右边标题与域名，下面留三行简介。图标不靠颜色区分站点。
- 不用一侧色条、不用嵌套卡片、不用父子同为 18px 的圆角套圆角。

### Named Rules

**The Concentric Rule.** 父子圆角必须能对上：`r_inner = max(0, r_outer − padding)`。两个 18px 的圆角套在一起，转角处会露出一个月牙。

**The Pill-For-Input Rule.** 药丸形状代表"往里输/往里筛"，不代表团块。把按钮全做成药丸，药丸就不再有含义。

**The No-Pill-Metadata Rule.** 分类、日期、数量、状态不许包在圆角胶囊里。用 `ink-2` 纯文本 + `·` 分隔，把注意力留给内容。

## Components

**共同状态矩阵（缺一不算完成）：**

| 状态 | 表现 |
|---|---|
| default | 实体面或填充底，8–14% 发丝边 |
| hover | 底色加深一档（fill → wash-2）+ 描边抬一档；**不位移、不缩放、不加影** |
| focus-visible | 3px `accent@38%` 外环，`outline: none`；输入类同款 |
| active | `scale(.98)`，100ms 回弹 |
| disabled | 不透明度 ≤0.3，`cursor:default`，不响应 hover |
| loading | 按钮原地换成文字/省略，宽度不变，不弹遮罩 |
| error | 红色文字 + 8% 红底 + 24% 红边；文案写"问题 + 恢复" |
| empty | 虚线发丝框 + 一句能做什么 + 一个主操作 |

### Buttons
- **Primary:** 石墨实心（`ink` 底、`paper` 字），12px 圆角，高 32px，一屏最多一个。深色宿主下自动变成白底黑字。
- **Secondary:** 6% 填充底，无描边。**iOS 没有描边按钮**，描边一律让位给填充。
- **Hover / Focus:** 只改底色；按下 `scale(.98)`。所有按钮 `white-space: nowrap` + 单行省略，绝不折两行。

### Segmented Tabs（签名动作）
- 容器：6% 填充、12px 圆角、3px 内边距，横向滚动但**隐藏滚动条**。
- **只用文字，不放图标**——图标是底栏的事；纯文字分段在 320px 下也放得下 5 段。
- 选中：86% 纸 + 14% 白的浮起白药丸（内格 9px）+ `shadow-control`；文字回到 `ink` 并加粗。
- 未选中：透明底，`ink-2` 文字。悬停不换底，只加深文字。高度 32px，热区达标。

### List Cards
- **Shape:** 18px 圆角，13–14px 内距，卡间距 8px，**1px 8% 发丝，无阴影**。
- **Behavior:** 悬停把描边抬到 14%；动作按钮常驻 40% 不透明度、悬停到 100%；勾选框 22px 视觉 + 34px 热区，贴第一行，不吊在长文本中间。
- **Ordering:** 待行动＝加粗 + 蓝色复选框；已完成＝55% 不透明度；不靠红点。
- **元信息：** 一行 `ink-2` 13px 纯文本，用 `·` 分隔日期、来源、标签。**没有标签胶囊、没有彩色分类块。**

### Inputs
- **Style:** 6% 墨的内凹底、无描边、12px 圆角；聚焦时底色抬到实体面并出现 3px `accent@38%` 环。
- **Search / Capture:** 药丸容器，内部输入框透明无框，右侧发送键是石墨圆形。
- **Placeholder:** 用 `ink-2`，不用 `ink-3`。

### Panel / Floating Layer
- Thick 玻璃、24px 圆角、`shadow-sheet` + 顶边 1px 高光 + 8% 墨边。
- 入场 200ms `cubic-bezier(.22,1,.36,1)`，从 `scale(.985)` 淡入。
- 关闭三件套：Esc、点外部、关闭按钮。
- `backdrop-filter` 不可用时退回实体面（有 `@supports` 兜底）。

### Feedback
- **回执：** Regular 玻璃卡，一行说清"进了哪一类 · 标题 · 时间"，附「撤销 / 转存到 / 去看看」。分类只用文字，不用四种颜色。
- **提醒坞：** 同一套玻璃，没有侧边色条。
- **错误：** 红色文字 + 8% 红底条，不弹模态。

## Do's and Don'ts

### Do:
- **Do** 新样式只引用 `--dk-*`，颜色从 `ink`/`paper` 混出来。
- **Do** 先决定元素属于哪种材质（玻璃三档 / 实体面 / 内凹），再写样式。
- **Do** 用石墨做主动作、系统蓝做选中、系统红做失败，三者在同一屏各司其职。
- **Do** 给每个交互元素五态、每个数据区三态（loading / empty / error）。
- **Do** 用 4/8/12/16/24 的间距，卡片之间 8，分组之间 24，且外距 ≥ 内距。
- **Do** 在 320px、`hover:none`、`prefers-reduced-motion`、无 `backdrop-filter` 四种条件下各看一遍。
- **Do** 让控件名就是动作名："撤销"、"转存到"、"去看看"，不写"确定/取消"。

### Don't:
- **Don't** 手写 `#hex`、`rgba()`、`hsl()`（`--dk-danger` 基色与阴影除外）。
- **Don't** 用渐变做按钮、底栏、标题文字。
- **Don't** 在列表、卡片、表单上再套玻璃；玻璃只给浮层。
- **Don't** 卡片套卡片：带边或影的圆角容器里不许再放带边的圆角子卡。改用发丝线分区。
- **Don't** 悬停时位移、放大或加彩色光晕。
- **Don't** 把纯 `#0a84ff` 当正文色（3.5:1），蓝色文字一律 `accent-ink`。
- **Don't** 用分类颜色（域名色块、彩色角标、红色逾期点）代替文字与位置。
- **Don't** 把静态元数据包进胶囊、加边框或做成小药丸。
- **Don't** 用 10px 全大写 + 0.2em 字距的"伪标签"标题。
- **Don't** 对 `width/height/margin/top` 做过渡，也不给 `box-shadow` 做过渡（重绘）。
- **Don't** 把 12px 以下的字用于功能信息。
- **Don't** 用 emoji 或 `★ ↑↓ ⇄` 字符充当图标（现有 `📌 ★ ⇄` 属于待清理的债）。
- **Don't** 让存完的动作跳页、弹模态或抢焦点。

## 落在哪（实现口径）

- 唯一真身在 `src/client/20-style.js` 末尾的「4.0 Apple」区块；改视觉改这里，再 `npm run build`。`client.js` 是生成物。
- 本文 frontmatter 与 `--dk-*` 定义是同一份真相：改值必须两边同步。检测器读 frontmatter，所以这里的档位能反过来约束代码。
- 历史层（1.x / 1.6 / 2.0 / 3.0）仍在文件里，靠"最后写入者胜"兜住。它是兼容债务，不是第二套设计：**新规则不得写进历史层**。
- 迁移方向：删掉被 4.0 完全覆盖的历史规则；剩余冲突按这个顺序处理：`ink-3` 承载文字、`📌 ★ ⇄` 字符图标、历史层里的字面色值与描边按钮。
- 当前体检：`npm run detect` 报 **0 条反模式**、37 条 advisory，全部落在历史层；4.0 层为 0。这个 37 是迁移进度的计数器，只准降不准升。

## 审计门（改完 UI 后逐条跑）

不是意图检查，是结果检查。一次看一遍、一起修。

1. **构建一致**：`npm run build:check && npm test && npm run test:host`。
2. **确定性体检**：`npm run detect` 必须 **0 条反模式**；advisory 只允许来自历史层（1.x–3.0），4.0 层必须为 0。
3. **几何**：随机抽三个嵌套容器，量 `r_inner ≈ max(0, r_outer − padding)`；父 padding ≥ 子 gap；没有卡片套卡片。
4. **材质**：随机点五个元素，每个只有一种深度来源；玻璃只出现在浮层与底栏；卡片没有阴影。
5. **对比度**：亮/暗宿主各一次，正文与占位符 ≥4.5:1；蓝色文字是 `accent-ink` 而不是 `accent`。
6. **元数据**：扫一遍标签、日期、分类、状态，全部是纯文本 + `·`，没有胶囊。
7. **窄屏**：320px 下标题、时间、主操作都在；分段控件单行不折；无横向滚动；按钮不换行。
8. **热区与焦点**：按钮 ≥32px、列表行 ≥40px；勾选框与图标键有透明外扩；Tab 一圈焦点环连续可见。
9. **状态**：hover / focus-visible / disabled / loading / empty / error 各点一遍；触屏模拟下动作常显。
10. **键盘**：只用 Tab / Enter / Esc 完成"存一条 → 撤销 → 转存 → 关闭面板"。
11. **动效**：开 `prefers-reduced-motion` 后没有位移与淡入；关掉后微交互 ≤150ms、面板 ≤200ms、换页 ≤280ms，没有 `linear`、没有对布局属性做过渡。
12. **降级**：模拟不支持 `backdrop-filter`，面板与回执仍可读。
13. **文案**：每个按钮都是动词；每个错误都写了"问题 + 恢复"；没有感叹号、没有"无缝/赋能"。
14. **浏览器表面**：选区、焦点环、滚动条、数字都没有回退成浏览器默认色。
