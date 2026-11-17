import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dk-v6-'))
const { apply } = await import('./index.js')
const routes = []
const srv = createServer((req, res) => { for (const r of routes) if (String(req.url || '').startsWith(r.path)) return r.handler(req, res); res.writeHead(404); res.end('nf') })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const tools = new Map()
apply({ inject: (_d, cb) => cb(), effect: (fn) => fn(), get: (n) => (n === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined), tools: { register: (d) => tools.set(d.name, d) }, logger: { error: (m) => console.error('[ERR]', m), warn: () => {}, info: () => {} } })
const post = async (a, p) => (await (await fetch('http://127.0.0.1:' + port + '/desk-kit-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a, payload: p }) })).json())
const get = async () => (await (await fetch('http://127.0.0.1:' + port + '/desk-kit-api')).json())

const born = await post('capture', { text: '小美的生日是农历八月十五' })
assert.equal(born.result.parsed.lunar.month, 8)
console.log('✓ 农历生日:', born.result.reply, '| lunar =', JSON.stringify(born.result.item.lunar))

const born2 = await post('capture', { text: '张三生日 5月3日' })
assert.equal(born2.result.parsed.annual, '05-03')
console.log('✓ 公历生日:', born2.result.reply)

const sec = await post('secret.add', { title: '家里 WiFi', body: 'SSID: Home-5G\n密码: abc!2345' })
assert.ok(sec.ok)
const got = await post('secret.get', { query: '家里 WiFi' })
assert.ok(got.result.fields['内容'].includes('abc!2345'))
console.log('✓ 自由正文加密:', Object.keys(got.result.fields).join(','))

const st = await get()
console.log('✓ 快照: reminders=' + st.state.reminders.length, 'secrets=' + st.state.secrets.length)
srv.close()
console.log('\nV0.6 VERIFIED (plugin dir)')
