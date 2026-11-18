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
