# dsh-desk-kit 架构梳理与重构记录

> 2026-11-17 · 目标：把「能跑但难维护」的插件收拢成有明确所有权边界的结构。

## 一、判断依据（设计理念来源）

取自 DSH 仓库自带的官方技能，不是通用大道理：

| 技能 | 本插件用到的规则 |
|---|---|
| `.agents/skills/cordis-styling-nitpicking` | 三条 P0：**模块级单例**、**未回收的副作用**、**清理依赖早于消费者完成**。这是一次 Cordis 生命周期审计，不是样式问题（名字有歧义）。 |
| `.agents/skills/dsh-client-ui-ux` | 复用优先于新增；颜色/间距/圆角用已有 token 而不是即兴字面量；特性 CSS 字重 ≤500；瞬时反馈用宿主 Toast，宿主在 `shell.overlay`；加载态列表用骨架屏；浮层要能 Esc / 点外关闭 / 不被祖先裁剪。 |
| `.agents/skills/dsh-client-ui-ux/references/spacing.md` | 先定义「谁和谁是一组」，再决定间距；组间必须明显大于组内。 |
| `.agents/skills/dsh-find-simplifications` | 先问「这个能力有没有完整的生效路径」和「谁承担维护成本」，再谈删；不要用新增基础设施去简化。 |
| `.agents/skills/dsh-error-handling` | 预期失败要有类型与稳定 code；**禁止靠解析报错文案做控制流**；空 catch 必须单语句且写明为什么安全。 |
| `.agents/skills/dsh-responsive-ui` | 窄容器下的换行与省略规则。 |

## 二、体检结果（重构前）

| 项 | 数值 | 结论 |
|---|---|---|
| 代码量 | index 779 / store 729 / client 1672 / capture 280 = 3642 行 | 单文件承载了组合根 + 23 个工具 + HTTP 路由 + 动作分发 + AI 分类 |
| `store()` 单例调用 | 24 处 | 进程级单例，生命周期挂在模块加载上，不归 Cordis 管 |
| 模块级可变状态 | index 2 个（`singleton`、`actCtx`）+ client 2 个（`sidebarReady`、`openSidebarTab`） | 正是 P0「singleton pattern」 |
| 未回收副作用 | `window.addEventListener(OPEN_EVENT, …)` 在 apply 里挂了就没人摘 | 正是 P0「unreversed side effect」；重建插件会叠监听 |
| 工具注册 | `register()` 的 disposer 被丢弃；重复注册靠 `/duplicate/i` 匹配报错文案 | 违反「禁止靠文案做控制流」 |
| 测试 | 54 处 `src.includes('…')` 断言源码文本 | 锁死实现形状，想重构就先挂测试 |
| CSS | 142 条规则内联在 JS 字符串数组里，51 处重复定义 | 无法被工具检查、无法复用 |

## 三、目标结构

```
服务端（ESM，可自由拆分）
  index.js      组合根：只做装配 —— 建 store、挂路由、挂工具、挂定时器
  store.js      领域与持久化（下一步按域拆：notes / reminders / alerts / vault / persist）
  capture.js    一句话分拣（本地规则 + AI 兜底）
  tool.js       工具 schema 适配
  lunar.js      农历换算

客户端（受宿主 loader 约束，必须单文件产物）
  client.js     ① 设计 token 与样式 ② 纯逻辑 ③ 视图组件 ④ 插件入口 apply
```

**客户端为什么还是一个文件**：宿主用 `window.__ModuleLoader__.load({ factory })` 加载客户端产物，`factory` 只能 `require` 宿主提供的包（react 等），不能 require 兄弟文件；已装插件（dsh-mnemon、dsh-pet）都是预打包成单文件的。要真正拆模块得引入 bundler，那是新增维护成本，本轮不做。

## 四、本轮已落地（v1.5.0）

### 1. 干掉进程级单例
- `let singleton` + `store()` → `openStore()`，实例在 `apply()` 里创建，由插件生命周期持有。
- 24 处 `store()` 调用改为闭包持有的 `s`。
- 删掉 `let actCtx`：`act(ctx, s, action, payload)` 显式传参，请求不再借用全局上下文。

### 2. 工具注册交出所有权
- `registerToolWhenReady(..., owns)` 收集 `ctx.tools.register()` 返回的 disposer。
- `apply()` 用一个 `ctx.effect` 统一释放，dispose 时不留活着的注册。
- 删掉「报错文案含 duplicate 就算成功」的判法。

### 3. 客户端状态从模块级搬进实例
- `sidebarReady` / `openSidebarTab` → `createSidebarBridge()`：每次 apply 一个实例，槽位闭包与 effect 持有。
- `useSidebarBridge()` 订阅，React 渲染跟着服务就绪状态走，不再读模块级布尔量。
- `floatEnabled(state, sidebarReady)` 变成纯函数。

### 4. 侧门监听可回收
- `window.addEventListener(OPEN_EVENT, …)` 包进 `ctx.effect`，dispose 时 `removeEventListener` 同一个函数。

### 5. 测试从「断言源码」转向「断言行为」
- 新增 `ownership.test.mjs`：桩 ctx 跑 `apply()`，断言 3 个 effect、23 个工具 disposer、1 个路由 disposer 全部被持有；
  逆序 dispose 后断言 23 个工具逐个注销、路由取消注册。**这是所有权修复的自证，不是口头声明。**
- 新增：侧门监听挂载 1 个 / dispose 摘掉 1 个且是同一函数引用。
- 新增：`floatEnabled` 六种输入组合的契约。
- 源码字符串断言 54 → 37（剩余多为「不许再写成某形状」的防回归护栏）。

## 五、验证

```
node --check index.js && node --check client.js
node client-test.mjs   # 37 pass
node test.mjs          # 15 pass
node capture.test.mjs  # 8 pass
node lunar.test.mjs    # 4 pass
node ai-classify.test.mjs  # ALL PASSED
node ownership.test.mjs    # effects=3 tools=19 routes=1，dispose 后全部收回
node harness.mjs       # ALL HOST TESTS PASSED（真起 HTTP + 桩 ctx，跑 23 个工具）
```

## 六、还没做（按收益排序）

1. **store.js 按域拆分**（729 行）：持久化 / 便签 / 提醒 / 告警 / 保险库现在是同一个类。拆完每个域能单独测。
2. **`act()` 的 switch 收敛成动作表**：现在同一件事有「工具」和「HTTP action」两个入口，逻辑各写一遍。
3. **client.js 拆段**（1714 行）：样式 142 条内联规则抽成 token 常量表；浮标壳与侧栏壳共用一个 presenter，现在两套各自渲染 header/等级/提醒。
4. **剩余 37 处源码断言**逐步换成行为断言。
5. **浅色主题实测**：目前只验证过深色兜底配色。
6. **空 catch 收敛**：还有 20 处，按官方规则应单语句 + 写明为什么安全。

## 七、回滚

从 1.6.0 起本仓库按版本打 tag（`v1.5.0`、`v1.6.0`…），回滚即：

```bash
git checkout v1.5.0
```

按 README 的「安装」重新挂载，再重启 DSH 即可。
