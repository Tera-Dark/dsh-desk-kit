/**
 * 客户端交互 E2E:真浏览器 + 真 React + 真接口。
 *
 * 为什么要有:client-test.mjs 只能断言「渲染出什么 HTML」,
 * 点一下、粘一张图、按 Esc 这些真实交互它测不到 —— 而「粘贴截图」正是本插件最要紧的一条链。
 *
 * 做法:起一个本地服务,同时提供
 *   /            测试页(自己驱动所有交互,不依赖 Playwright)
 *   /client.js   真的插件客户端(产物)
 *   /react.js    宿主那份 React(UMD)
 *   /desk-kit-api 真的插件接口
 * 页面跑完把结果 POST 回来,这个脚本打印并退出(0/1)。
 *
 * 用法:
 *   npm run test:ui          # 起服务,打开打印出来的地址
 *   npm run test:ui -- --auto  # 只起服务,不尝试打开浏览器
 */
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// 数据目录用临时目录:这个测试不许碰你真实的随手台数据
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dk-ui-e2e-'))
const { apply } = await import('file://' + join(ROOT, 'index.js').replace(/\\/g, '/'))

// ---- 找宿主那份 react(UMD 构建) ----
function umd(name) {
  const tries = [join(ROOT, 'package.json'), join(process.env.DSH_HOME || '', 'profiles', 'desktop', 'package.json')]
  for (const from of tries) {
    try {
      const r = createRequire(from)
      const main = r.resolve(name)
      const base = main.replace(/[\\/](index|cjs|dist[\\/][a-z-]+)\.js$/, '')
      const dir = dirname(main)
      const cand = [
        join(dir, 'umd', name + '.development.js'),
        join(dir, 'umd', name + '.production.min.js'),
      ]
      for (const c of cand) { try { return readFileSync(c, 'utf8') } catch { } }
    } catch { /* 换下一个 */ }
  }
  // 最后试 DSH profile 根
  const profile = join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json')
  try {
    const r = createRequire(profile)
    const main = r.resolve(name)
    const dir = dirname(main)
    for (const c of [join(dir, 'umd', name + '.development.js'), join(dir, 'umd', name + '.production.min.js')]) {
      try { return readFileSync(c, 'utf8') } catch { }
    }
  } catch { }
  throw new Error('找不到 ' + name + ' 的 UMD 构建:请在 DSH profile 或本仓库装好 react / react-dom')
}

const REACT = umd('react')
const REACT_DOM = umd('react-dom')

// ---- 插件接口(桩掉宿主服务) ----
const routes = []
const tools = new Map()
apply({
  inject: (_d, cb) => cb(), effect: (fn) => fn(),
  get: (n) => (n === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined),
  tools: { register: (d) => tools.set(d.name, d) },
  logger: { error: (m) => console.error('[plugin]', m), warn() {}, info() {} },
})

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>desk-kit ui e2e</title>
<style>body{margin:0;background:#0f1115;color:#e6edf3;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:16px;width:390px}
#root{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:10px;min-height:200px}
pre{white-space:pre-wrap;font-size:11.5px;color:#9aa4b2;margin-top:12px}</style></head><body>
<div id="root"></div><pre id="log"></pre>
<script>window.__ModuleLoader__={ load:(spec)=>{ window.__spec=spec } }</script>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/client.js"></script>
<script src="/ui-run.js"></script>
</body></html>`

const RUN = String.raw`
const log = (s) => { document.getElementById('log').textContent += s + '\n' }
const results = []
const step = (name, ok, extra) => { results.push({ name, ok, extra: extra || '' }); log((ok ? '✓ ' : '✖ ') + name + (extra ? '  ' + extra : '')) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond, ms = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { const v = cond(); if (v) return v } catch (e) { } await sleep(60) }
  return null
}
const byText = (tag, text) => Array.from(document.querySelectorAll(tag)).find((el) => (el.textContent || '').trim().includes(text))
function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const click = (el) => {
  if (!el) throw new Error('要点的元素不存在')
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}
/** 编辑器可能已经开着(按钮变成「收起」),也可能没开 —— 两种都能进去 */
async function openComposer() {
  const open = document.querySelector('.__dk_form textarea')
  if (open) return document.querySelector('.__dk_form')
  click(await waitFor(() => byText('button', '新便签')))
  return waitFor(() => document.querySelector('.__dk_form'))
}
/** 保存之后等下它收起,否则下一步找不到「新便签」按钮 */
const waitClosed = () => waitFor(() => !document.querySelector('.__dk_form'), 3000)

const T = window.__spec.factory((n) => (n === 'react' ? React : ReactDOM)).__test
// 真机上样式由 apply() 注入;E2E 直接挂组件,所以要显式注入一次,
// 否则测的是一棵没有 CSS 的裸 DOM(之前就漏了这一步)。
T.injectCss()
const h = React.createElement
const container = document.getElementById('root')
const reactRoot = ReactDOM.createRoot(container)
let state = null
let painted = 0
function paint() { painted++; reactRoot.render(h('div', { className: '__dk_page' }, h(T.NotesPage, { state, run }))) }
async function run(action, payload) {
  const res = await fetch('/desk-kit-api', { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk-kit': '1' }, body: JSON.stringify({ action, payload: payload || {} }) })
  const body = await res.json()
  if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status))
  state = body.state
  paint()
  return body
}
async function boot() {
  const res = await fetch('/desk-kit-api', { headers: { 'x-desk-kit': '1' } })
  state = (await res.json()).state
  paint()
  await waitFor(() => document.querySelector('textarea'))
}

async function makePng() {
  const c = document.createElement('canvas'); c.width = 140; c.height = 90
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#2b6cf6'; ctx.fillRect(0, 0, 140, 90)
  ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.fillText('截图', 44, 54)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  return new File([blob], 'E2E 截图.png', { type: 'image/png' })
}
function pasteFiles(el, files) {
  const dt = new DataTransfer()
  for (const f of files) dt.items.add(f)
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
}

;(async () => {
  try {
    await boot()
    step('插件样式已注入', !!document.querySelector('style[data-plugin-css]'))
    step('挂载 NotesPage(真组件 + 真接口)', !!document.querySelector('input[type=search]'))

    // 1) 新建便签:真实输入 → 点保存
    const form1 = await openComposer()
    setValue(form1.querySelector('textarea'), 'E2E 第一条便签')
    await sleep(50)
    click(byText('button', '保存'))
    const created = await waitFor(() => (document.body.textContent || '').includes('E2E 第一条便签'))
    step('新建便签', !!created)
    await waitClosed()

    // 2) 粘贴一张真 PNG → 挂在草稿 → 保存 → 出现缩略图
    const form = await openComposer()
    const png = await makePng()
    pasteFiles(form, [png])
    const thumb = await waitFor(() => document.querySelector('.__dk_draftfiles img, .__dk_fchip img'))
    step('粘贴截图 → 草稿里出现缩略图', !!thumb)
    click(byText('button', '保存'))
    const saved = await waitFor(() => Array.from(document.querySelectorAll('.__dk_fgrid img')).length > 0)
    await waitClosed()
    step('保存后便签里出现附件缩略图', !!saved)
    const withFile = (state.notes || []).find((n) => (n.files || []).length > 0)
    step('快照里那条便签记住了附件', !!withFile, withFile ? withFile.files.length + ' 个' : '')
    const meta = (state.files || []).find((f) => (withFile.files || []).includes(f.id))
    step('粘贴进来的截图自动起名(带时间),不是 image.png', !!(meta && /^截图 \d{8}-\d{6}\.png$/.test(meta.name)), meta ? meta.name : '')

    // 3) 点缩略图 → 大图真的加载出来
    const tile = document.querySelector('.__dk_fgrid img')
    click(tile)
    const light = await waitFor(() => document.querySelector('.__dk_light'))
    step('点缩略图打开大图', !!light)
    const img = light && light.querySelector('img')
    await waitFor(() => img && img.complete && img.naturalWidth > 0, 4000)
    step('大图从取件地址真的加载出来', !!(img && img.naturalWidth > 0), img ? img.naturalWidth + '×' + img.naturalHeight : '没加载')
    step('大图上有尺寸和下载', !!(light && light.textContent.includes('140×90') && light.textContent.includes('下载')))

    // 4) Esc 关闭
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const closed = await waitFor(() => !document.querySelector('.__dk_light'), 3000)
    step('Esc 关闭大图', !!closed)

    // 5) 搜索附件名 → 「附件里命中」
    const search = document.querySelector('input[type=search]')
    setValue(search, '截图')
    const hit = await waitFor(() => (document.body.textContent || '').includes('附件里命中'), 4000)
    step('搜索附件名命中', !!hit)
    setValue(search, '')

    // 6) 提醒表单:标题按 Enter 直接保存
    const remHost = document.createElement('div')
    document.body.appendChild(remHost)
    const remRoot = ReactDOM.createRoot(remHost)
    const paintRem = () => remRoot.render(h('div', { className: '__dk_page' }, h(T.RemindersPage, { state, run, notify: () => { } })))
    paintRem()
    await waitFor(() => remHost.textContent.includes('新提醒'))
    click(Array.from(remHost.querySelectorAll('button')).find((b) => b.textContent.includes('新提醒')))
    const remForm = await waitFor(() => remHost.querySelector('.__dk_form'))
    const remTitle = remForm && remForm.querySelector('input.__dk_input')
    setValue(remTitle, 'E2E Enter 提醒')
    remTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const remSaved = await waitFor(() => (state.reminders || []).some((r) => r.title === 'E2E Enter 提醒'), 4000)
    step('提醒表单 Enter 直接保存', !!remSaved)
    paintRem()

    // 7) 浮层面板:点面板外面关闭
    const rootHost = document.createElement('div')
    document.body.appendChild(rootHost)
    const rootRoot = ReactDOM.createRoot(rootHost)
    rootRoot.render(h(T.Root, { bridge: { read: () => ({ ready: false, open: null }), subscribe: () => () => { } } }))
    const fab = await waitFor(() => rootHost.querySelector('.__dk_fab'))
    fab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, pointerId: 1 }))
    fab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, pointerId: 1 }))
    const panel = await waitFor(() => rootHost.querySelector('.__dk_panel'))
    step('点浮标打开面板', !!panel)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 2 }))
    const panelClosed = await waitFor(() => !rootHost.querySelector('.__dk_panel'), 3000)
    step('点面板外关闭浮层面板', !!panelClosed)

    // 8) 首页快搜:只记得「脸书」,也要能跨到保险库并一键确认
    const made = await run('secret.add', { title: 'Facebook', body: '账号 demo_user,这个用于脸书' })
    const secretId = made.result && made.result.id
    const qfHost = document.createElement('div')
    document.body.appendChild(qfHost)
    const qfRoot = ReactDOM.createRoot(qfHost)
    let goto = null
    qfRoot.render(h(T.Home, { state, run, notify: () => { }, onLink: () => { }, onGo: (p, o) => { goto = { p, o } } }))
    const qfInput = await waitFor(() => qfHost.querySelector('.__dk_qfinput'))
    setValue(qfInput, '脸书')
    const secRow = await waitFor(() => Array.from(qfHost.querySelectorAll('.__dk_qfrow')).find((b) => (b.textContent || '').includes('保险库')))
    step('快搜:中英别名命中保险库', !!secRow)
    click(secRow)
    step('快搜:点结果带条目定位跳转', !!(goto && goto.p === 'vault' && goto.o && goto.o.secretId === secretId))

    // 标题里没有关键词时,快搜要给出「在保险库内容里再找一次」
    const made2 = await run('secret.add', { title: '工作账号', body: '这个用于电报' })
    const secret2 = made2.result && made2.result.id
    setValue(qfInput, 'telegram')
    const deepBtn = await waitFor(() => qfHost.querySelector('.__dk_qfdeep'))
    step('快搜:标题没命中时提供内容深搜', !!deepBtn)
    click(deepBtn)
    const deepRow = await waitFor(() => Array.from(qfHost.querySelectorAll('.__dk_qfrow')).find((b) => (b.textContent || '').includes('内容')), 4000)
    step('快搜:深搜命中保险库内容', !!deepRow)
    if (deepRow) {
      click(deepRow)
      step('快搜:深搜结果也能定位', !!(goto && goto.p === 'vault' && goto.o && goto.o.secretId === secret2))
    }

    const vHost = document.createElement('div')
    document.body.appendChild(vHost)
    const vRoot = ReactDOM.createRoot(vHost)
    const vRun = async (action, payload) => {
      const body = await run(action, payload)
      return body
    }
    vRoot.render(h(T.VaultPage, { state, run: vRun, notify: () => { }, focus: { secretId } }))
    const revealed = await waitFor(() => vHost.textContent.includes('账号 demo_user'), 4000)
    step('从快搜进保险库自动展开对应条目', !!revealed)

    // 8b) 保险库合集:筛选 + 上下移动保存顺序
    const c1 = await run('secret.add', { title: 'E2E合集一', body: 'x', collection: 'E2E合集' })
    const c2 = await run('secret.add', { title: 'E2E合集二', body: 'x', collection: 'E2E合集' })
    const cHost = document.createElement('div')
    document.body.appendChild(cHost)
    const cRoot = ReactDOM.createRoot(cHost)
    const paintColl = () => cRoot.render(h(T.VaultPage, { state, run: vRun, notify: () => { } }))
    const vRun2 = async (action, payload) => {
      const body = await run(action, payload)
      paintColl()
      return body
    }
    // 用带重绘的 run 重新挂一次,点击后 UI 才会跟着新 state 走
    cRoot.render(h(T.VaultPage, { state, run: vRun2, notify: () => { } }))
    const chip = await waitFor(() => Array.from(cHost.querySelectorAll('button')).find((b) => (b.textContent || '').includes('E2E合集 2')))
    step('保险库合集入口与条数', !!chip)
    click(chip)
    const two = await waitFor(() => cHost.querySelectorAll('[data-dk-secret]').length === 2)
    step('保险库按合集筛选', !!two)
    const firstRow = cHost.querySelector('[data-dk-secret]')
    const down = firstRow && firstRow.querySelector('button[aria-label="下移"]')
    click(down)
    const swapped = await waitFor(() => {
      const list = (state.secrets || []).filter((x) => x.collection === 'E2E合集').sort((a, b) => a.order - b.order)
      return list.length === 2 && list[0].title === 'E2E合集二' && list[1].title === 'E2E合集一'
    }, 4000)
    step('保险库合集上下移动并保存顺序', !!swapped)
    await run('secret.delete', { query: c1.result.id })
    await run('secret.delete', { query: c2.result.id })

    // 9) 手机主屏深链:打开面板 → 首页 → 预填输入框 → 清掉地址参数
    history.replaceState(null, '', '/?dk=capture&text=' + encodeURIComponent('深链预填'))
    T.handleDeepLink()
    const deepInput = await waitFor(() => {
      const panel = rootHost.querySelector('.__dk_panel')
      const ta = panel && panel.querySelector('.__dk_capture textarea')
      return ta && ta.value === '深链预填' ? ta : null
    }, 6000)
    step('深链 ?dk=capture 打开面板并预填', !!deepInput)
    step('深链处理完清掉地址参数', location.search === '')

    // 10) 录入后的分类提示:显眼出现,几秒后自己淡出
    setValue(deepInput, '帮我记一下，明天下午四点喂猫粮。')
    click(deepInput.closest('.__dk_capture').querySelector('.__dk_send'))
    const toast = await waitFor(() => document.querySelector('.__dk_toast'), 4000)
    const toastText = toast ? (toast.textContent || '') : ''
    step('录入后出现分类+摘要提示', !!toast && toastText.includes('提醒') && toastText.includes('喂猫粮') && toastText.includes('已保存'))
    const toastGone = await waitFor(() => !document.querySelector('.__dk_toast'), 7000)
    step('提示自动淡出', !!toastGone)

    window.__E2E = { results, ok: results.every((r) => r.ok) }
  } catch (e) {
    step('未捕获异常', false, String((e && e.message) || e))
    window.__E2E = { results, ok: false }
  }
  try {
    await fetch('/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(window.__E2E) })
  } catch (e) { }
})()
`

const server = createServer((req, res) => {
  const url = String(req.url || '/')
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  for (const r of routes) if (url.startsWith(r.path)) return r.handler(req, res)
  if (url === '/done' && req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let out = { results: [], ok: false }
      try { out = JSON.parse(raw) } catch { }
      console.log('\n—— 浏览器里报回来的结果 ——')
      for (const r of out.results) console.log((r.ok ? '  ✓ ' : '  ✖ ') + r.name + (r.extra ? '  ' + r.extra : ''))
      const passed = out.results.filter((r) => r.ok).length
      console.log('\n' + passed + '/' + out.results.length + (out.ok ? ' · UI E2E PASSED' : ' · UI E2E FAILED'))
      res.writeHead(204); res.end()
      setTimeout(() => { server.close(); process.exit(out.ok ? 0 : 1) }, 100)
    })
    return
  }
  if (url === '/' || url.startsWith('/?')) return send(200, 'text/html; charset=utf-8', PAGE)
  if (url === '/client.js') return send(200, 'application/javascript; charset=utf-8', readFileSync(join(ROOT, 'client.js'), 'utf8'))
  if (url === '/react.js') return send(200, 'application/javascript; charset=utf-8', REACT)
  if (url === '/react-dom.js') return send(200, 'application/javascript; charset=utf-8', REACT_DOM)
  if (url === '/ui-run.js') return send(200, 'application/javascript; charset=utf-8', RUN)
  send(404, 'text/plain; charset=utf-8', 'not found')
})

const port = Number(process.env.PORT || 8795)
server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port + '/'
  console.log('UI E2E 就绪:' + url)
  console.log('(用浏览器打开它;页面会自己跑完所有交互,然后把结果报回来)')
  if (!process.argv.includes('--auto') && process.platform === 'win32') {
    try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref() } catch { }
  }
})
setTimeout(() => { console.error('超时:60 秒内没有收到浏览器结果'); server.close(); process.exit(1) }, 60000)
