# dsh-desk-kit 架构梳理与重构记录

> 2026-11-17 · 目标：把「能跑但难维护」的插件收拢成有明确所有权边界的结构。
>
> 注：本文是当时的记录，行数与工具数会随版本变化；当前口径以 README 和 `package.json` 为准（现为 27 个 Agent 工具）。
> 手机深链、快搜、录入提示与保险库合集见 [CHANGELOG 1.20.0](../CHANGELOG.md)。

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

1. **store.js 按域拆分**（现约 2.2k 行）：持久化 / 便签 / 提醒 / 告警 / 保险库仍在同一个类。拆完每个域能单独测。
2. **`act()` 的 switch 收敛成动作表**：现在同一件事有「工具」和「HTTP action」两个入口，逻辑各写一遍。
3. **抽公共 presenter**：client.js 已按页拆成 18 个源文件、样式已收成 token；浮标壳与侧栏壳仍各自渲染 header/等级/提醒。
4. **剩余源码字符串断言**逐步换成行为断言。
5. **浅色主题实测**：目前只验证过深色兜底配色。
6. **空 catch 收敛**：还有约 20 处，按官方规则应单语句 + 写明为什么安全。

## 七、回滚

仓库目前不维护历史 tag。回滚时先用 `git log --oneline` 找到目标提交，
再 `git checkout <commit>`；按 README 的「安装」重新挂载，并重启 DSH。

## 附件(1.11.0)

```
blobs/<id>.bin    普通附件(明文)
blobs/<id>.enc    保险库名下的附件(iv|tag|data,AES-256-GCM,钥匙与 vault.json 相同)
data.json files[] { id, name, mime, size, w, h, secret, kind, ownerId, createdAt }
```

分层理由:

- **字节与记录分开**:`data.json` 只放元信息,快照能一次下发图片尺寸(排版不跳),而 8MB 的照片不进 JSON。
- **kind/ownerId 只记一个宿主**:一条附件只属于一条便签/提醒/网页/保险库条目。转存时改这两个字段,
  不用在两个地方维护引用计数;孤儿清理只要「宿主还在不在」一个判断。
- **保险库进出都要换文件**:`setFileSecret(id, flag)` 读明文→写密文→删旧文件(或反过来),
  先写后删,中途失败最多多一个文件,不会只剩半截。
- **上传两段式**:先 `POST /desk-kit-api/files` 拿 id(还不知道要挂给谁),保存时随记录带上 `files`。
  好处是「传完后悔了」可以直接 `file.delete`,不用先造一条空记录。
- **取件不做鉴权头**:`<img src>` 带不了自定义头,所以 GET 只靠来源校验 + `CORP: same-origin`;
  写操作(POST)才要求 `x-desk-kit`。

## 查找与清理(1.12.0)

**一条数据只有一个家**:每条记录有稳定 id(`n-`/`r-`/`w-`/`s-`/`f-` 前缀),
`searchAll()` 只回 `kind + id + 命中字段`,不回内容 —— 搜到的东西永远指向磁盘上那一份,
不会出现「搜索结果里是旧副本」。

| 数据 | 怎么找 |
|---|---|
| 便签/提醒/网页 | 记录自身的字段(正文/标题/网址/备注/标签) |
| 附件 | `data.json.files[].name`;归属靠 `kind + ownerId`,一条归一个宿主 |
| 保险库 | 默认只搜 `title`;显式 `deepVault` 才在内存里解密比对内容,结果仍只回定位 |
| 垃圾箱 | 默认不搜,`includeTrash` 才带上 |

1.16.0 起,搜索会展开常见服务的中英别名(脸书/Facebook、微信/WeChat 等),并支持从结果直接定位到保险库条目。

**清理分三层,互不越权**:

1. `tick()` 每 6 小时最多跑一次 `sweepTrash()` —— 但只清「到期」和「孤儿」;
2. 保留天数由 `settings.trashKeepDays` 决定(0 = 不清垃圾箱),`cleanup.run` 可手动触发;
3. 保险库永不自动清:它没有垃圾箱,删即不可恢复。

`sweepTrash` 是**先算后删**:先把要清的条目、要释放的字节算出来返回,再落盘,
所以回执能说「清了 3 条便签,释放 1.2MB」而不是「完成」。

## 客户端为什么要拼接(1.14.0)

宿主通过 `__ModuleLoader__.load({ factory })` 加载 **一个** `client.js`,
浏览器侧没有打包器,也不能改成 ESM import。所以源码按页拆在 `src/client/*.js`,
`scripts/build-client.mjs` 按**文件名顺序**拼接成 `client.js`(产物入库)。

规矩只有一条:**改 `src/client/`,然后 `npm run build`**。
`npm test` 会先跑 `build:check`,产物与源码不一致就直接失败;
CI 里也有同一步。拆分当时的验收标准是「拼回去与拆分前逐字节相同」——
纯搬运,一个字节的逻辑都没动。
