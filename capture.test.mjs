import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCapture, parseClock, parseWhen, cleanTitle, describeCapture } from './capture.js'

const now = new Date(2026, 10, 14, 13, 0, 0) // 2026-11-14 周六 13:00

test('时间解析', () => {
  assert.deepEqual(parseClock('10点'), { h: 10, m: 0 })
  assert.deepEqual(parseClock('晚上9点'), { h: 21, m: 0 })
  assert.deepEqual(parseClock('下午3点半'), { h: 15, m: 30 })
  assert.deepEqual(parseClock('8:05'), { h: 8, m: 5 })
  assert.deepEqual(parseClock('中午12点'), { h: 12, m: 0 })
  assert.deepEqual(parseClock('十点'), { h: 10, m: 0 })
  assert.equal(parseClock('随便聊聊'), null)
})

test('日期与重复', () => {
  assert.equal(parseWhen('明天10点', now).date, '2026-11-15')
  assert.equal(parseWhen('后天', now).date, '2026-11-16')
  assert.equal(parseWhen('今天', now).date, '2026-11-14')
  assert.deepEqual(parseWhen('周一到周五', now).weekdays, [1, 2, 3, 4, 5])
  assert.deepEqual(parseWhen('周三', now).weekdays, [3])
  assert.deepEqual(parseWhen('每天', now).weekdays, [])
  assert.equal(parseWhen('每天', now).repeat, true)
})

test('标题清洗', () => {
  assert.equal(cleanTitle('提醒我交电费'), '交电费')
  assert.equal(cleanTitle('记得吃药'), '吃药')
  assert.equal(cleanTitle('帮我记一下 周末去修耳机'), '周末去修耳机')
})

test('分类:提醒', () => {
  const a = parseCapture('明天10点提醒我交电费', now)
  assert.equal(a.kind, 'reminder')
  assert.equal(a.time, '10:00')
  assert.equal(a.date, '2026-11-15')
  assert.equal(a.title, '交电费')
  const b = parseCapture('每天晚上9点提醒我每日打卡', now)
  assert.equal(b.kind, 'reminder')
  assert.equal(b.time, '21:00')
  assert.deepEqual(b.weekdays, [])
  assert.ok(b.title.includes('每日打卡'))
  const c = parseCapture('周一到周五 8点半 打卡', now)
  assert.equal(c.kind, 'reminder')
  assert.equal(c.time, '08:30')
  assert.deepEqual(c.weekdays, [1, 2, 3, 4, 5])
})

test('分类:便签', () => {
  const a = parseCapture('记一下 周末去修耳机', now)
  assert.equal(a.kind, 'note')
  assert.equal(a.text, '记一下 周末去修耳机')
  assert.equal(parseCapture('今天好累', now).kind, 'note')
  assert.equal(parseCapture('提醒我下周弄这个', now).missingTime, true)
})

test('分类:保险库', () => {
  const a = parseCapture('把示例站点账号 demo_user 密码 abc123 存起来', now)
  assert.equal(a.kind, 'secret')
  assert.equal(a.username, 'demo_user')
  assert.equal(a.password, 'abc123')
  assert.ok(a.title.includes('示例站点'))
  const b = parseCapture('密码 = p@ss word 记一下', now)
  assert.equal(b.kind, 'secret')
  assert.equal(b.password, 'p@ss')
})

test('回执文案', () => {
  assert.ok(describeCapture(parseCapture('明天10点提醒我交电费', now)).includes('提醒'))
  assert.ok(describeCapture(parseCapture('随便记一句', now)).includes('便签'))
  assert.ok(describeCapture(parseCapture('账号 a 密码 b', now)).includes('保险库'))
})

test('多站点批量签到:拆成多条提醒而不是塞便签', () => {
  const txt = [
    'https://www.example.com/',
    'https://api.example.org/dashboard',
    'https://checkin.example.net/console',
    'https://up.example.io/',
    'https://new.example.dev/profile',
    '这些站每天都要签到',
  ].join('\n')
  const r = parseCapture(txt)
  assert.equal(r.kind, 'multi', '应识别成多站点')
  assert.equal(r.sites.length, 5, '5 个站点')
  assert.equal(r.sites[0].url, 'https://www.example.com/')
  assert.ok(r.sites[0].title.includes('签到'), '标题要带签到')
  // 单个网址 + 签到 不该走 multi(那不是批量)
  const one = parseCapture('每天9点提醒我去 https://a.com/ 签到')
  assert.notEqual(one.kind, 'multi')
  // 多个网址但没提签到 → 仍是便签
  const two = parseCapture('https://a.com https://b.com 这两个先记着')
  assert.equal(two.kind, 'note')
})
