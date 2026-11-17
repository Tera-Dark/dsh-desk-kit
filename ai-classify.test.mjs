/**
 * AI 分类链路测试:mock 掉 ctx.get('llm'),验证
 *   1) 配了分类模型 → 走模型给的 JSON
 *   2) 模型报错/乱回 → 回退本地规则
 *   3) 没配模型 → 只走本地规则(llm 不被调用)
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dk-ai-'))
const { apply } = await import('./index.js')

const routes = []
const srv = createServer((req, res) => {
  for (const r of routes) if (String(req.url || '').startsWith(r.path)) return r.handler(req, res)
  res.writeHead(404); res.end('nf')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const base = 'http://127.0.0.1:' + port + '/desk-kit-api'

let llmCalls = 0
let llmReply = ''
let llmThrows = false
const llm = {
  async *stream(opts) {
    llmCalls++
    if (llmThrows) throw new Error('模型挂了')
    // 模拟流式文本分片
    yield { type: 'text-delta', text: llmReply.slice(0, 10) }
    yield { type: 'text-delta', text: llmReply.slice(10) }
  },
}

const tools = new Map()
apply({
  inject: (_d, cb) => cb(),
  effect: (fn) => fn(),
  get: (n) => {
    if (n === 'webServer') return { register: (r) => { routes.push(r); return () => {} } }
    if (n === 'llm') return llm
    return undefined
  },
  tools: { register: (d) => tools.set(d.name, d) },
  logger: { error: (m) => console.error('[ERR]', m), warn: () => {}, info: () => {} },
})

const post = async (a, p) => (await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a, payload: p }) })).json())
const get = async () => (await (await fetch(base)).json())

// --- 1) 未配模型:llm 不该被调用 ---
const before = llmCalls
const r1 = await post('capture', { text: '明天10点提醒我交电费' })
assert.equal(llmCalls, before, '没配模型时不该调 llm')
assert.equal(r1.result.parsed.kind, 'reminder')
console.log('✓ 未配模型:走本地规则,未调 llm →', r1.result.reply)

// --- 2) 配了模型:本地判成便签、但话里像有待办/时间时,才去问模型 ---
await post('settings.update', { classifyProvider: 'p1', classifyModel: 'm1' })
llmReply = '{"kind":"note","text":"这是模型判断的结果"}'
const before2 = llmCalls
const r2a = await post('capture', { text: '随便说点什么' })
assert.equal(llmCalls, before2, '一眼就是便签的话不必问模型')
assert.equal(r2a.result.parsed.kind, 'note')
const r2 = await post('capture', { text: '这周五前得把稿子交了' })
assert.ok(llmCalls > before, '配了模型后应调用 llm')
assert.equal(r2.result.parsed.kind, 'note')
assert.equal(r2.result.item.text, '这是模型判断的结果')
assert.equal(r2.result.viaAI, true)
console.log('✓ 配了模型:走 AI →', r2.result.item.text.slice(0, 20), '| viaAI =', r2.result.viaAI)

// --- 3) AI 判成提醒:字段要能落成提醒 ---
llmReply = '{"kind":"reminder","title":"吃药","time":"8:00","leadMin":15}'
const r3 = await post('capture', { text: '早饭后一小时吃降压药' })
assert.equal(r3.result.parsed.kind, 'reminder')
assert.equal(r3.result.item.time, '08:00', '9:00 要补零成 08:00')
assert.equal(r3.result.item.leadMin, 15)
console.log('✓ AI 提醒:time =', r3.result.item.time, '| leadMin =', r3.result.item.leadMin)

// --- 4) AI 生日:annual 走每年 ---
llmReply = '{"kind":"reminder","title":"小美生日","time":"09:00","annual":"05-03","leadMin":4320}'
// 只说了月份、没说日子,本地排不出来 —— 正好交给模型补
const r4 = await post('capture', { text: '记一下,小美生日在五月' })
assert.equal(r4.result.item.annual, '05-03')
console.log('✓ AI 生日:', r4.result.item.annual)

// --- 5) 模型抛错:回退本地规则 ---
llmThrows = true
const r5 = await post('capture', { text: '明天10点提醒我交电费' })
assert.equal(r5.result.parsed.kind, 'reminder')
assert.equal(r5.result.viaAI, undefined, '回退时不该标 viaAI')
console.log('✓ 模型报错:回退本地 →', r5.result.reply)

// --- 6) 模型乱回(不是 JSON):回退 ---
llmThrows = false
llmReply = '我不太确定你说什么'
const r6 = await post('capture', { text: '记一下买牛奶' })
assert.equal(r6.result.viaAI, undefined)
assert.equal(r6.result.parsed.kind, 'note')
console.log('✓ 模型乱回:回退本地 →', r6.result.reply)

// --- 7) 模型给非法 kind:回退 ---
llmReply = '{"kind":"unknown","text":"x"}'
const r7 = await post('capture', { text: '记一下买菜' })
assert.equal(r7.result.viaAI, undefined)
console.log('✓ 非法 kind:回退本地')

// --- 8) settings 持久化 ---
const st = await get()
assert.equal(st.state.settings.classifyProvider, 'p1')
assert.equal(st.state.settings.classifyModel, 'm1')
console.log('✓ 设置已持久化: classify =', st.state.settings.classifyProvider + '/' + st.state.settings.classifyModel)

srv.close()
console.log('\nAI CLASSIFY ALL PASSED')
