# dsh-desk-kit

给 DSH 的随手台插件：提醒、便签、网页收藏、加密保险库，外加 27 个 Agent 工具。
数据只落本机 `$DSH_HOME/desk-kit/`（默认 `~/.dsh/desk-kit/`）。

## 怎么跑

```bash
npm test             # 单元 + 渲染 + 入口 + AI 分类 + 所有权
npm run test:host    # 真起 HTTP + 桩 ctx，跑 27 个工具
npm run test:installed
npm run test:ui      # 真浏览器 E2E（需要浏览器打开提示的地址）
```

## 技术栈

- Node.js >= 20.18，ESM，零运行时依赖。
- 服务端：`index.js` 组合根 + 同源 HTTP API；`store.js` 持久化与领域逻辑。
- 客户端：React 18（宿主提供），源码在 `src/client/*.js`，拼接成单文件 `client.js`。

## 目录与约定

- `index.js`：装配 store、HTTP 路由、27 个工具、定时器；不要在这里塞领域逻辑。
- `store.js`：数据模型、持久化、保险库、清理、快照。
- `capture.js` / `lunar.js` / `tool.js`：一句话分拣、农历、工具 schema。
- `src/client/`：按文件名顺序拼成 `client.js`；**改这里，再 `npm run build`**。
- `client.js` 是生成物，不要直接改；`npm run build:check` 和 `npm test` 会验一致性。
- `test/`、`*.test.mjs`、`harness.mjs`：行为测试与真 HTTP 集成测试。
- 文档口径以 `README.md` + `package.json` 为准；历史过程进 `CHANGELOG.md`。

## 当前状态

- 版本 1.20.0，27 个 Agent 工具。
- 已知待办：store 按域拆分、动作表收敛、浅色主题实测、空 catch 收敛（见 `docs/ARCHITECTURE.md`）。
