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
  assert.ok(b.title.includes('打卡'))
  const c = parseCapture('周一到周五 8点半 打卡', now)
  assert.equal(c.kind, 'reminder')
  assert.equal(c.time, '08:30')
  assert.deepEqual(c.weekdays, [1, 2, 3, 4, 5])
})

test('分类:便签', () => {
  const a = parseCapture('记一下 周末去修耳机', now)
  assert.equal(a.kind, 'note')
  assert.equal(a.text, '周末去修耳机', '正文去掉「记一下」这类前缀')
  assert.equal(a.raw, '记一下 周末去修耳机', '原话留在 raw 里')
  assert.equal(parseCapture('今天好累', now).kind, 'note')
  assert.equal(parseCapture('提醒我下周弄这个', now).missingTime, true)
})

test('分类:保险库', () => {
  const a = parseCapture('把某示例站点账号 demo_user 密码 abc123 存起来', now)
  assert.equal(a.kind, 'secret')
  assert.equal(a.username, 'demo_user')
  assert.equal(a.password, 'abc123')
  assert.ok(a.title.includes('某示例站点'))
  const b = parseCapture('密码 = p@ss word 记一下', now)
  assert.equal(b.kind, 'secret')
  assert.equal(b.password, 'p@ss')
})

test('回执文案', () => {
  assert.ok(describeCapture(parseCapture('明天10点提醒我交电费', now)).includes('提醒'))
  assert.ok(describeCapture(parseCapture('随便记一句', now)).includes('便签'))
  assert.ok(describeCapture(parseCapture('账号 a 密码 b', now)).includes('保险库'))
})

test('多站点批量打卡:拆成多条提醒而不是塞便签', () => {
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
  assert.ok(r.sites[0].title.includes('打卡'), '标题要带打卡')
  // 单个网址 + 签到 不该走 multi(那不是批量)
  const one = parseCapture('每天9点提醒我去 https://a.com/ 签到')
  assert.notEqual(one.kind, 'multi')
  // 多个网址但没提签到 → 仍是便签
  const two = parseCapture('https://a.com https://b.com 这两个先记着')
  assert.equal(two.kind, 'note')
})

test('分类:网页收藏(带网址 + 收藏/网页这类词)', () => {
  const a = parseCapture('收藏这个网页 https://example.com/docs', now)
  assert.equal(a.kind, 'link')
  assert.equal(a.url, 'https://example.com/docs')
  assert.equal(a.title, 'Example', '没起名就用域名')
  const b = parseCapture('把 https://www.figma.com/files 存成网页,分类:设计', now)
  assert.equal(b.kind, 'link')
  assert.equal(b.group, '设计', '分类要认出来')
  assert.equal(b.title, 'Figma', '分类名不能混进标题')
  const c = parseCapture('收藏 https://github.com/trending 叫 今日热榜', now)
  assert.equal(c.title, '今日热榜')
  // 光贴一个网址 / 带密码的句子,都不该进网页
  assert.equal(parseCapture('https://example.com 这个先记着', now).kind, 'note')
  // 「密码是 abc」以前因为「是」没被当成分隔符,凭据会掉成便签 —— 现在要认出来
  const d = parseCapture('记一下 example.com 的登录密码是 abc', now)
  assert.equal(d.kind, 'secret')
  assert.equal(d.password, 'abc')
})

test('分类:说「这站不错,能干什么」是网页,不是保险库', () => {
  const a = parseCapture('https://example.com 这个网站不错，可以用来查资料、看论文', now)
  assert.equal(a.kind, 'link', '带网址的介绍不该进保险库')
  assert.equal(a.url, 'https://example.com')
  assert.equal(a.title, 'Example', '名字用域名,别把整句当标题')
  assert.match(a.note, /查资料/, '用途说明要进备注')

  // 「登录」以前会让整句掉进保险库,哪怕一个凭据都没有
  const b = parseCapture('example.com 登录之后可以看订单', now)
  assert.equal(b.kind, 'link')
  assert.equal(b.url, 'https://example.com', '裸域名要补协议')

  const c = parseCapture('这个站挺好用的 https://tool.example.com 适合做设计', now)
  assert.equal(c.kind, 'link')
  assert.match(c.note, /适合做设计/)
})
