/**
 * 所有权测试:插件挂到宿主上的每一样东西,dispose 之后都必须收回。
 * 这是 v1.5.0 架构整理的自证 —— 之前工具注册的 disposer 被丢掉、监听没人摘。
 */
import assert from 'node:assert/strict'

process.env.DSH_HOME = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'desk-kit-own-'))

const effects = []
const toolDisposers = []
const routeDisposers = []
const serviceListeners = []

const ctx = {
  inject: (_deps, cb) => cb(),
  effect: (fn, label) => { const dispose = fn(); if (typeof dispose === 'function') effects.push({ label, dispose }); return dispose },
  get: (name) => (name === 'webServer'
    ? { register: () => { const d = () => routeDisposers.push('unregistered'); routeDisposers.push(d); return d } }
    : undefined),
  tools: { register: (def) => { const d = () => toolDisposers.push(def.name); toolDisposers.push(d); return d } },
  on: (event, fn) => { serviceListeners.push([event, fn]); return () => { serviceListeners.push(['off', event]) } },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

const { apply, name } = await import('./index.js')
assert.equal(name, 'dsh-desk-kit')
apply(ctx)

assert.equal(effects.length >= 3, true, 'apply 至少要登记 tick / 工具回收 / 路由 三个 effect,实际 ' + effects.length)
assert.equal(toolDisposers.length, 22, '22 个工具的 disposer 都要被收集,实际 ' + toolDisposers.length)
assert.equal(routeDisposers.length, 1, '路由注册的 disposer 要被 ctx.effect 持有')

// 按 Cordis 语义逆序回收
for (const { dispose } of effects.slice().reverse()) dispose()

assert.equal(toolDisposers.filter((d) => typeof d === 'function').length, 22, '22 个工具 disposer 都得跑')
const released = toolDisposers.filter((d) => typeof d === 'string')
assert.deepEqual(released.slice().sort(), [
  'desk_capture', 'desk_due', 'desk_note_add', 'desk_note_complete', 'desk_note_delete',
  'desk_note_list', 'desk_note_purge', 'desk_note_restore', 'desk_note_update',
  'desk_reminder_add', 'desk_reminder_checkin', 'desk_reminder_delete', 'desk_reminder_list',
  'desk_reminder_purge', 'desk_reminder_restore', 'desk_secret_add', 'desk_secret_delete',
  'desk_secret_get', 'desk_secret_list',
  'desk_link_add', 'desk_link_list', 'desk_link_delete',
].sort(), 'dispose 后 22 个工具都要被注销')
assert.equal(routeDisposers.includes('unregistered'), true, 'dispose 后路由要取消注册')

console.log('OWNERSHIP TESTS PASSED · effects=' + effects.length + ' tools=' + released.length + ' routes=1')