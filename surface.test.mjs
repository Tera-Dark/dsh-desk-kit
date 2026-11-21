/**
 * 结构契约:重构可以搬文件,但不许把方法搬丢。
 *
 * 2026-11-21 的一次「抽文件抽到一半」让 store.js 少了 12 个方法,
 * 插件启动直接 TypeError。这组断言盯的就是这个:DeskStore 的对外形状不许少一块。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeskStore } from './store.js'

const fresh = () => new DeskStore(mkdtempSync(join(tmpdir(), 'desk-kit-surface-')))

test('拆分后形状不变:原型方法与静态方法都在', () => {
  const methods = [
    'loadData', 'save', 'refresh',
    'importBackup', 'exportAll',
    'searchAll',
    'trashEntries', 'storage', 'sweepTrash',
    'snapshot',
  ]
  for (const name of methods) {
    assert.equal(typeof DeskStore.prototype[name], 'function', 'DeskStore.prototype.' + name + ' 丢了')
  }
  assert.equal(typeof DeskStore.humanBytes, 'function', 'DeskStore.humanBytes 丢了')
})

test('快照:字段齐全,能当浏览器侧的完整视图', () => {
  const s = fresh()
  s.addNote({ text: '结构测试' })
  const snap = s.snapshot(new Date('2026-11-21T12:00:00'))
  for (const key of ['now', 'today', 'notes', 'noteCounts', 'reminders', 'alerts', 'links', 'linkGroups', 'files', 'fileCounts', 'trash', 'secrets', 'settings', 'root']) {
    assert.ok(key in snap, '快照缺字段:' + key)
  }
  assert.ok(snap.notes.some((n) => n.text === '结构测试'))
})

test('四个功能模块能单独 import:mixin 不是唯一入口', async () => {
  const [backup, search, maintenance, snapshot] = await Promise.all([
    import('./backup.js'), import('./search.js'), import('./maintenance.js'), import('./snapshot.js'),
  ])
  assert.equal(typeof backup.backup.importBackup, 'function')
  assert.equal(typeof search.search.searchAll, 'function')
  assert.equal(typeof maintenance.maintenance.sweepTrash, 'function')
  assert.equal(typeof maintenance.humanBytes, 'function')
  assert.equal(typeof snapshot.snapshot.snapshot, 'function')
})
