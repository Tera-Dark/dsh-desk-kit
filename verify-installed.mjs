import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dk-inst-'))
const { apply, name } = await import('dsh-desk-kit')
assert.equal(name, 'dsh-desk-kit')
const routes = []
const srv = createServer((req, res) => { for (const r of routes) if (String(req.url || '').startsWith(r.path)) return r.handler(req, res); res.writeHead(404); res.end('nf') })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const tools = new Map()
apply({ inject: (_d, cb) => cb(), effect: (fn) => fn(), get: (n) => (n === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined), tools: { register: (d) => tools.set(d.name, d) }, logger: { error: (m) => console.error('[ERR]', m), warn: () => {}, info: () => {} } })
console.log('工具数:', tools.size)
const post = async (a, p) => (await (await fetch('http://127.0.0.1:' + port + '/desk-kit-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: a, payload: p }) })).json())
const b1 = await post('capture', { text: '小美的生日是农历八月十五' })
assert.equal(b1.result.parsed.lunar.month, 8)
console.log('✓ 农历生日:', b1.result.reply)
const b2 = await post('capture', { text: '张三生日 5月3日' })
assert.equal(b2.result.parsed.annual, '05-03')
console.log('✓ 公历生日:', b2.result.reply)
const s1 = await post('secret.add', { title: '家里WiFi', body: 'SSID Home-5G / 密码 abc!2345' })
assert.ok(s1.ok, JSON.stringify(s1).slice(0,120))
const g1 = await post('secret.get', { query: '家里WiFi' })
assert.ok(Object.values(g1.result.fields).join('').includes('abc!2345'))
console.log('✓ 保险库自由正文:', Object.keys(g1.result.fields).join(','))
srv.close()
console.log('\n安装验证通过')
