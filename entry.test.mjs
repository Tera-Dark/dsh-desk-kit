/**
 * 入口测试:侧栏 / 浮标 / 顶栏 / 快捷键 / 设置→插件卡片 / 斜杠命令。
 *
 * 这些东西坏了不会报错 —— 只是「入口没了」,用户看到的是「插件好像没装」。
 * 所以这里把宿主服务全桩掉,断言每一个座位都真的登记了。
 */
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const HERE = 'E:/DSH/plugins/dsh-desk-kit'
const req = createRequire('C:/Users/wjx19/.dsh/profiles/desktop/package.json')
const React = req('react')
const { renderToString } = req('react-dom/server')

let cap = null
// 真的转发 window 事件:侧门统一走 OPEN_EVENT,stub 掉 dispatchEvent 就测不出「命令能不能叫醒面板」
const listeners = new Map()
globalThis.window = {
  __ModuleLoader__: { load: (x) => { cap = x } },
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
  removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn) },
  dispatchEvent(ev) { for (const fn of listeners.get(ev && ev.type) || []) fn(ev); return true },
  localStorage: { getItem: () => null, setItem() {} },
  innerWidth: 1440,
  innerHeight: 900,
  setTimeout,
  clearTimeout,
}
globalThis.document = { head: { appendChild() {}, querySelector: () => null }, querySelector: () => null, createElement: () => ({ dataset: {}, set textContent(v) {}, set href(v) {}, click() {}, remove() {}, style: {} }), addEventListener() {}, removeEventListener() {}, hidden: false }
try { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {}, readText: async () => '' } }, configurable: true }) } catch (e) { /* node 已有 navigator:用自带的 */ }
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, state: { settings: {}, reminders: [], notes: [], links: [], secrets: [], linkCounts: {}, noteCounts: {}, reminderCounts: {} } }) })

await import(pathToFileURL(join(HERE, 'client.js')).href)
const client = cap.factory(req)
const T = client.__test
const h = React.createElement

// ---- 桩 ctx:把每个服务都记下来 ----
const slots = []
const commands = []
const shortcuts = []
const tabs = []
let opened = 0
const ctx = {
  slots: {
    inject(name, fn) { slots.push(name); try { fn() } catch (e) { throw new Error('slot ' + name + ' 注入失败:' + e.message) } },
    register(spec) { return () => {} },
  },
  effect(fn) { const off = fn(); return typeof off === 'function' ? off : () => {} },
  get(name) {
    if (name === 'betterSidebar') return { registerTab: (spec) => { tabs.push(spec); return () => {} }, openTab: () => { opened++; return true } }
    if (name === 'commandUi') return { register: (c) => { commands.push(c); return () => {} } }
    if (name === 'shortcuts') return { register: (b) => { shortcuts.push(b); return () => {} } }
    return undefined
  },
  on() { return () => {} },
}

client.apply(ctx)

assert.ok(slots.includes('shell.overlay'), '浮标/面板要挂在 shell.overlay')
assert.ok(slots.includes('conversation.session.header.utilities'), '会话顶栏要有图标')
assert.ok(slots.includes('plugins.bundle.config'), '设置→插件 的包页要能打开')
assert.ok(slots.includes('plugins.row.config'), '设置→插件 的组件行也要能打开')
assert.equal(tabs.length, 1, '侧栏标签页只登记一次')
assert.equal(tabs[0].id, 'desk-kit:main')
assert.equal(shortcuts.length, 1, '快捷键要登记')
assert.equal(shortcuts[0].id, 'desk-kit.open')
const names = commands.map((c) => c.name)
assert.ok(names.includes('desk-kit'), '斜杠命令 /desk-kit 要登记,实际:' + names.join(','))
for (const c of commands) {
  assert.equal(typeof c.description, 'function', '命令描述必须是函数(否则整份 / 列表会挂)')
  assert.equal(c.ui.kind, 'action')
}
const openCmd = commands.find((c) => c.name === 'desk-kit')
openCmd.ui.run()
assert.equal(opened, 1, '命令要能把面板叫出来')
console.log('✓ 入口:侧栏标签 · 浮标/面板 · 顶栏图标 · 快捷键 · 设置→插件卡片 · 命令 ' + names.join(' / '))

// ---- 设置→插件 卡片:概览行和整页两种视图 ----
const summary = renderToString(h(T.PluginCard, { view: 'summary' }))
assert.ok(summary.includes('提醒') && summary.includes('便签'), '概览行要有一句话:' + summary)
const page = renderToString(h(T.PluginCard, { view: 'page' }))
for (const want of ['随手台', '打开随手台', '备份', '到点提示音', '/desk-kit', 'Ctrl/Cmd+Shift+K']) {
  assert.ok(page.includes(want), '卡片里缺「' + want + '」')
}
console.log('✓ 设置卡片:概览行 + 整页(开关/备份/入口清单)都能渲染')

console.log('\nENTRY TESTS PASSED')
