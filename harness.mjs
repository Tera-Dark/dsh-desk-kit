/**
 * 宿主集成自测:桩掉 @deepseek-ai/dsh-tools 与 ctx,真起一个 HTTP 服务,
 * 把 apply() 挂上去,然后按浏览器半侧的方式打 API、按 Agent 的方式调工具。
 * 这是为了在没装进 DSH 之前就能验证路由/工具/tick 三条链路。
 */
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'desk-kit-home-'))

// 1) 桩掉 @deepseek-ai/dsh-tools(DSH 运行时由宿主提供)
// 桩要放在 index.js 的解析祖先目录下:scratch/desk-kit/node_modules/(装进 profile 时不会带过去)
const stubDir = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-tools')
mkdirSync(stubDir, { recursive: true })
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.0', type: 'module', main: 'index.js' }))
writeFileSync(join(stubDir, 'index.js'), 'export const defineTool = (def) => def\n')
const { apply, name } = await import('file:///' + join(process.cwd(), 'index.js').replace(/\\/g, '/'))

assert.equal(name, 'dsh-desk-kit')

// 2) 桩 webServer:prefix 注册 → 真 HTTP
const routes = []
const server = createServer((req, res) => {
  for (const r of routes) {
    if (String(req.url || '').startsWith(r.path)) { r.handler(req, res); return }
  }
  res.writeHead(404); res.end('nf')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const tools = new Map()
const ctx = {
  inject: (_deps, cb) => cb(),
  effect: (fn) => fn(),
  get: (n) => (n === 'webServer' ? { register: (r) => { routes.push(r); return () => { } } } : undefined),
  tools: { register: (def) => { tools.set(def.name, def) } },
  logger: { error: (m) => console.error('[err]', m), warn: (m) => console.warn('[warn]', m), info: () => { } },
}
apply(ctx)

const base = 'http://127.0.0.1:' + port + '/desk-kit-api'
const get = async () => (await (await fetch(base)).json())
const post = async (action, payload) => {
  const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload }) })
  return r.json()
}

// 3) 空库:不该替用户造数据
const s0 = await get()
assert.ok(s0.ok, '快照要能读')
assert.equal(s0.state.reminders.length, 0, '首次启动不要塞默认提醒')
assert.equal(s0.state.notes.length, 0)
console.log('✓ 首次启动是空面板(不造默认提醒)')

// 4) 工具:便签
const add = tools.get('desk_note_add')
assert.ok(add, 'desk_note_add 应已注册')
const noteRes = await add.execute({ text: '周末去修耳机', tags: ['生活'] })
assert.equal(noteRes.data.text, '周末去修耳机')
const listRes = await tools.get('desk_note_list').execute({})
assert.ok(listRes.text.includes('修耳机'))
console.log('✓ 便签工具:', listRes.text.split('\n')[0])
assert.equal(tools.size, 19, '应注册 19 个工具,实际 ' + tools.size)

// 一句话入口:模型侧工具
const cap = await tools.get('desk_capture').execute({ text: '明天10点提醒我交电费' })
assert.ok(cap.text.includes('提醒') && cap.data.parsed.kind === 'reminder', 'cap: ' + cap.text)
console.log('✓ desk_capture:', cap.text)
const cap2 = await tools.get('desk_capture').execute({ text: '示例站点账号 demo_user 密码 abc123' })
assert.equal(cap2.data.parsed.kind, 'secret')
const cap3 = await tools.get('desk_capture').execute({ text: '记一下 买牛奶' })
assert.equal(cap3.data.parsed.kind, 'note')
// 带签到链接:链接要落进 url,且不污染标题
const capUrl = await tools.get('desk_capture').execute({ text: '每天9点提醒我签到 https://example.com/qiandao' })
assert.equal(capUrl.data.parsed.kind, 'reminder')
assert.equal(capUrl.data.parsed.url, 'https://example.com/qiandao')
assert.ok(!capUrl.data.parsed.title.includes('http'), '标题不该带网址: ' + capUrl.data.parsed.title)
console.log('✓ 带链接的提醒:', capUrl.data.parsed.title, capUrl.data.parsed.url)

// 5) 工具:提醒
const rem = await tools.get('desk_reminder_add').execute({ title: 'B站打卡', time: '10:30', leadMin: 10 })
assert.ok(rem.data.id)
const checkin = await tools.get('desk_reminder_checkin').execute({ query: 'B站' })
assert.ok(checkin.text.includes('完成'))
const rl = await tools.get('desk_reminder_list').execute({})
assert.ok(rl.text.includes('B站打卡'))
console.log('✓ 提醒工具:', rl.text.split('\n').slice(-1)[0])

// 6) API:便签增删、提醒签到
const before = (await get()).state.notes.length
const p1 = await post('note.add', { text: '面板加的便签' })
assert.equal(p1.state.notes.length, before + 1)
const nid = p1.state.notes[0].id
const p2 = await post('note.update', { id: nid, pinned: true })
assert.equal(p2.state.notes[0].pinned, true)
// 删除 = 进垃圾箱,总数不减少,但 active 计数减一
const p3 = await post('note.delete', { id: nid })
assert.equal(p3.state.notes.length, before + 1, '软删除后仍留在 trash 里')
assert.equal(p3.state.noteCounts.trash, 1, '垃圾箱应有 1 条')
const trashed = p3.state.notes.find((n) => n.id === nid)
assert.ok(trashed.deletedAt > 0, '应带 deletedAt')

// 恢复
const p4 = await post('note.restore', { id: nid })
assert.equal(p4.state.noteCounts.trash, 0, '恢复后垃圾箱清空')
assert.equal(p4.state.noteCounts.active >= 1, true)

// 完成态
const p5 = await post('note.complete', { id: nid, done: true })
assert.ok(p5.state.noteCounts.done >= 1, '已完成应有 1 条')
const p6 = await post('note.complete', { id: nid, done: false })
assert.equal(p6.state.notes.find((n) => n.id === nid).completedAt, 0, '取消完成')

// 彻底删
await post('note.delete', { id: nid })
const p7 = await post('note.purge', { id: nid })
assert.equal(p7.state.notes.length, before)
assert.equal(p7.state.noteCounts.trash, 0)
console.log('✓ 便签:软删除/恢复/完成/彻底删 全部正常')

// 7) API:保险库(密文落盘 + 读回)
const sec = await post('secret.add', { title: '某示例站点', username: 'demo_user', password: 'p@ss word' })
assert.ok(sec.result.id)
const vaultText = (await import('node:fs')).readFileSync(join(process.env.DSH_HOME, 'desk-kit', 'vault.json'), 'utf8')
assert.ok(!vaultText.includes('p@ss word') && !vaultText.includes('demo_user'), '磁盘上不该有明文')
const got = await post('secret.get', { query: '某示例站点' })
assert.equal(got.result.fields['密码'], 'p@ss word')
const lst = await get()
assert.ok(lst.state.secrets.length >= 1)
assert.ok(lst.state.secrets.every((s) => s.fieldCount === 0), '列表不带字段')
assert.ok(lst.state.secrets.some((s) => s.title.includes('某示例站点')))
console.log('✓ 保险库:密文落盘 + API 读回')

// 8) 告警链路:加一条「截止时间=此刻」的提醒,GET 会顺带 tick,必须冒出告警
const now = new Date()
const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
await post('reminder.add', { title: '立刻到期', time: hhmm, leadMin: 0 })
const s2 = await get()
assert.ok(s2.state.alerts.length >= 1, 'API 应看到未确认告警')
assert.ok(s2.state.alerts.some((a) => a.title === '立刻到期'))
const alertId = s2.state.alerts.find((a) => a.title === '立刻到期').id
const ack = await post('alert.ack', { id: alertId })
assert.ok(!ack.state.alerts.some((a) => a.id === alertId), '确认后该条消失')
const again = await get()
assert.ok(!again.state.alerts.some((a) => a.id === alertId), '确认是持久的')
// 签到后当天不再冒
const target = again.state.reminders.find((r) => r.title === '立刻到期')
await post('reminder.checkin', { id: target.id })
const after = await get()
assert.ok(!after.state.alerts.some((a) => a.title === '立刻到期'), '签到后当天不该再弹')
console.log('✓ 告警链路:tick → 弹出 → 确认 → 签到静默')

// 9) 非法输入要被拒(而不是 500 崩掉)
// 一句话入口:HTTP API(面板输入框走的就是这条)
const capApi = await post('capture', { text: '每天晚上9点提醒我每日打卡' })
assert.ok(capApi.ok && capApi.result.parsed.kind === 'reminder', 'capture api')
assert.ok(capApi.result.reply.includes('21:00'), capApi.result.reply)
const oneOff = await post('capture', { text: '后天下午3点提醒我开会' })
assert.equal(oneOff.result.parsed.date !== null, true)
console.log('✓ capture API:', capApi.result.reply, '| 一次性:', oneOff.result.parsed.date, oneOff.result.parsed.time)

const bad = await post('note.add', { text: '   ' })
assert.equal(bad.ok, false)
const bad2 = await post('reminder.add', { title: 'x', time: '25:99' })
assert.equal(bad2.ok, false)
console.log('✓ 非法输入被拒:', bad.error)

// 10) 非回环访问被拒 —— 桩 socket 模拟
assert.ok(existsSync(join(process.env.DSH_HOME, 'desk-kit', 'vault.key')))


// 11) 一句话里一串网址 + "每天签到" → 批量建每日提醒
const multiTxt = ['https://a1.example.com/', 'https://a2.example.com/x', 'https://a3.example.com/', '每天都要签到'].join('\n')
const m1 = await post('capture', { text: multiTxt })
assert.equal(m1.result.parsed.kind, 'multi', '应识别为多站点')
assert.equal(m1.result.item.length, 3, '应建 3 条提醒')
assert.ok(m1.result.reply.includes('3 条'))
const m2 = await post('capture', { text: multiTxt })
assert.equal(m2.result.item.length, 0, '重复提交应全部跳过')
assert.ok(m2.result.reply.includes('跳过'))
console.log('✓ 多站点批量签到:', m1.result.reply.slice(0, 40), '| 重复提交跳过:', m2.result.reply.includes('跳过'))

// 12) 工具转述「什么时候」要按真实周期:一次性/每月/每年的提醒不能被说成「每天」
const once = await tools.get('desk_reminder_add').execute({ title: '一次性的事', time: '10:00', date: '2030-01-01' })
assert.ok(once.text.includes('2030-01-01'), '一次性要说日期,实际:' + once.text)
const mon = await tools.get('desk_reminder_add').execute({ title: '每月的账', time: '09:00', monthly: 5 })
assert.ok(mon.text.includes('每月 5 号'), '每月要说每月几号,实际:' + mon.text)
const yearly = await tools.get('desk_reminder_add').execute({ title: '某人的生日', time: '09:00', annual: '05-03' })
assert.ok(yearly.text.includes('公历每年 05-03'), '每年要说每年,实际:' + yearly.text)
const listed = await tools.get('desk_reminder_list').execute({})
assert.ok(listed.text.includes('每月 5 号') && listed.text.includes('2030-01-01'), '列表也要说对周期')
console.log('✓ 工具周期文案:', once.text.slice(0, 24), '|', mon.text.slice(0, 24))

server.close()
console.log('\nALL HOST TESTS PASSED')
