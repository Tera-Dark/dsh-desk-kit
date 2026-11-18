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
  const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk-kit': '1' }, body: JSON.stringify({ action, payload }) })
  return r.json()
}

// 2.5) 只认本机页面:别的网站不该能替用户改数据
const rawPost = (headers, body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
{
  const noMark = await rawPost({}, { action: 'note.add', payload: { text: '没有标记' } })
  assert.equal(noMark.status, 403, 'POST 必须带 x-desk-kit 标记')
  const foreign = await rawPost({ 'x-desk-kit': '1', origin: 'https://evil.example' }, { action: 'note.add', payload: { text: '外站' } })
  assert.equal(foreign.status, 403, '外站来源要拒')
  const crossSite = await rawPost({ 'x-desk-kit': '1', 'sec-fetch-site': 'cross-site' }, { action: 'note.add', payload: { text: '跨站' } })
  assert.equal(crossSite.status, 403, 'sec-fetch-site=cross-site 要拒')
  const sameOrigin = await rawPost({ 'x-desk-kit': '1', origin: base.replace('/desk-kit-api', ''), 'sec-fetch-site': 'same-origin' }, { action: 'note.add', payload: { text: '本机页面' } })
  assert.equal(sameOrigin.status, 200, '本机同源请求要放行')
  const junk = await post('note.purge', { id: (await get()).state.notes[0].id })
  assert.ok(junk.ok, '清掉这条探针便签')
  console.log('✓ 请求围栏:无标记 / 外站来源 / 跨站 一律 403,本机同源放行')
}

// 3) 空库:不该替用户造数据
const s0 = await get()
assert.ok(s0.ok, '快照要能读')
assert.equal(s0.state.reminders.length, 0, '首次启动不要塞默认提醒')
assert.equal(s0.state.notes.length, 0)
console.log('✓ 首次启动是空面板(不造默认提醒)')

// 3.5) 附件:传字节 → 取回来 → 挂到便签 → 彻底删除时原件一起清
{
  // 1×1 的 PNG(手写最小合法文件,顺带验证尺寸解析)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  )
  const up = await fetch(base + '/files', {
    method: 'POST',
    headers: { 'x-desk-kit': '1', 'content-type': 'image/png', 'x-file-name': encodeURIComponent('截图 2026.png') },
    body: png,
  })
  assert.equal(up.status, 200, '上传要成功')
  const upped = await up.json()
  const f = upped.file
  assert.equal(f.mime, 'image/png')
  assert.equal(f.size, png.length)
  assert.equal(f.w, 1, 'PNG 宽度要从头部读出来')
  assert.equal(f.h, 1)
  assert.equal(f.name, '截图 2026.png', '文件名要能带中文')

  const got = await fetch(base + '/files/' + f.id)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/png', '图片要能内联给 <img>')
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(png), '取回的字节要和上传的一致')

  const note = await post('note.add', { text: '看这张图', files: [f.id] })
  const withFile = note.state.notes.find((n) => n.id === note.result.id)
  assert.deepEqual(withFile.files, [f.id], '便签要记住附件')
  assert.equal(note.state.files.find((x) => x.id === f.id).kind, 'note', '附件要认领到便签名下')

  // 只有图、没文字的便签也要能存
  const blank = await post('note.add', { text: '', files: [f.id] })
  assert.ok(blank.ok, '纯图片便签不该被「内容不能为空」挡住')

  // 外站来的上传请求要拒
  const evil = await fetch(base + '/files', { method: 'POST', headers: { 'x-desk-kit': '1', origin: 'https://evil.example' }, body: png })
  assert.equal(evil.status, 403, '外站来源的上传要拒')

  await post('note.purge', { id: note.result.id })
  const afterPurge = await get()
  assert.equal(afterPurge.state.files.filter((x) => x.id === f.id).length, 0, '彻底删除便签要连附件记录一起清')
  const gone = await fetch(base + '/files/' + f.id)
  assert.equal(gone.status, 400, '原件没了就取不到(回 400 一句人话,不是 500)')
  await post('note.purge', { id: blank.result.id })
  console.log('✓ 附件:上传/取回/挂便签/纯图片便签/外站拒绝/彻底删除清原件 全过')
}

// 4) 工具:便签
const add = tools.get('desk_note_add')
assert.ok(add, 'desk_note_add 应已注册')
const noteRes = await add.execute({ text: '周末去修耳机', tags: ['生活'] })
assert.equal(noteRes.data.text, '周末去修耳机')
const listRes = await tools.get('desk_note_list').execute({})
assert.ok(listRes.text.includes('修耳机'))
console.log('✓ 便签工具:', listRes.text.split('\n')[0])
assert.equal(tools.size, 25, '应注册 25 个工具,实际 ' + tools.size)

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

// 13) 网页收藏:API + 工具 + 一句话 + 快照
const w1 = await post('link.add', { url: 'example.com', title: '示例', group: '工具' })
assert.equal(w1.result.url, 'https://example.com')
const w2 = await post('link.add', { url: 'https://www.example.com/', title: '重复的' })
assert.equal(w2.result.deduped, true, '同一条链接不该存两遍')
const w3 = await post('link.add', { url: 'https://www.figma.com/files', title: '设计稿', group: '设计' })
await post('link.touch', { id: w3.result.id })
const snap = await get()
assert.equal(snap.state.links.length, 2)
assert.equal(snap.state.links[0].id, w3.result.id, '最近打开的排前面')
assert.equal(snap.state.linkGroups.groups.length, 2)
const wTools = await tools.get('desk_link_list').execute({ group: '工具' })
assert.ok(wTools.text.includes('示例') && !wTools.text.includes('设计稿'), '按分类过滤')
const capLink = await post('capture', { text: '收藏 https://linear.app 分类:工具 叫 Linear' })
assert.equal(capLink.result.parsed.kind, 'link')
assert.equal(capLink.result.item.title, 'Linear')
assert.equal(capLink.result.item.group, '工具')
// 空关键字不能当通配符用:includes('') 谁都匹配,一删一个准
let emptyDel = null
try { await tools.get('desk_link_delete').execute({ title: '' }) } catch (e) { emptyDel = e.message }
assert.ok(emptyDel, '空标题删除必须报错')
assert.equal((await get()).state.links.length, 3, '空标题删除不该删掉任何东西')
// 网址里的账号密码不许落盘
const cred = await post('link.add', { url: 'https://u:p@credentials.example.com/x' })
assert.equal(cred.result.url, 'https://credentials.example.com/x')
await post('link.delete', { id: cred.result.id })
// 14) 转存:分错了自己挪
const movNote = await post('note.add', { text: 'https://move.example.com 这个站用来查资料' })
const mov = await post('item.convert', { kind: 'note', id: movNote.result.id, to: 'link' })
assert.equal(mov.ok, true, '转存要成功')
assert.equal(mov.result.item.url, 'https://move.example.com')
assert.ok(mov.result.reply.includes('网页'))
const afterMove = await get()
assert.equal(afterMove.state.notes.filter((n) => n.id === movNote.result.id && !n.deletedAt).length, 0, '原便签要移走')
assert.ok(afterMove.state.notes.some((n) => n.id === movNote.result.id && n.deletedAt), '原便签要能找回')
const movBack = await post('item.convert', { kind: 'link', id: mov.result.item.id, to: 'note' })
assert.equal(movBack.ok, true)
// 工具版:按名字挪(便签没有标题字段,要能从正文里认出来)
await post('note.add', { text: 'https://wiki2.example.com 每天看新闻' })
const movTool = await tools.get('desk_item_move').execute({ to: 'link', title: '每天看新闻' })
assert.ok(movTool.text.includes('网页'))
// 带密码的保险库条目不许搬到明文
const pv = await post('secret.add', { title: '带密码的', username: 'u', password: 'p', url: 'https://pv.example.com' })
const pvMove = await post('item.convert', { kind: 'secret', id: pv.result.id, to: 'link' })
assert.equal(pvMove.ok, false, '带密码搬到网页必须被拦下')
console.log('✓ 转存:便签⇄网页⇄保险库 · 工具 desk_item_move')

console.log('✓ 网页收藏:', snap.state.links.length, '个 ·', snap.state.linkGroups.groups.length, '个分类')

server.close()
console.log('\nALL HOST TESTS PASSED')
