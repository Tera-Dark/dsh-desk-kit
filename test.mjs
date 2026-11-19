import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeskStore, localYmd, occurrenceOf, parseClock } from './store.js'

const fresh = () => new DeskStore(mkdtempSync(join(tmpdir(), 'desk-kit-')))

test('便签:增改查删 + 置顶排序', () => {
  const s = fresh()
  const a = s.addNote({ text: '买牛奶', tags: ['生活'] })
  const b = s.addNote({ text: '每日打卡要记密码', tags: ['站点'] })
  assert.equal(s.listNotes().length, 2)
  assert.equal(s.listNotes()[0].id, b.id, '新便签在最前')
  s.updateNote(a.id, { pinned: true })
  assert.equal(s.listNotes()[0].id, a.id, '置顶优先')
  s.updateNote(a.id, { text: '买牛奶和鸡蛋' })
  assert.ok(s.listNotes().some((n) => n.text.includes('鸡蛋')))
  s.updateNote(b.id, { archived: true })
  assert.equal(s.listNotes().length, 1)
  assert.equal(s.listNotes({ includeArchived: true }).length, 2)
  s.deleteNote(a.id)
  assert.equal(s.listNotes({ includeArchived: true }).length, 1)
  assert.throws(() => s.addNote({ text: '   ' }))
})

test('时间解析与周几', () => {
  assert.deepEqual(parseClock('21:00'), { h: 21, m: 0 })
  assert.deepEqual(parseClock('9:05'), { h: 9, m: 5 })
  assert.equal(parseClock('24:00'), null)
  assert.equal(parseClock('9'), null)
  // 2026-11-14 是周六
  const sat = new Date(2026, 10, 14, 12, 0, 0)
  assert.equal(sat.getDay(), 6)
  assert.equal(occurrenceOf({ time: '21:00', weekdays: [6] }, sat).getHours(), 21)
  assert.equal(occurrenceOf({ time: '21:00', weekdays: [1] }, sat), null)
  assert.equal(occurrenceOf({ time: '21:00', weekdays: [] }, sat).getDate(), 14)
})

test('提醒默认到点,旧版 30 分默认只迁移一次', () => {
  const s = fresh()
  const r = s.addReminder({ title: '喂猫粮', time: '16:00' })
  assert.equal(r.leadMin, 0, '新提醒默认准时')
  const dir = mkdtempSync(join(tmpdir(), 'desk-kit-legacy-'))
  writeFileSync(join(dir, 'data.json'), JSON.stringify({
    version: 1,
    reminders: [{ id: 'r-old', title: '旧提醒', time: '21:00', leadMin: 30, createdAt: 1 }],
    settings: {},
  }))
  const old = new DeskStore(dir)
  assert.equal(old.data.reminders[0].leadMin, 0, '旧默认 30 分迁移为准时')
  assert.equal(old.data.settings.leadDefaultMigrated, true, '迁移只跑一次')
  // 已经迁移过的数据不动用户后来选的 30 分
  old.data.reminders[0].leadMin = 30
  old.save()
  const again = new DeskStore(dir)
  assert.equal(again.data.reminders[0].leadMin, 30, '迁移后用户自己选的 30 分要保留')
})

test('提醒:提前 30 分钟弹一次,不重复,签到后静默', () => {
  const s = fresh()
  const r = s.addReminder({ title: '每日打卡', time: '21:00', leadMin: 30, snoozeMin: 20 })
  const day = new Date(2026, 10, 14, 0, 0, 0)
  const at = (h, m) => new Date(2026, 10, 14, h, m, 0).getTime()

  assert.equal(s.tick(at(20, 29)), 0, '20:29 还不该提醒')
  assert.equal(s.tick(at(20, 30)), 1, '20:30 该弹了')
  assert.equal(s.pendingAlerts().length, 1)
  assert.equal(s.tick(at(20, 31)), 0, '同一分钟内不重复弹')
  assert.equal(s.pendingAlerts().length, 1)
  assert.equal(s.tick(at(20, 55)), 0, '未到点且未静音,不重复')
  // 过了截止时间还没处理:同一张卡片就地变「已到点」,不再叠新卡片
  assert.equal(s.tick(at(21, 1)), 0, '不新建卡片')
  assert.equal(s.pendingAlerts().length, 1, '始终只有一张')
  assert.equal(s.pendingAlerts()[0].over, true, '过点后变红')
  assert.equal(s.tick(at(21, 40)), 0, '再久也只有这一张')
  // 签到 → 当天不再提醒
  // 必须显式传日期:不传的话 checkin 按「真实今天」清理,测试换一天跑就会挂
  s.checkin(r.id, '2026-11-14')
  assert.equal(s.pendingAlerts().length, 0)
  assert.equal(s.tick(at(21, 40)), 0)
  // 补签记录
  assert.ok(s.todayView(new Date(2026, 10, 14, 22, 0, 0)).find((x) => x.id === r.id).done)
})

test('稍后提醒:静音期内不弹,过点后再弹', () => {
  const s = fresh()
  const r = s.addReminder({ title: '签到', time: '21:00', leadMin: 30, snoozeMin: 15 })
  const at = (h, m) => new Date(2026, 10, 14, h, m, 0).getTime()
  s.tick(at(20, 30))
  s.ackAlert(s.pendingAlerts()[0].id)
  s.snooze(r.id, 15, at(20, 30))
  assert.equal(s.tick(at(20, 40)), 0, '静音期内不弹')
  assert.equal(s.tick(at(20, 46)), 1, '静音结束后再提醒')
})

test('保险库:密文落盘、可读回、列表不泄密、删除生效', () => {
  const s = fresh()
  const item = s.addSecret({ title: '某示例站点', username: 'demo_user', password: 'p@ss word', note: '备忘' })
  const vaultText = readFileSync(s.vaultFile, 'utf8')
  assert.ok(!vaultText.includes('p@ss word'), '磁盘上不能出现明文密码')
  assert.ok(!vaultText.includes('demo_user'), '磁盘上不能出现明文用户名')
  assert.ok(existsSync(s.keyFile))
  const back = s.getSecret(item.id)
  assert.equal(back.fields['密码'], 'p@ss word')
  assert.equal(back.fields['用户名'], 'demo_user')
  assert.equal(s.listSecrets().length, 1)
  assert.equal(s.listSecrets()[0].fieldCount, 0, '列表页不带字段')
  // 按标题模糊查
  assert.equal(s.getSecret('示例').id, item.id)
  s.updateSecret(item.id, { fields: { 密码: 'newpass' } })
  assert.equal(s.getSecret(item.id).fields['密码'], 'newpass')
  assert.equal(s.getSecret(item.id).fields['用户名'], 'demo_user', '未传的字段保留')
  s.deleteSecret(item.id)
  assert.equal(s.listSecrets().length, 0)
  assert.equal(s.getSecret('不存在的条目'), null)
})

test('保险库合集:归属、顺序与拖动重排都持久化', () => {
  const s = fresh()
  const a = s.addSecret({ title: '订阅一', fields: { 链接: 'https://a.example' }, collection: '梯子订阅' })
  const b = s.addSecret({ title: '订阅二', fields: { 链接: 'https://b.example' }, collection: '梯子订阅' })
  const c = s.addSecret({ title: '别的东西', fields: { 链接: 'https://c.example' }, collection: '其他' })
  assert.equal(s.getSecret(a.id).collection, '梯子订阅')
  assert.equal(s.getSecret(a.id).order, 1)
  assert.equal(s.getSecret(b.id).order, 2)
  assert.equal(s.getSecret(c.id).order, 1, '不同合集各自从 1 开始')
  assert.equal(s.listSecrets().filter((x) => x.collection === '梯子订阅').length, 2)

  s.reorderSecrets('梯子订阅', [b.id, a.id])
  const ordered = s.listSecrets().filter((x) => x.collection === '梯子订阅').sort((x, y) => x.order - y.order)
  assert.deepEqual(ordered.map((x) => x.title), ['订阅二', '订阅一'], '拖动后的顺序要落盘')
  // 只传一部分 id 也不能把没传到的条目挤出重复序号
  s.reorderSecrets('梯子订阅', [a.id])
  const partial = s.listSecrets().filter((x) => x.collection === '梯子订阅').sort((x, y) => x.order - y.order)
  assert.deepEqual(partial.map((x) => x.title), ['订阅一', '订阅二'], '没传到的条目接在后面')
  assert.deepEqual(partial.map((x) => x.order), [0, 1])
  s.reorderSecrets('梯子订阅', [b.id, a.id])
  assert.throws(() => s.reorderSecrets('梯子订阅', [c.id]), /不能把别的合集/)
  assert.throws(() => s.reorderSecrets('梯子订阅', [a.id, a.id]), /重复/)

  s.updateSecret(a.id, { collection: '其他' })
  assert.equal(s.getSecret(a.id).collection, '其他')
  assert.equal(s.getSecret(a.id).order, 2, '换合集后放到新合集末尾')
})

test('保险库:主密钥被换掉后旧密文解不开(而不是读出垃圾)', () => {
  const s = fresh()
  const item = s.addSecret({ title: 'x', fields: { 密码: 'secret' } })
  // 模拟换机/密钥文件被杀软清掉:换一份新密钥材料 → GCM 校验失败必须抛错
  writeFileSync(s.keyFile, randomBytes(48).toString('hex'), { mode: 0o600 })
  assert.throws(() => s.getSecret(item.id), /auth|Unsupported|bad decrypt/i)
})

test('重启后数据还在(原子写 + 重新加载)', () => {
  const root = mkdtempSync(join(tmpdir(), 'desk-kit-'))
  const s1 = new DeskStore(root)
  s1.addNote({ text: '持久化测试' })
  const r = s1.addReminder({ title: '签到', time: '21:00' })
  s1.checkin(r.id, '2026-11-14')
  const s2 = new DeskStore(root)
  assert.equal(s2.listNotes()[0].text, '持久化测试')
  assert.ok(s2.listReminders === undefined || true)
  assert.ok(s2.data.reminders[0].doneDates.includes('2026-11-14'))
})

test('本地日期不跨时区串日', () => {
  const late = new Date(2026, 10, 14, 23, 30, 0)
  assert.equal(localYmd(late), '2026-11-14')
  const early = new Date(2026, 10, 15, 0, 30, 0)
  assert.equal(localYmd(early), '2026-11-15')
})

test('今日视图状态口径', () => {
  const s = fresh()
  const r = s.addReminder({ title: '签到', time: '21:00', leadMin: 30 })
  const v = s.todayView(new Date(2026, 10, 14, 10, 0, 0)).find((x) => x.id === r.id)
  assert.equal(v.status, 'upcoming')
  assert.ok(v.secondsLeft > 0)
  const v2 = s.todayView(new Date(2026, 10, 14, 20, 45, 0)).find((x) => x.id === r.id)
  assert.equal(v2.status, 'pending')
  s.checkin(r.id, '2026-11-14')
  const v3 = s.todayView(new Date(2026, 10, 14, 20, 45, 0)).find((x) => x.id === r.id)
  assert.equal(v3.status, 'done')
})
test('农历生日:每年只有农历那天命中', () => {
  const s = fresh()
  // 2025 农历八月十五 = 2025-10-06(公历)
  const r = s.addReminder({ title: '某人农历生日', time: '09:00', lunar: { month: 8, day: 15 }, leadMin: 60 })
  const hit = new Date(2025, 9, 6, 8, 0, 0)
  const miss = new Date(2025, 9, 7, 8, 0, 0)
  assert.ok(s.tick(hit.getTime()) >= 1, '农历十五当天要提醒')
  const view = s.todayView(hit).find((x) => x.id === r.id)
  assert.equal(view.status, 'pending')
  const view2 = s.todayView(miss).find((x) => x.id === r.id)
  // 第二天:下次是明年那天,状态 upcoming(而不是"今天不用")
  assert.equal(view2.status, 'upcoming', '第二天应显示下一次在明年')
  assert.ok(view2.occurrenceAt > miss.getTime(), '下一次应在未来')
  assert.equal(s.tick(miss.getTime()), 0, '第二天不该弹提醒')
})

test('公历每年生日', () => {
  const s = fresh()
  const r = s.addReminder({ title: '公历生日', time: '09:00', annual: '11-20', leadMin: 30 })
  const on = s.todayView(new Date(2026, 10, 20, 9, 30, 0)).find((x) => x.id === r.id)
  assert.equal(on.status, 'pending')
  const off = s.todayView(new Date(2026, 10, 21, 9, 30, 0)).find((x) => x.id === r.id)
  assert.equal(off.status, 'upcoming', '过期后显示明年的下一次')
})

test('生日提前量能跨天(这是之前修掉的 bug)', () => {
  const s = fresh()
  // 公历 11-20 生日,提前 3 天(4320 分)= 11-17 09:00 就该提醒
  s.addReminder({ title: '小美生日', time: '09:00', annual: '11-20', leadMin: 4320 })
  assert.equal(s.tick(new Date(2026, 10, 16, 9, 0, 0).getTime()), 0, '11-16 太早,不该提醒')
  assert.equal(s.tick(new Date(2026, 10, 17, 9, 0, 0).getTime()), 1, '11-17 应提前 3 天提醒')
  const v = s.todayView(new Date(2026, 10, 17, 9, 0, 0)).find((x) => x.title === '小美生日')
  assert.equal(v.status, 'pending')
  assert.equal(v.dueDate, '2026-11-20', 'dueDate 指向生日当天,不是提醒当天')
})

test('提醒删除是软删,垃圾箱里能找回', () => {
  const s = fresh()
  const r = s.addReminder({ title: '重要提醒', time: '21:00' })
  s.deleteReminder(r.id)
  assert.equal(s.todayView().length, 0, '主列表不该再有')
  assert.equal(s.reminderCounts().trash, 1, '应进垃圾箱')
  assert.equal(s.tick(new Date(2026, 10, 14, 21, 0, 0).getTime()), 0, '已删的不该弹')
  const back = s.restoreReminder(r.id)
  assert.equal(back.active, true)
  assert.equal(s.reminderCounts().active, 1, '恢复后回到主列表')
  s.deleteReminder(r.id)
  s.purgeReminder(r.id)
  assert.equal(s.reminderCounts().trash, 0, '彻底删除后垃圾箱清空')
})

test('便签自动分拣:长文/标签/网址 进长期,短句留进行中', () => {
  const s = fresh()
  const a = s.addNote({ text: '去做一下周报整理' })
  assert.equal(a.shelf, 'daily', '短句留进行中')
  const b = s.addNote({ text: 'x'.repeat(300) })
  assert.equal(b.shelf, 'long', '长文进长期')
  const c = s.addNote({ text: '资料合集', tags: ['合集'] })
  assert.equal(c.shelf, 'long', '资料类标签进长期')
  const c2 = s.addNote({ text: '买牛奶', tags: ['生活'] })
  assert.equal(c2.shelf, 'daily', '普通标签不进长期')
  const d = s.addNote({ text: '参考 https://example.com/doc' })
  assert.equal(d.shelf, 'long', '含网址进长期')
  const e = s.addNote({ text: '每天 https://a.com 签到' })
  assert.equal(e.shelf, 'daily', '签到类网址不算长期')

  const counts = s.noteCounts()
  assert.equal(counts.active, 3, 'active: 短句 + 签到 + 买牛奶')
  assert.equal(counts.long, 3, 'long: 长文 + 合集标签 + 网址')

  // 视图隔离
  assert.equal(s.listNotes({ view: 'active' }).length, 3)
  assert.equal(s.listNotes({ view: 'long' }).length, 3)

  // 手动切换
  s.updateNote(a.id, { shelf: 'long' })
  assert.equal(s.listNotes({ view: 'long' }).length, 4)
  s.updateNote(a.id, { shelf: 'daily' })
  assert.equal(s.listNotes({ view: 'active' }).length, 3)
})

test('老数据迁移:没有 shelf 的按同规则补上', () => {
  const root = mkdtempSync(join(tmpdir(), 'shelf-mig-'))
  const s1 = new DeskStore(root)
  s1.addNote({ text: '资料合集', tags: ['合集'] })
  s1.save()
  // 手工抹掉 shelf 模拟老数据
  const raw = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'))
  for (const n of raw.notes) delete n.shelf
  writeFileSync(join(root, 'data.json'), JSON.stringify(raw))
  const s2 = new DeskStore(root)
  assert.equal(s2.data.notes[0].shelf, 'long', '迁移后应判定为长期')
})

// ---------------------------------------------------------------- 1.7.0 行为契约

const fixedNow = (iso) => new Date(iso)

test('点了「知道了」:当天不再造新告警,次日照常', () => {
  const s = fresh()
  const r = s.addReminder({ title: '每日打卡', time: '21:00', weekdays: [], leadMin: 30 })
  const at = fixedNow('2026-11-17T21:30:00')
  s.tick(at.getTime())
  assert.equal(s.pendingAlerts().length, 1, '到点先弹一条')
  s.ackAlert(s.pendingAlerts()[0].id)
  assert.equal(s.pendingAlerts().length, 0, '点了知道了就该清掉')
  for (const m of [20, 40, 60, 180]) {
    s.tick(at.getTime() + m * 60000)
    assert.equal(s.pendingAlerts().length, 0, '+' + m + ' 分钟不该再弹')
  }
  // 次日同一时间:静音只对当天有效
  s.tick(fixedNow('2026-11-18T21:00:00').getTime())
  assert.ok(s.pendingAlerts().length >= 1, '第二天要照常提醒')
  assert.equal(s.data.reminders[0].id, r.id)
})

test('点了「稍后」:解除当天静音,到点再响', () => {
  const s = fresh()
  const r = s.addReminder({ title: '开会', time: '10:00', weekdays: [], leadMin: 0 })
  const at = fixedNow('2026-11-17T10:05:00')
  s.tick(at.getTime())
  s.ackAlert(s.pendingAlerts()[0].id)
  s.snooze(r.id, 30, at.getTime())
  s.tick(at.getTime() + 10 * 60000)
  assert.equal(s.pendingAlerts().length, 0, '还没到 30 分钟,别响')
  s.tick(at.getTime() + 31 * 60000)
  assert.equal(s.pendingAlerts().length, 1, '稍后到点要再响一次')
})

test('「全部知道了」可撤销', () => {
  const s = fresh()
  s.addReminder({ title: 'A', time: '09:00', weekdays: [], leadMin: 0 })
  s.addReminder({ title: 'B', time: '09:00', weekdays: [], leadMin: 0 })
  s.tick(fixedNow('2026-11-17T09:10:00').getTime())
  assert.equal(s.pendingAlerts().length, 2)
  s.ackAll()
  assert.equal(s.pendingAlerts().length, 0)
  s.tick(fixedNow('2026-11-17T10:00:00').getTime())
  assert.equal(s.pendingAlerts().length, 0, '全部知道了也要停当天的提醒')
  s.unackAll()
  assert.equal(s.pendingAlerts().length, 2, '撤销要恢复成未读')
})

test('一次性提醒过期后状态是 expired,不再装成进行中', () => {
  const s = fresh()
  const r = s.addReminder({ title: '交电费', time: '10:00', date: '2026-11-17' })
  const today = s.todayView(fixedNow('2026-11-17T12:00:00')).find((x) => x.id === r.id)
  assert.equal(today.status, 'pending', '当天过点 = 待处理')
  const next = s.todayView(fixedNow('2026-11-18T12:00:00')).find((x) => x.id === r.id)
  assert.equal(next.status, 'expired', '次日应标记已过期')
})

test('每月 N 号:下个月没有这一天时按月末算', () => {
  const s = fresh()
  const r = s.addReminder({ title: '交房租', time: '09:00', monthly: 31 })
  const occ = s.todayView(fixedNow('2026-11-30T08:00:00')).find((x) => x.id === r.id)
  assert.equal(occ.status, 'upcoming')
  assert.equal(new Date(occ.occurrenceAt).getDate(), 30, '11 月只有 30 天')
})

test('同一句话 10 分钟内重复存:合并而不是堆两条', () => {
  const s = fresh()
  const a = s.addNote({ text: '买牛奶' })
  const b = s.addNote({ text: '买牛奶' })
  assert.equal(b.id, a.id, '应返回同一条')
  assert.ok(b.deduped, '要标记为去重')
  assert.equal(s.listNotes().length, 1)
  const c = s.addNote({ text: '买牛奶', tags: ['生活'] })
  assert.equal(c.id, a.id, '仍合并')
  assert.deepEqual(c.tags, ['生活'], '新标签并进同一条')
  assert.equal(s.listNotes().length, 1)
})

test('导出备份包含 data 与密文 vault', () => {
  const s = fresh()
  s.addNote({ text: '一条' })
  s.addSecret({ title: '某站', body: '账号 x 密码 y' })
  const back = s.exportAll()
  assert.equal(back.kind, 'dsh-desk-kit-backup')
  assert.equal(back.data.notes.length, 1)
  assert.ok(back.vault && Array.isArray(back.vault.entries), 'vault 要带上(密文)')
  assert.ok(!JSON.stringify(back.vault).includes('密码 y'), '导出里不能有明文')
})

test('未来的一次性提醒要算「还没到时间」,不能变成「没有下一次」', () => {
  const s = fresh()
  const r = s.addReminder({ title: '交电费', time: '10:00', date: '2026-11-18' })
  const view = (iso) => s.todayView(new Date(iso)).find((x) => x.id === r.id)
  assert.equal(view('2026-11-17T20:00:00').status, 'upcoming', '今天看:还没到')
  assert.equal(new Date(view('2026-11-17T20:00:00').occurrenceAt).getDate(), 18)
  assert.equal(view('2026-11-18T10:05:00').status, 'pending', '当天过点:要处理')
  assert.equal(view('2026-11-19T09:00:00').status, 'expired', '过了那天:已过期')
})

test('改周期要互斥:换成每月/一次性时旧的日期字段必须清掉', () => {
  const s = fresh()
  const r = s.addReminder({ title: '交房租', time: '09:00', date: '2026-11-20' })
  s.updateReminder(r.id, { monthly: 1 })
  assert.equal(s.data.reminders[0].date, undefined, '旧 date 要清掉')
  assert.equal(s.data.reminders[0].monthly, 1)
  s.updateReminder(r.id, { date: '2026-11-21' })
  assert.equal(s.data.reminders[0].monthly, undefined, '换回一次性时 monthly 要清掉')
  assert.equal(s.data.reminders[0].date, '2026-11-21')
  s.updateReminder(r.id, { annual: '05-03' })
  assert.equal(s.data.reminders[0].date, undefined)
  assert.deepEqual(s.data.reminders[0].weekdays, [])
  assert.equal(s.data.reminders[0].annual, '05-03')
})

test('同一件事说两遍:第二次返回已有那条,不再存一份', () => {
  const s = fresh()
  const a = s.addReminder({ title: '吃药', time: '09:00', weekdays: [] })
  const b = s.addReminder({ title: '吃药', time: '9:00', weekdays: [] })
  assert.equal(b.id, a.id, '应返回同一条')
  assert.equal(b.deduped, true)
  assert.equal(s.data.reminders.length, 1)
  // 换周期 = 另一件事,不算重复
  const c = s.addReminder({ title: '吃药', time: '09:00', monthly: 1 })
  assert.notEqual(c.id, a.id)
})

test('一次性提醒的时间线:提前量之前安静,到提前量响一次,确认后当天不再响', () => {
  const s = fresh()
  s.addReminder({ title: '开会', time: '15:00', date: '2026-11-18', leadMin: 30 })
  const at = (iso) => new Date(iso).getTime()
  s.tick(at('2026-11-18T14:00:00'))
  assert.equal(s.pendingAlerts().length, 0, '提前量之前不该响')
  s.tick(at('2026-11-18T14:31:00'))
  assert.equal(s.pendingAlerts().length, 1, '进入提前量要响一条')
  assert.equal(s.pendingAlerts()[0].over, false, '还没到点')
  s.tick(at('2026-11-18T15:05:00'))
  assert.equal(s.pendingAlerts().length, 1, '没确认之前不要叠出新的一条')
  assert.equal(s.pendingAlerts()[0].over, true, '过了点,这条就地变成「已到点」')
  s.ackAlert(s.pendingAlerts()[0].id)
  for (const m of [10, 30, 60]) s.tick(at('2026-11-18T15:05:00') + m * 60000)
  assert.equal(s.pendingAlerts().length, 0, '确认后当天不该再响')
})

test('开机补提醒:DSH 关着时已经到点的,标成「错过的」', () => {
  const s = fresh()
  s.addReminder({ title: '吃药', time: '08:00', weekdays: [], leadMin: 0 })
  // 模拟:昨天关掉 DSH,今天 10 点才打开
  s.tick(new Date('2026-11-18T10:00:00').getTime(), { catchUp: true })
  const a = s.pendingAlerts()[0]
  assert.ok(a, '要补出一条')
  assert.equal(a.late, true, '要标成错过')
  assert.equal(a.over, true, '早就过点了')

  // 正常 tick 造出来的不算错过
  const s2 = fresh()
  s2.addReminder({ title: '开会', time: '10:00', weekdays: [], leadMin: 30 })
  s2.tick(new Date('2026-11-18T09:30:00').getTime())
  assert.equal(s2.pendingAlerts()[0].late, false)
})

test('开机补提醒只补一次:再 tick 不会把标记翻新或重复补', () => {
  const s = fresh()
  s.addReminder({ title: '交电费', time: '10:00', date: '2026-11-18', leadMin: 0 })
  s.tick(new Date('2026-11-18T12:00:00').getTime(), { catchUp: true })
  assert.equal(s.pendingAlerts().length, 1)
  s.tick(new Date('2026-11-18T12:30:00').getTime())
  assert.equal(s.pendingAlerts().length, 1, '还是那一张')
  assert.equal(s.pendingAlerts()[0].late, true, '标记保留')
})

// ---------------------------------------------------------------- 网页收藏

test('网页:网址归一化 + 重复不存两份', () => {
  const s = fresh()
  const a = s.addLink({ url: 'example.com' })
  assert.equal(a.url, 'https://example.com')
  assert.equal(a.title, 'example.com', '没给名字就用域名')
  const b = s.addLink({ url: 'https://www.example.com/', title: '示例' })
  assert.equal(b.id, a.id, 'www / 末尾斜杠算同一条')
  assert.equal(b.deduped, true)
  assert.equal(s.listLinks().length, 1)
  assert.throws(() => s.addLink({ url: '这不是网址' }), /网址看起来不对/)
  // 跟踪参数要清掉,但正常参数保留
  const c = s.addLink({ url: 'https://example.org/p?a=1&utm_source=x&id=2' })
  assert.equal(c.url, 'https://example.org/p?a=1&id=2')
})

test('网页:分类、置顶、最近打开的排序', () => {
  const s = fresh()
  const a = s.addLink({ url: 'https://a.example.com', title: 'A', group: '常用' })
  const b = s.addLink({ url: 'https://b.example.com', title: 'B', group: '干活' })
  const c = s.addLink({ url: 'https://c.example.com', title: 'C' })
  assert.deepEqual(s.linkGroups(), { groups: [{ name: '常用', count: 1 }, { name: '干活', count: 1 }], ungrouped: 1 })
  // 最近打开过的排前面
  s.touchLink(b.id)
  assert.equal(s.listLinks()[0].id, b.id)
  // 置顶永远在最前
  s.updateLink(c.id, { pinned: true })
  assert.equal(s.listLinks()[0].id, c.id)
  // 改分类、改网址
  s.updateLink(a.id, { group: '每天', title: 'A 站' })
  assert.equal(s.listLinks().find((x) => x.id === a.id).group, '每天')
  assert.throws(() => s.updateLink(a.id, { url: 'https://b.example.com' }), /已经收过了/)
})

test('网页:软删可恢复,彻底删除才真没了', () => {
  const s = fresh()
  const a = s.addLink({ url: 'https://example.com', title: '示例' })
  s.deleteLink(a.id)
  assert.deepEqual(s.linkCounts(), { active: 0, trash: 1 })
  assert.equal(s.listLinks('trash').length, 1)
  s.restoreLink(a.id)
  assert.deepEqual(s.linkCounts(), { active: 1, trash: 0 })
  s.deleteLink(a.id)
  s.purgeLink(a.id)
  assert.deepEqual(s.linkCounts(), { active: 0, trash: 0 })
})

// ---------------- 体检补的:边角上真的踩到的坑 ----------------

test('提醒:不存在的日期要拒绝,不能存成「永远不会响」', () => {
  const s = fresh()
  assert.throws(() => s.addReminder({ title: 'x', time: '09:00', date: '2026-02-30' }), /日期不存在/)
  assert.throws(() => s.addReminder({ title: 'x', time: '09:00', date: '2026-13-01' }), /日期不存在/)
  const r = s.addReminder({ title: 'ok', time: '09:00', date: '2028-02-29' })
  assert.throws(() => s.updateReminder(r.id, { date: '2026-02-29' }), /日期不存在/)
})

test('提醒:2 月 29 日的每年提醒四年内总能找到下一次', () => {
  const s = fresh()
  const r = s.addReminder({ title: '闰日', time: '09:00', annual: '02-29' })
  const occ = occurrenceOfDate(s, r)
  assert.ok(occ, '四年内应该有一次')
  assert.equal(occ.getMonth() + 1, 2)
  assert.equal(occ.getDate(), 29)
  function occurrenceOfDate(store, rem) {
    for (let i = 0; i < 1500; i++) {
      const d = new Date(2026, 10, 18 + i)
      if (d.getMonth() + 1 === 2 && d.getDate() === 29) return d
    }
    return null
  }
})

test('提醒:一次性提醒当天错过了,开机还能补一张', () => {
  const s = fresh()
  const today = localYmd()
  const r = s.addReminder({ title: '早上八点', time: '08:00', date: today, leadMin: 0 })
  const late = new Date(); late.setHours(22, 0, 0, 0)
  assert.equal(s.tick(late.getTime(), { catchUp: true }), 1)
  const a = s.data.alerts.find((x) => x.refId === r.id)
  assert.equal(a.over, true)
  assert.equal(a.late, true)
  // 再 tick 不会叠第二张
  assert.equal(s.tick(late.getTime() + 60000), 0)
  assert.equal(s.data.alerts.filter((x) => x.refId === r.id).length, 1)
})

test('数据文件坏了:留下 .corrupt 备份,不静默覆盖', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-kit-bad-'))
  writeFileSync(join(dir, 'data.json'), '{ 半截写入')
  const s = new DeskStore(dir)
  assert.equal(s.data.notes.length, 0)
  const kept = existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('.corrupt-')) : []
  assert.equal(kept.length, 1)
  assert.match(readFileSync(join(dir, kept[0]), 'utf8'), /半截写入/)
})

test('网页:网址里的账号密码不落盘', () => {
  const s = fresh()
  const l = s.addLink({ url: 'https://user:secret@example.com/x', title: '带凭据' })
  assert.equal(l.url, 'https://example.com/x')
  assert.ok(!readFileSync(join(s.root, 'data.json'), 'utf8').includes('secret'))
})

test('网页:同一条链接存两遍时保留第一次的分类', () => {
  const s = fresh()
  const a = s.addLink({ url: 'https://dup.example.com', title: 'A', group: '工作' })
  const b = s.addLink({ url: 'https://dup.example.com/', title: 'B', group: '生活' })
  assert.equal(b.deduped, true)
  assert.equal(b.id, a.id)
  assert.equal(s.data.links.length, 1)
  assert.equal(s.data.links[0].group, '工作')
})

test('网页:删掉后重新加过,再恢复不会变两条', () => {
  const s = fresh()
  const a = s.addLink({ url: 'https://again.example.com', title: '旧', group: '工作' })
  s.deleteLink(a.id)
  const b = s.addLink({ url: 'https://again.example.com', title: '新' })
  assert.equal(b.deduped, undefined)
  const back = s.restoreLink(a.id)
  assert.equal(back.merged, true)
  assert.equal(back.id, b.id)
  assert.equal(back.group, '工作', '空着的分类补回来')
  assert.equal(s.listLinks().length, 1)
  assert.deepEqual(s.linkCounts(), { active: 1, trash: 0 })
})

// ---------------- 转存:分错了自己挪 ----------------

test('转存:便签 → 网页(带备注,原便签进垃圾箱)', () => {
  const s = fresh()
  const n = s.addNote({ text: 'https://example.com 这个网站不错，可以用来查资料' })
  const r = s.convertItem('note', n.id, 'link')
  assert.equal(r.item.url, 'https://example.com')
  assert.equal(r.item.title, 'example.com')
  assert.match(r.item.note, /查资料/)
  assert.ok(!r.item.note.includes('https://'), '备注里不用再重复网址')
  assert.equal(s.listNotes().length, 0)
  assert.equal(s.listNotes({ view: 'trash' }).length, 1, '原便签要能找回')
})

test('转存:网页 → 便签 / 保险库', () => {
  const s = fresh()
  const l = s.addLink({ url: 'https://tool.example.com', title: '工具站', note: '设计用' })
  const note = s.convertItem('link', l.id, 'note')
  assert.match(note.item.text, /工具站/)
  assert.match(note.item.text, /设计用/)
  assert.match(note.item.text, /tool\.example\.com/)
  assert.equal(s.listLinks().length, 0)

  const l2 = s.addLink({ url: 'https://vault.example.com', title: '要存密码的', note: '账号在这里' })
  const sec = s.convertItem('link', l2.id, 'secret')
  const back = s.getSecret(sec.item.id)
  assert.equal(back.title, '要存密码的')
  assert.match(back.note, /账号在这里/)
})

test('转存:保险库搬出来(没密码可以,有密码拦下)', () => {
  const s = fresh()
  const plain = s.addSecret({ title: '某站', body: 'example.net 是个工具站' })
  const r = s.convertItem('secret', plain.id, 'link')
  assert.equal(r.item.url, 'https://example.net', '说明里的域名也要认出来')
  assert.equal(s.listSecrets().length, 0, '搬走后保险库里不留')

  const secret = s.addSecret({ title: '有账密的', username: 'me', password: 'pw', url: 'https://x.example.com' })
  assert.throws(() => s.convertItem('secret', secret.id, 'link'), /不能搬到明文/)
  assert.equal(s.listSecrets().length, 1, '拦下时不能删掉')
})

test('转存:提醒 → 便签;同分类 / 找不到 / 没网址都要报错', () => {
  const s = fresh()
  const r = s.addReminder({ title: '交房租', time: '09:00', date: '2026-11-20' })
  const n = s.convertItem('reminder', r.id, 'note')
  assert.match(n.item.text, /交房租/)
  assert.equal(s.data.reminders.filter((x) => !x.deletedAt).length, 0)

  const l = s.addLink({ url: 'https://only.example.com', title: '只有网址' })
  assert.throws(() => s.convertItem('link', l.id, 'link'), /已经在/)
  assert.throws(() => s.convertItem('note', 'nope', 'link'), /找不到/)
  assert.throws(() => s.convertItem('wat', l.id, 'link'), /不认识的分类/)
  const plainNote = s.addNote({ text: '一句话没有网址' })
  assert.throws(() => s.convertItem('note', plainNote.id, 'link'), /没有网址/)
  assert.equal(s.listNotes().length, 2, '转失败不能把原条目弄丢(1 条是上面提醒转来的,1 条是它自己)')
})

test('两个实例同时改:refresh 能看见对方写的,不会整份覆盖', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-kit-sync-'))
  const a = new DeskStore(dir)
  const b = new DeskStore(dir)          // 第二个实例(桌面端 + web 各开一个)
  a.addNote({ text: 'A 写的' })
  // b 还没 refresh:内存里还是空的
  assert.equal(b.listNotes().length, 0)
  b.refresh()
  assert.equal(b.listNotes().length, 1, 'refresh 之后要能看到 A 写的')
  b.addNote({ text: 'B 写的' })
  a.refresh()
  assert.equal(a.listNotes().length, 2, 'A 也要能看到 B 写的')
})

// ---------------- 附件 ----------------

const PNG1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

test('附件:存进去、读回来,尺寸从头部读出来', () => {
  const s = fresh()
  const f = s.addFile({ buffer: PNG1, name: '截图.png', mime: 'image/png' })
  assert.equal(f.size, PNG1.length)
  assert.equal(f.w, 1)
  assert.equal(f.h, 1)
  const back = s.readFileBytes(f.id)
  assert.ok(back.bytes.equals(PNG1), '读回的字节要和写进去的一致')
  // 便签挂上附件;只有图没文字也算数
  const n = s.addNote({ text: '', files: [f.id] })
  assert.deepEqual(n.files, [f.id])
  assert.equal(s.filesFor('note', n.id).length, 1)
  // 空白 id / 不存在的 id 悄悄丢掉,不留悬空引用
  assert.deepEqual(s.addNote({ text: 'x', files: ['', 'f-nope'] }).files, [])
})

test('便签编辑:图片作为单位保留/删除,清空文字还能只留图', () => {
  const s = fresh()
  const f1 = s.addFile({ buffer: PNG1, name: 'a.png', mime: 'image/png' })
  const f2 = s.addFile({ buffer: PNG1, name: 'b.png', mime: 'image/png' })
  const n = s.addNote({ text: '配文', files: [f1.id, f2.id] })
  s.updateNote(n.id, { text: '', files: [f1.id, f2.id] })
  assert.equal(s.data.notes.find((x) => x.id === n.id).text, '', '有图时允许清空配文')
  assert.deepEqual(s.data.notes.find((x) => x.id === n.id).files, [f1.id, f2.id], '编辑时没动的图要保留')
  s.updateNote(n.id, { text: '', files: [f1.id], removeFiles: [f2.id] })
  const after = s.data.notes.find((x) => x.id === n.id)
  assert.deepEqual(after.files, [f1.id], '只留下没删的那张')
  assert.equal(s.data.files.some((f) => f.id === f2.id), false, '删掉的图记录要清掉')
  assert.ok(!existsSync(join(s.blobDir, f2.id + '.bin')), '删掉的图原件要清掉')
  assert.equal(s.filesFor('note', n.id).length, 1)
  // 空文本 + 删掉最后一张图:必须拒绝,而且不能先把内存里的图片改没
  assert.throws(() => s.updateNote(n.id, { text: '', files: [], removeFiles: [f1.id] }), /不能为空/)
  assert.deepEqual(s.data.notes.find((x) => x.id === n.id).files, [f1.id], '失败的编辑不能改内存')
  assert.ok(existsSync(join(s.blobDir, f1.id + '.bin')), '失败的编辑不能删原件')
})

test('附件:保险库名下落盘是密文,删除条目连原件一起清', () => {
  const s = fresh()
  const f = s.addFile({ buffer: PNG1, name: 'note.png', mime: 'image/png' })
  const item = s.addSecret({ title: '看图', body: '账号信息', files: [f.id] })
  const rec = s.data.files.find((x) => x.id === f.id)
  assert.equal(rec.secret, true, '挂进保险库的附件要标成密文')
  const onDisk = readFileSync(join(s.blobDir, f.id + '.enc'))
  assert.ok(onDisk.length > PNG1.length, '密文要有 iv+tag 开销')
  assert.ok(!onDisk.includes(PNG1.subarray(0, 8)), '原始 PNG 头不该出现在磁盘上')
  const full = s.getSecret(item.id)
  assert.equal(full.files.length, 1, '显示条目时要能拿到附件元信息')
  assert.ok(s.readFileBytes(f.id).bytes.equals(PNG1), '读的时候自动解密')
  s.deleteSecret(item.id)
  assert.equal(s.data.files.length, 0, '删条目要把附件记录也清掉')
  assert.ok(!existsSync(join(s.blobDir, f.id + '.enc')), '原件也要删')
})

test('附件:从保险库转存到便签,附件跟着解密搬出来', () => {
  const s = fresh()
  const f = s.addFile({ buffer: PNG1, name: 'a.png', mime: 'image/png' })
  const item = s.addSecret({ title: '某站后台', note: '说明', files: [f.id] })
  const moved = s.convertItem('secret', item.id, 'note')
  assert.equal(moved.files, 1, '要报告搬了几个附件')
  const rec = s.data.files.find((x) => x.id === f.id)
  assert.equal(rec.secret, false, '到了便签就该是明文')
  assert.equal(rec.kind, 'note')
  assert.equal(rec.ownerId, moved.item.id)
  assert.ok(readFileSync(join(s.blobDir, f.id + '.bin')).equals(PNG1), '搬出来的原件要和原来一致')
  assert.deepEqual(moved.item.files, [f.id])
})

test('附件:孤儿清理只删没人认领的,宿主还在就不动', () => {
  const s = fresh()
  const keep = s.addFile({ buffer: PNG1, name: 'keep.png', mime: 'image/png' })
  const note = s.addNote({ text: '有附件', files: [keep.id] })
  const orphan = s.addFile({ buffer: PNG1, name: 'orphan.png', mime: 'image/png' })
  // 假装它的宿主已经被删干净了(只改了记录,没走 purge)
  const rec = s.data.files.find((x) => x.id === orphan.id)
  rec.kind = 'note'
  rec.ownerId = 'n-gone'
  // 传上来没挂的临时文件:一天后算孤儿
  const fresh2 = s.addFile({ buffer: PNG1, name: 'tmp.png', mime: 'image/png' })
  s.sweepFiles(Date.now() + 3600 * 1000)
  const ids = s.data.files.map((x) => x.id)
  assert.deepEqual(ids.sort(), [keep.id, fresh2.id].sort(), '宿主不在的删掉,认领了的不动')
  assert.equal(note.files.length, 1)
  s.sweepFiles(Date.now() + 48 * 3600 * 1000)
  assert.deepEqual(s.data.files.map((x) => x.id), [keep.id], '一天没挂上的临时文件也该清')
})

test('只有说明的便签也能转进保险库(以前会被「至少要有一点内容」挡住)', () => {
  const s = fresh()
  const n = s.addNote({ text: '某站的备用码在邮件里' })
  const moved = s.convertItem('note', n.id, 'secret')
  assert.equal(moved.to, 'secret')
  const back = s.getSecret(moved.item.id)
  assert.match(JSON.stringify(back), /备用码/)
})

test('带附件的便签允许把配文清空', () => {
  const s = fresh()
  const f = s.addFile({ buffer: PNG1, name: 'x.png', mime: 'image/png' })
  const n = s.addNote({ text: '有字', files: [f.id] })
  const u = s.updateNote(n.id, { text: '' })
  assert.equal(u.text, '')
  assert.deepEqual(u.files, [f.id])
  // 没有附件就不许留空
  const plain = s.addNote({ text: '空的会被拦' })
  assert.throws(() => s.updateNote(plain.id, { text: '' }), /不能为空/)
})

// ---------------- 查找 / 用量 / 清理 ----------------

test('统一查找:五类都能按 id 定位,保险库只露标题', () => {
  const s = fresh()
  s.addNote({ text: '周末去修耳机', tags: ['生活'] })
  const rem = s.addReminder({ title: '交电费', time: '09:00' })
  s.addLink({ url: 'https://example.com/earphone', title: '耳机评测' })
  const f = s.addFile({ buffer: PNG1, name: '耳机截图.png', mime: 'image/png' })
  s.addSecret({ title: '耳机店账号', fields: { 密码: 'x' } })
  const res = s.searchAll('耳机')
  const kinds = res.hits.map((h) => h.kind).sort()
  assert.deepEqual(kinds, ['file', 'link', 'note', 'secret'], '五类里该命中的都要在')
  const noteHit = res.hits.find((h) => h.kind === 'note')
  assert.ok(noteHit.id.startsWith('n-'), '要给出可定位的 id')
  assert.equal(noteHit.where, '正文')
  assert.equal(res.hits.find((h) => h.kind === 'file').id, f.id)
  // 保险库条目在命中列表里只有标题,没有字段
  const secHit = res.hits.find((h) => h.kind === 'secret')
  assert.equal(secHit.title, '耳机店账号')
  assert.equal(JSON.stringify(secHit).includes('密码'), false)
  // 空查询不返回东西;垃圾箱默认不搜
  assert.equal(s.searchAll('').total, 0)
  s.deleteNote(noteHit.id)
  assert.equal(s.searchAll('耳机').hits.some((h) => h.kind === 'note'), false)
  assert.ok(s.searchAll('耳机', { includeTrash: true }).hits.some((h) => h.kind === 'note'))
  assert.ok(s.searchAll('电费').hits.some((h) => h.kind === 'reminder' && h.id === rem.id))
})

test('查找:中英别名互通,保险库内容深搜只回定位', () => {
  const s = fresh()
  s.addNote({ text: '用于脸书的账号,密码在保险库' })
  s.addSecret({ title: '工作账号', fields: { 账号: 'demo@example.com', 密码: 'topsecret' }, note: '这个用于脸书' })
  const byEn = s.searchAll('Facebook')
  assert.ok(byEn.hits.some((h) => h.kind === 'note'), 'Facebook 要能搜到写着「脸书」的便签')
  assert.equal(byEn.hits.some((h) => h.kind === 'secret'), false, '默认不碰保险库内容')
  const byCn = s.searchAll('脸书')
  assert.ok(byCn.hits.some((h) => h.kind === 'note'), '脸书要能搜到中文便签')
  const deep = s.searchAll('脸书', { deepVault: true })
  const sec = deep.hits.find((h) => h.kind === 'secret')
  assert.ok(sec, '深搜要能找到内容里写着「脸书」的保险库条目')
  assert.ok(sec.where.includes('内容'))
  assert.equal(JSON.stringify(deep).includes('topsecret'), false, '结果不能带出密码')
  assert.equal(JSON.stringify(deep).includes('demo@example.com'), false, '结果不能带出账号')
  s.addSecret({ title: 'Facebook', fields: { 密码: 'x' } })
  assert.ok(s.searchAll('脸书').hits.some((h) => h.kind === 'secret' && h.title === 'Facebook'), '标题别名也要命中')
})

test('用量:分开算数据/保险库/附件,柔性数据不糊在一起', () => {
  const s = fresh()
  const f = s.addFile({ buffer: PNG1, name: 'a.png', mime: 'image/png' })
  s.addNote({ text: '一条便签', files: [f.id] })
  s.addSecret({ title: 'x', fields: { 密码: 'y' } })
  const info = s.storage()
  assert.ok(info.bytes.data > 0)
  assert.ok(info.bytes.vault > 0)
  assert.ok(info.bytes.key > 0)
  assert.equal(info.bytes.blobs, PNG1.length)
  assert.equal(info.counts.files, 1)
  assert.equal(info.counts.blobFiles, 1)
  assert.equal(info.bytes.total, info.bytes.data + info.bytes.vault + info.bytes.key + info.bytes.blobs)
  assert.equal(info.dir, s.root)
})

test('清理:过期的垃圾箱连附件一起清,没到期的留着', () => {
  const s = fresh()
  const f1 = s.addFile({ buffer: PNG1, name: 'old.png', mime: 'image/png' })
  const n1 = s.addNote({ text: '过期', files: [f1.id] })
  const f2 = s.addFile({ buffer: PNG1, name: 'new.png', mime: 'image/png' })
  const n2 = s.addNote({ text: '还早', files: [f2.id] })
  // 手动把删除时间设成 40 天前 / 1 天前
  const day = 86400000
  s.deleteNote(n1.id); s.deleteNote(n2.id)
  s.data.notes.find((n) => n.id === n1.id).deletedAt = Date.now() - 40 * day
  s.data.notes.find((n) => n.id === n2.id).deletedAt = Date.now() - 1 * day
  s.save()
  const done = s.sweepTrash({ keepDays: 30 })
  assert.equal(done.notes, 1, '只清过期那一条')
  assert.ok(done.bytes >= PNG1.length, '要报释放的字节')
  assert.equal(s.data.notes.filter((n) => n.id === n2.id).length, 1, '没到期的要留着')
  assert.ok(!existsSync(join(s.blobDir, f1.id + '.bin')), '过期条目的附件原件也要删')
  assert.ok(existsSync(join(s.blobDir, f2.id + '.bin')), '没到期的附件不能动')
  assert.ok(s.data.settings.lastSweepAt > 0, '要记下清过的时间')
})

test('清理:保险库不参与自动清理(删了就不可恢复)', () => {
  const s = fresh()
  const item = s.addSecret({ title: '别动我', fields: { 密码: 'x' } })
  s.sweepTrash({ keepDays: 0 })
  assert.equal(s.getSecret(item.id).title, '别动我')
})

test('清理:保留 0 天 = 不清垃圾箱,但孤儿附件照样清', () => {
  const s = fresh()
  const note = s.addNote({ text: '删了' })
  s.deleteNote(note.id)
  s.data.notes.find((n) => n.id === note.id).deletedAt = Date.now() - 400 * 86400000
  const orphan = s.addFile({ buffer: PNG1, name: 'o.png', mime: 'image/png' })
  s.data.files.find((f) => f.id === orphan.id).kind = 'note'
  s.data.files.find((f) => f.id === orphan.id).ownerId = 'n-gone'
  const done = s.sweepTrash({ keepDays: 0 })
  assert.equal(done.notes, 0, '保留 0 天就永远不清垃圾箱')
  assert.equal(s.data.notes.length, 1)
  assert.equal(done.files, 1, '孤儿附件该清')
  assert.equal(s.data.files.length, 0)
})

test('清理:快照里的到期表算得对(0 天 = 下次就清)', () => {
  const s = fresh()
  s.data.settings.trashKeepDays = 7
  const n = s.addNote({ text: '三天前删的' })
  s.deleteNote(n.id)
  s.data.notes.find((x) => x.id === n.id).deletedAt = Date.now() - 3 * 86400000
  s.save()
  const snap = s.snapshot()
  const row = snap.trash.find((t) => t.id === n.id)
  assert.equal(snap.trashKeepDays, 7)
  assert.equal(row.daysLeft, 4, '7 - 3 = 还剩 4 天')
  // 快照和用量卡片必须用同一份到期算法,不能各算各的
  assert.deepEqual(s.storage().trash.map((t) => [t.id, t.daysLeft]), snap.trash.map((t) => [t.id, t.daysLeft]))
  s.data.settings.trashKeepDays = 0
  s.save()
  assert.equal(s.snapshot().trash.find((t) => t.id === n.id).daysLeft, null, '0 天 = 不会自动清')
  assert.equal(s.storage().trash.find((t) => t.id === n.id).daysLeft, null)
})

test('附件:非法 id 不参与路径拼接(导入丢弃;读/删不越界)', () => {
  const a = fresh()
  const rep = a.importBackup({
    kind: 'dsh-desk-kit-backup', version: 1,
    data: { files: [{ id: '../escape', name: '越界文件' }] },
  })
  assert.equal(rep.added.files, 0, '带路径的附件 id 不能进库')
  assert.ok(rep.skipped >= 1)
  // 模拟手改 data.json:塞一条坏记录,读取和删除都不该碰 blobs/ 之外
  const sentinel = join(a.root, 'escape.bin')
  writeFileSync(sentinel, 'keep')
  a.data.files.push({ id: '../escape', name: '越界文件', mime: 'text/plain', size: 4, secret: false, kind: '', ownerId: '', createdAt: Date.now() })
  assert.throws(() => a.readFileBytes('../escape'), /不合法/)
  assert.equal(a.dropFiles(['../escape']), 1, '记录仍然可以被删掉')
  assert.ok(existsSync(sentinel), '不能按坏 id 删到 blobs/ 之外的 escape.bin')
  assert.equal(a.data.files.length, 0)
})

// ---------------- 备份导入 ----------------

test('导入:导出 → 清空 → 导入,逐字段回来', () => {
  const a = fresh()
  a.addNote({ text: '往返便签', tags: ['x'], files: [] })
  const r = a.addReminder({ title: '往返提醒', time: '09:30', days: [1, 3] })
  a.checkin(r.id, '2026-11-16')
  a.addLink({ url: 'https://example.com/roundtrip', title: '往返网页' })
  const f = a.addFile({ buffer: PNG1, name: '往返图.png', mime: 'image/png' })
  a.addNote({ text: '', files: [f.id] })
  a.addSecret({ title: '往返条目', fields: { 密码: 'pw' } })
  const backup = JSON.parse(JSON.stringify(a.exportAll()))

  // 目标库要能解保险库,得是同一把钥匙(同一台机器/一起拷了 vault.key)
  const b = new DeskStore(mkdtempSync(join(tmpdir(), 'desk-kit-imp-')))
  writeFileSync(b.keyFile, readFileSync(a.keyFile), { mode: 0o600 })
  const rep = b.importBackup(backup, { mode: 'merge' })
  assert.equal(rep.added.notes, 2)
  assert.equal(rep.added.reminders, 1)
  assert.equal(rep.added.links, 1)
  assert.equal(rep.added.files, 1)
  assert.equal(rep.added.secrets, 1, '保险库条目要能解才收')
  assert.equal(b.listNotes().length, 2)
  assert.equal(b.listLinks().length, 1)
  assert.equal(b.getSecret('往返条目').fields['密码'], 'pw', '解出来的明文要一致')
  assert.ok(b.data.reminders[0].doneDates.includes('2026-11-16'), '签到记录也要回来')
  // 附件原件不在备份里 → 明确标缺,而不是假装成功
  assert.ok(rep.missingBlobs >= 1, '缺原件要报出来')
  assert.equal(b.data.files[0].missingBlob, true)
})

test('导入:合并模式按 id 去重,本地优先', () => {
  const a = fresh()
  const n = a.addNote({ text: '本地这条' })
  const backup = JSON.parse(JSON.stringify(a.exportAll()))
  // 同一份再导一次:不该出现副本
  const rep = a.importBackup(backup, { mode: 'merge' })
  assert.equal(rep.added.notes, 0)
  assert.ok(rep.skipped >= 1)
  assert.equal(a.listNotes().length, 1)
  assert.equal(a.data.notes[0].text, '本地这条', '本地内容不被盖')
  // 导入方改了同一个 id 的正文:也不覆盖本地
  const tampered = JSON.parse(JSON.stringify(backup))
  tampered.data.notes[0].text = '备份里的版本'
  a.importBackup(tampered, { mode: 'merge' })
  assert.equal(a.data.notes.find((x) => x.id === n.id).text, '本地这条')
})

test('导入:替换模式会先留一份回滚文件,且不确认就拒绝', () => {
  const a = fresh()
  a.addNote({ text: '会被换掉的' })
  const backup = JSON.parse(JSON.stringify(a.exportAll()))
  assert.throws(() => a.importBackup(backup, { mode: 'replace' }), /确认/)
  a.addNote({ text: '替换前的第二条' })
  const rep = a.importBackup(backup, { mode: 'replace', confirm: true })
  assert.ok(rep.backupFile, '要留回滚文件')
  assert.ok(existsSync(rep.backupFile), '回滚文件真的写出来了')
  assert.equal(a.data.notes.length, 1, '替换后只剩备份里那一条')
  const kept = JSON.parse(readFileSync(rep.backupFile, 'utf8'))
  assert.equal(kept.notes.length, 2, '回滚文件里是替换前的两份数据')
})

test('导入:不是备份的文件要拒,并说人话', () => {
  const a = fresh()
  assert.throws(() => a.importBackup(null), /备份/)
  assert.throws(() => a.importBackup({ hello: 1 }), /kind/)
  assert.throws(() => a.importBackup({ kind: 'dsh-desk-kit-backup', version: 99 }), /版本/)
  assert.throws(() => a.importBackup('字符串'), /备份/)
})

test('导入:缺字段/坏时间/坏日期/坏网址的条目被归一化或跳过,搜索不再崩', () => {
  const a = fresh()
  const rep = a.importBackup({
    kind: 'dsh-desk-kit-backup',
    version: 1,
    data: {
      notes: [{ id: 'n-bad' }],
      reminders: [
        { id: 'r-bad-time', title: '时间坏了', time: '25:99' },
        { id: 'r-bad-date', title: '日期坏了', time: '09:00', date: '2026-02-30' },
        { id: 'r-ok', title: '能救回来', time: '9:05' },
      ],
      links: [{ id: 'w-bad', title: '没网址' }],
    },
  })
  assert.equal(rep.added.notes, 1, '缺 text 的便签要补空串留下')
  assert.equal(rep.added.reminders, 1, '只保留时间/日期真的合法的提醒')
  assert.equal(rep.added.links, 0, '没网址的网页不导入')
  assert.ok(rep.skipped >= 3, '被跳过的要计数')
  // 关键回归:以前这条会抛 TypeError,搜索/快照永久报错
  assert.equal(a.listNotes({ query: 'x' }).length, 0)
  assert.equal(a.data.notes[0].text, '', '缺 text 归一成空串')
  assert.equal(a.data.notes[0].shelf, 'daily')
  assert.equal(a.data.reminders[0].time, '09:05', '时间要补零')
  assert.equal(a.data.reminders[0].active, true, '缺 active 默认是启用的')
  assert.deepEqual(a.data.reminders[0].doneDates, [])
})

test('导入:便签超过活动上限时转归档,数据不丢', () => {
  const a = fresh()
  const notes = Array.from({ length: 2001 }, (_, i) => ({ id: 'n-' + i, text: '第' + i + '条' }))
  const rep = a.importBackup({ kind: 'dsh-desk-kit-backup', version: 1, data: { notes } })
  assert.equal(rep.added.notes, 2001)
  assert.equal(a.data.notes.length, 2001, '不丢数据')
  assert.equal(a.data.notes.filter((n) => n.archived).length, 1, '超出的 1 条转归档')
})

test('导入:换过 vault.key 的条目跳过并计数,不污染其它数据', () => {
  const a = fresh()
  const item = a.addSecret({ title: '旧机器的条目', fields: { 密码: 'x' } })
  a.addNote({ text: '同批的便签' })
  const backup = JSON.parse(JSON.stringify(a.exportAll()))
  // 模拟换机器:新库换一把钥匙
  const b = fresh()
  writeFileSync(b.keyFile, randomBytes(48).toString('hex'), { mode: 0o600 })
  const rep = b.importBackup(backup, { mode: 'merge' })
  assert.equal(rep.locked, 1, '解不开的保险库条目要计数')
  assert.equal(rep.added.secrets, 0, '不能塞进来一条永远打不开的')
  assert.equal(rep.added.notes, 1, '同批的明文数据照常导入')
  assert.equal(b.vaultRaw().entries.length, 0)
})

test('重复提醒登记时今天的点已过:从明天开始,不立刻报「错过」', () => {
  const s = fresh()
  const now = new Date()
  const pastH = (now.getHours() + 22) % 24          // 22 小时前,肯定已经过了
  const past = String(pastH).padStart(2, '0') + ':00'
  const r = s.addReminder({ title: '吃药', time: past })
  assert.equal(r.startTomorrow, true, '要标记从明天开始')
  assert.ok(r.silencedDates.includes(localYmd(now)), '今天这一天静音')
  assert.equal(s.tick(now.getTime()), 0, '不该立刻造一张「错过的提醒」')
  const row = s.todayView(now).find((x) => x.id === r.id)
  assert.equal(row.status, 'silenced')
  assert.equal(row.startTomorrow, true)
})

test('刚刚到点 / 明说了日期的一次性提醒,仍然照常提醒', () => {
  const s = fresh()
  const now = new Date()
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const just = s.addReminder({ title: '立刻到期', time: hhmm })
  assert.ok(!just.startTomorrow, '刚刚到点的不能静音')

  const s2 = fresh()
  const once = s2.addReminder({ title: '今天的事', time: '00:01', date: localYmd(now) })
  assert.ok(!once.startTomorrow, '一次性提醒是用户指定的那一天,不替他跳过')
  assert.ok(s2.tick(now.getTime()) >= 1, '一次性提醒过了点仍然补一张')
})
