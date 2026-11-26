# dsh-desk-kit

给 DSH 的随手台插件：提醒、便签、网页收藏、加密保险库，外加 27 个 Agent 工具。
数据只落本机 `$DSH_HOME/desk-kit/`（默认 `~/.dsh/desk-kit/`）。

## 怎么跑

```bash
npm test             # 文档一致性 + 单元 + 渲染 + 入口 + AI 分类 + 所有权
npm run check:docs   # 只查文档:版本号/链接/必备文件/测试文件清单
npm run test:host    # 真起 HTTP + 桩 ctx，跑 27 个工具
npm run test:installed
npm run test:ui      # 真浏览器 E2E（需要浏览器打开提示的地址）
```

## 技术栈

- Node.js >= 20.18，ESM，零运行时依赖。
- 服务端：`index.js` 组合根 + 同源 HTTP API；`store.js` 持久化与数据模型；领域方法在 `domains/`，导入/搜索/清理/快照各一个根模块（mixin 挂回 `DeskStore`）。
- 客户端：React 18（宿主提供），源码在 `src/client/*.js`，拼接成单文件 `client.js`。

## 目录与约定

- `index.js`：装配 store、HTTP 路由、27 个工具、定时器；不要在这里塞领域逻辑。
- `store.js`：数据模型、`loadData/save/refresh`、JSON 读写；`backup.js` / `search.js` / `maintenance.js` / `snapshot.js` 各管一摊。
- `capture.js` / `lunar.js` / `tool.js`：一句话分拣、农历、工具 schema。
- `paste.js`：粘贴网页图片时的公网地址校验、下载与大小限制。
- `src/client/`：按文件名顺序拼成 `client.js`；**改这里，再 `npm run build`**。
  样式只有一个真身：`20-style.js` 末尾的「4.0 Apple」区块 + `--dk-*` token。
- `client.js` 是生成物，不要直接改；`npm run build:check` 和 `npm test` 会验一致性。
- `test/`、`*.test.mjs`、`harness.mjs`：行为测试与真 HTTP 集成测试。
- 文档口径：产品事实（用户、目的、边界）以 `PRODUCT.md` 为准；界面理念与视觉规范以 `docs/DESIGN.md` 为准（改 UI 前必读，改完跑它的「审计门」）；能力与安装以 `README.md` + `package.json` 为准；**问题与修复的台账在 `docs/ISSUES.md`**（新问题往后加行，明确不修的写进「接受」）；历史过程进 `CHANGELOG.md`；安全边界与残余风险以 `docs/SECURITY.md` 为准。

## 当前状态

- 版本 1.33.0，27 个 Agent 工具。
- 设计语言：Utility（工具）模式，「一块浮在桌面上的玻璃」——四档 Vibrancy + 实体面 + 内凹，一个元素只取一种；60-30-10 色彩预算；同心圆角（内层 = 外层 − 内距）；石墨做动作、系统蓝做选中、系统红只报失败；静态元数据只用纯文本 + `·`。详见 `docs/DESIGN.md`，改完跑它的「审计门」。
- 已知待办：动作表收敛、历史视觉层清理、空 catch 收敛（见 `docs/ARCHITECTURE.md`）；与 `docs/DESIGN.md` 的新规矩冲突的视觉残留见该文「落在哪」一节的迁移方向。
