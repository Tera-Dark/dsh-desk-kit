import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// 宿主(react / react-dom)可能装在 DSH 自带的 profile 里,也可能装在本仓库里。
// 两处都找,找不到就报一句人话,而不是抛 ERR_MODULE_NOT_FOUND。
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = join(DSH_HOME, 'profiles', 'desktop')
function hostRequire() {
  const candidates = [join(PROFILE, 'package.json'), join(HERE, 'package.json')]
  for (const from of candidates) {
    try {
      const r = createRequire(from)
      r.resolve('react')
      return r
    } catch (error) { /* 这一步找不到就换下一个位置 */ }
  }
  throw new Error('找不到宿主 react:请在 DSH profile 或本仓库装好 react / react-dom 后再跑测试')
}
const req = hostRequire()
const React = req('react')
const { renderToString } = req('react-dom/server')

let captured = null
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec } } }
await import(pathToFileURL(join(HERE, 'client.js')).href)
const mod = captured.factory(req)
const T = mod.__test
const h = React.createElement

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F0FF}]/u

const state = {
  now: Date.now(), today: '2026-11-14',
  notes: [{ id: 'n1', text: '资料合集:AAA / BBB', tags: ['资料'], pinned: true, archived: false, createdAt: 1, updatedAt: 2 }],
  notesArchivedCount: 0,
  reminders: [{ id: 'r1', title: '每日打卡', time: '21:00', weekdays: [], leadMin: 30, url: 'https://example.com/s', status: 'pending', done: false, occurrenceAt: Date.now() + 3600000, active: true }],
  alerts: [],
  secrets: [{ id: 's1', title: '某示例站点', tags: [], createdAt: 5, updatedAt: 5, fieldCount: 0 }],
  settings: { tickSeconds: 20, muted: false },
  root: '/tmp/desk-kit',
}
const run = async () => ({ ok: true, state })

test('底部导航:4 个分类 + 中间首页圆键 + 角标(设置挪到标题栏)', () => {
  const html = renderToString(h(T.TabBar, { page: 'notes', go: () => {}, due: 2 }))
  for (const label of ['提醒', '便签', '网页', '保险库']) assert.ok(html.includes(label), '缺 ' + label)
  assert.ok(!html.includes('设置'), '设置不该再占底部一格')
  assert.ok(html.includes('__dk_tabhome'), '缺中间圆键')
  assert.ok(html.includes('__dk_tab on'), '当前页要高亮')
  assert.ok(html.includes('__dk_dot'), '有待办要出角标')
})

test('图标是内联 SVG(黑白 stroke),不是 emoji', () => {
  const html = renderToString(h(T.Ico, { name: 'bell' }))
  assert.ok(html.startsWith('<svg'))
  assert.ok(html.includes('stroke="currentColor"'))
  assert.ok(html.includes('<path'))
  assert.ok(!EMOJI.test(html))
  for (const name of Object.keys(T.PATHS)) {
    const one = renderToString(h(T.Ico, { name }))
    assert.ok(one.includes('<svg') && one.includes('<path'), name + ' 不是 svg')
  }
})

test('各页正文不含 emoji', () => {
  const pages = [
    h(T.Home, { state, run, onLink: () => {} }),
    h(T.RemindersPage, { state, run }),
    h(T.NotesPage, { state, run }),
    h(T.VaultPage, { state, run }),
    h(T.Settings, { state, run }),
  ]
  for (const p of pages) {
    const html = renderToString(p)
    const m = html.match(EMOJI)
    assert.ok(!m, '发现 emoji: ' + (m && m[0]))
  }
})

test('首页极简:今天 + 最近记的,不再有分类列表', () => {
  const html = renderToString(h(T.Home, { state, run, onLink: () => {} }))
  assert.ok(html.includes('今天'))
  assert.ok(html.includes('每日打卡'))
  assert.ok(html.includes('打开'), '带网址的提醒要有打开入口')
  assert.ok(html.includes('最近记的'))
  assert.ok(!html.includes('__dk_navrow'), '分类列表应交给底栏')
})

test('提醒页仍可手动新增/编辑', () => {
  const html = renderToString(h(T.RemindersPage, { state, run }))
  assert.ok(html.includes('新提醒'))
  assert.ok(html.includes('每日打卡'))
  assert.ok(html.includes('打开'), '带网址的提醒要有打开入口')
  assert.ok(html.includes('<svg'), '要有 SVG 图标按钮')
})

test('便签页长文全文 + 标签', () => {
  const html = renderToString(h(T.NotesPage, { state, run }))
  assert.ok(html.includes('资料合集:AAA / BBB'))
  assert.ok(html.includes('资料'))
})

test('设置显示版本号', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  const m = /const VERSION = '([0-9.]+)'/.exec(src)
  assert.ok(m, '缺 VERSION 常量')
  assert.ok(renderToString(h(T.Settings, { state, run })).includes(m[1]))
})

test('apiPost 回写 ETag/state,下一次轮询带 if-none-match 并命中 304', async () => {
  const calls = []
  const reply = (body, headers = {}, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
  })
  const prev = globalThis.fetch
  globalThis.fetch = async (_url, opts = {}) => {
    calls.push(opts)
    if (opts.method === 'POST') {
      return reply({ ok: true, result: { id: 'n1' }, state: { now: 1, marker: 'post' } }, { etag: '"v1"' })
    }
    return reply(null, { etag: '"v1"' }, 304)
  }
  try {
    await T.apiPost('note.add', { text: 'x' })
    const st = await T.apiGet()
    assert.equal(st, null, '304 时 apiGet 必须返回 null(保持原样)')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[1].headers['if-none-match'], '"v1"', 'POST 回来的 ETag 要带到下一次 GET')
    assert.equal((await T.apiGetOrLast()).marker, 'post', '304 时用 POST 带回来的 state')
  } finally {
    if (prev === undefined) delete globalThis.fetch
    else globalThis.fetch = prev
  }
})

test('fetch 断网时给中文提示,不把 Failed to fetch 甩给用户', async () => {
  const prev = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  try {
    await assert.rejects(T.apiGet(), /连不上本地服务/)
    await assert.rejects(T.apiPost('note.add', {}), /连不上本地服务/)
  } finally {
    if (prev === undefined) delete globalThis.fetch
    else globalThis.fetch = prev
  }
})

test('错误条:有重试时给按钮,没重试时只显示一句', () => {
  const withRetry = renderToString(h(T.ErrorBar, { text: '读不到数据', onRetry: () => { } }))
  assert.ok(withRetry.includes('读不到数据'))
  assert.ok(withRetry.includes('重试'), '有 onRetry 时要出重试按钮')
  const plain = renderToString(h(T.ErrorBar, { text: '只是提示' }))
  assert.ok(plain.includes('只是提示'))
  assert.ok(!plain.includes('重试'), '没有 onRetry 时不该出现按钮')
})

test('样式注入可回收,重建时更新同一个节点而不是留旧 CSS', () => {
  const tags = []
  const head = {
    appendChild(t) { t.parentNode = head; tags.push(t); return t },
    removeChild(t) { t.parentNode = null },
  }
  const doc = {
    head,
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: (sel) => tags.find((t) => t.parentNode === head && sel.includes(t.dataset.pluginCss)) || null,
  }
  const prev = globalThis.document
  globalThis.document = doc
  try {
    const off1 = T.injectCss()
    assert.equal(tags.length, 1, '首次注入一个 style 节点')
    assert.ok(tags[0].textContent.includes('__dk_sp'), '内容应是当前 CSS')
    tags[0].textContent = 'old'
    const off2 = T.injectCss()
    assert.equal(tags.length, 1, '重建时复用同一个节点')
    assert.ok(tags[0].textContent.includes('__dk_sp'), '复用时要更新到最新 CSS')
    off2()
    assert.equal(tags[0].parentNode, null, 'dispose 时要把 style 摘掉')
    const off3 = T.injectCss()
    assert.equal(tags.length, 2, '摘掉之后再次 apply 会重新建')
    off3()
    off1() // 重复清理不应抛错
  } finally {
    if (prev === undefined) delete globalThis.document
    else globalThis.document = prev
  }
})

test('便签默认只显示前 8 条,不堆满屏', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: 'n' + i, text: '便签' + i, tags: [], shelf: 'daily',
    completedAt: 0, deletedAt: 0, createdAt: 1, updatedAt: 100 - i,
  }))
  const s2 = { ...state, notes: many, noteCounts: { active: 20, long: 0, done: 0, trash: 0 } }
  const html = renderToString(h(T.NotesPage, { state: s2, run }))
  assert.ok(html.includes('进行中'), '要有进行中段')
  assert.ok(html.includes('便签0'))
  assert.ok(!html.includes('便签19'), '默认不显示第 9 条之后')
  assert.ok(html.includes('显示更多'), '超出要能点开继续看')
})

test('粘贴图片:文件优先,网页地址/本地路径/metadata 都能认出来', () => {
  const fake = (html, plain, files) => ({
    items: [],
    files: files || [],
    getData: (t) => (t === 'text/html' ? html : t === 'text/plain' ? plain : ''),
  })
  assert.deepEqual(T.clipboardImage(fake('', 'C:\\Users\\me\\Pictures\\a.png')), { localPath: 'C:\\Users\\me\\Pictures\\a.png' })
  assert.deepEqual(T.clipboardImage(fake('<img src="https://cdn.example/a.png?x=1">', '')), { url: 'https://cdn.example/a.png?x=1' })
  assert.deepEqual(T.clipboardImage(fake('<img src="https://cdn.example/signed?id=1">', '')), { url: 'https://cdn.example/signed?id=1' })
  assert.deepEqual(T.clipboardImage(fake('', 'data:image/png;base64,AAAA')), { dataUrl: 'data:image/png;base64,AAAA' })
  assert.equal(T.clipboardImage(fake('', '只是普通文字')), null)
  assert.ok(T.LOCAL_PASTE_TIP.includes('浏览器读不到'), '本地路径要给人话提示')
})

test('保险库有合集筛选、合集字段和拖动排序入口', () => {
  const st = {
    ...state,
    secrets: [
      { id: 's1', title: '订阅一', collection: '梯子订阅', order: 1, tags: [], createdAt: 1, updatedAt: 2, fieldCount: 0 },
      { id: 's2', title: '订阅二', collection: '梯子订阅', order: 2, tags: [], createdAt: 1, updatedAt: 3, fieldCount: 0 },
      { id: 's3', title: '别的条目', collection: '', order: 1, tags: [], createdAt: 1, updatedAt: 4, fieldCount: 0 },
    ],
  }
  const html = renderToString(h(T.VaultPage, { state: st, run }))
  assert.ok(html.includes('搜保险库标题或合集'), '要有独立搜索框')
  assert.ok(html.includes('梯子订阅 2'), '要显示合集与条数')
  assert.ok(html.includes('全部 3'), '要有全部入口')
  assert.ok(html.includes('未分类 1'), '要有未分类入口')
  assert.ok(readFileSync(join(HERE, 'client.js'), 'utf8').includes('__dk_collpick'), '新建/编辑要能填合集')
  assert.ok(html.includes('选一个合集后可拖拽排序'), '未选合集时提示先选合集')
  assert.ok(html.includes('__dk_vaulthead') && html.includes('__dk_vaultstats'), '页头统计与动作要分行')
  assert.ok(html.includes('__dk_showbtn') && html.includes('__dk_iact--bar'), '标题和动作要分行')
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes("secret.reorder"), '缺拖动排序动作')
  assert.ok(src.includes('draggable: dragEnabled'), '缺拖拽标记')
  assert.ok(src.includes("name: 'chevronUp'") && src.includes("name: 'chevronDown'"), '缺移动端上下移动按钮')
  assert.ok(src.includes('__dk_chipmore'), '合集多了要有展开/收起')

  const many = {
    ...state,
    secrets: ['A', 'B', 'C', 'D', 'E'].flatMap((name) => [
      { id: 'm-' + name, title: name, collection: '合集' + name, order: 1, tags: [], createdAt: 1, updatedAt: 1, fieldCount: 0 },
    ]),
  }
  const html2 = renderToString(h(T.VaultPage, { state: many, run }))
  assert.ok(html2.includes('更多 2'), '五个合集时先收起两个')
  assert.ok(html2.includes('__dk_chipmore'), '要有展开按钮')
})

test('保险库新建是单个自由文本框', () => {
  const html = renderToString(h(T.VaultPage, { state, run }))
  assert.ok(html.includes('新条目'))
  assert.ok(!html.includes('用户名 / 邮箱'), '不再逼用户拆字段')
  assert.ok(!html.includes('密码 / 密钥'))
})

test('提醒表单支持公历/农历每年', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('公历每年') && src.includes('农历每年'), '缺周期选项')
  const html = renderToString(h(T.RemindersPage, { state, run }))
  assert.ok(html.includes('打开'), '带网址的提醒要有打开入口')
})

test('滑屏动画与触摸手势都写了', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('__dkSlideL') && src.includes('__dkSlideR'), '缺左右滑入动画')
  assert.ok(src.includes('onPointerDown') && src.includes('onPointerUp'), '缺滑动手势')
  assert.ok(src.includes('animation-duration'), '缺动画时长')
})

test('输入框是多行自适应 textarea(带 max-height 与 Shift+Enter)', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('function CaptureBar'), '缺 CaptureBar')
  assert.ok(src.includes('CAPTURE_MAX_H'), '缺最大高度常量')
  assert.ok(!src.includes("h('input', {\n          key: 'i', ref, className: '__dk_input'"), '不该还是单行 input')
  // 渲染一次,确认是 textarea 且挂了 __dk_grow
  const html = renderToString(h(T.CaptureBar, { run, onDone: () => {} }))
  assert.ok(html.includes('<textarea'), '必须是 textarea')
  assert.ok(html.includes('__dk_grow'), '缺自适应样式类')
  assert.ok(src.includes('e.shiftKey'), 'Shift+Enter 要换行')
})

test('设置里只留真正有入口的模型下拉(分类),并给导出备份', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('classifyProvider') && src.includes('classifyModel'), '缺分类模型字段')
  assert.ok(src.includes('分类模型'), '缺分类模型文案')
  // 识图没有入口,留着只会让人以为能传图
  const settings = src.slice(src.indexOf('function Settings('), src.indexOf('// ---------------------------------------------------------------- 主体'))
  assert.ok(!settings.includes('recognizeProvider'), '设置里不该再有悬空的识图模型')
  assert.ok(src.includes('/export'), '缺导出备份入口')
})

test('模型下拉通用化组件能独立渲染', () => {
  const providers = [{ id: 'p1', name: '站A', models: [{ id: 'm1', name: '模型一', image: false }] }]
  const html = renderToString(h(T.ModelPicker, {
    label: '分类模型', hint: '纯文字就行', providerKey: 'classifyProvider', modelKey: 'classifyModel',
    settings: {}, onUpdate: () => {}, initialProviders: providers,
  }))
  assert.ok(html.includes('分类模型'))
  assert.ok(html.includes('纯文字就行'))
  assert.ok(html.includes('站A'))
})

test('便签分「进行中 / 长期资料」两段,已完成折叠,垃圾箱独立入口', () => {
  const st = {
    ...state,
    noteCounts: { active: 1, long: 1, done: 1, trash: 1 },
    notes: [
      { id: 'a1', text: '去做一下周报整理', tags: [], shelf: 'daily', completedAt: 0, deletedAt: 0, createdAt: 1, updatedAt: 9 },
      { id: 'l1', text: '资料精选池 · 75 位', tags: ['资料'], shelf: 'long', completedAt: 0, deletedAt: 0, createdAt: 1, updatedAt: 8 },
      { id: 'd1', text: '已完成的那条', tags: [], shelf: 'daily', completedAt: 5, deletedAt: 0, createdAt: 1, updatedAt: 7 },
      { id: 't1', text: '垃圾箱里的那条', tags: [], shelf: 'daily', completedAt: 0, deletedAt: 6, createdAt: 1, updatedAt: 6 },
    ],
  }
  const html = renderToString(h(T.NotesPage, { state: st, run }))
  assert.ok(html.includes('进行中'), '缺进行中段')
  assert.ok(html.includes('长期资料'), '缺长期段')
  assert.ok(html.includes('去做一下周报整理'))
  assert.ok(html.includes('资料精选池'), '长期条目要显示')
  assert.ok(!html.includes('已完成的那条'), '已完成默认折叠')
  assert.ok(!html.includes('垃圾箱里的那条'), '垃圾箱不在主列表')
  assert.ok(html.includes('显示已完成'), '要有已完成折叠入口')
  assert.ok(html.includes('垃圾箱 (1)'), '要有垃圾箱入口')
})

test('搜索跨进行中与长期一起搜,搜索框在最上面', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('buckets.active.concat(buckets.long)'), '搜索要跨两段')
  // 渲染顺序:搜索框必须排在新便签按钮之前
  const html = renderToString(h(T.NotesPage, { state, run }))
  const iq = html.indexOf('搜便签、提醒')
  const ib = html.indexOf('新便签')
  assert.ok(iq >= 0 && ib >= 0 && iq < ib, '搜索框应在操作条之前')
})

test('深链 ?dk=capture 只处理一次,清掉参数并带上预填文本', async () => {
  const prev = globalThis.window
  const events = []
  const loc = new URL('http://127.0.0.1:3080/?dk=capture&text=' + encodeURIComponent('记一下脸书账号') + '&x=1')
  let replaced = ''
  const fake = {
    location: loc,
    history: { replaceState: (_s, _t, url) => { replaced = url; loc.href = 'http://127.0.0.1:3080' + url } },
    dispatchEvent: (e) => { events.push(e); return true },
    addEventListener() { }, removeEventListener() { },
  }
  globalThis.window = fake
  try {
    assert.equal(T.handleDeepLink(), true, '带参数时要接住')
    await new Promise((r) => setTimeout(r, 140))
    const cap = events.find((e) => e.type === T.CAPTURE_EVENT)
    assert.ok(cap, '要发出 capture 事件')
    assert.equal(cap.detail.text, '记一下脸书账号', '要保留预填文本')
    assert.equal(replaced, '/?x=1', '只抹掉 dk/text,保留其它参数')
    assert.equal(T.handleDeepLink(), false, '参数抹掉后不能重复弹')
  } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
})

test('快搜:中英别名互通,首页入口能一次给出五类定位', () => {
  assert.ok(T.searchVariants('脸书').includes('facebook'), '中文要能展开到英文')
  assert.ok(T.searchMatch('Facebook 账号', T.searchVariants('脸书')), '别名匹配要生效')
  const st = {
    notes: [{ id: 'n1', text: '用于脸书的账号', tags: [], updatedAt: 1 }],
    reminders: [{ id: 'r1', title: '脸书登录提醒', note: '', updatedAt: 2 }],
    links: [{ id: 'w1', title: 'Facebook', url: 'https://facebook.com', note: '', group: '', updatedAt: 3 }],
    files: [{ id: 'f1', name: 'facebook截图.png', createdAt: 4 }],
    secrets: [{ id: 's1', title: 'Facebook', updatedAt: 5 }],
  }
  const res = T.searchSnapshot(st, '脸书')
  assert.equal(res.total, 5, '五类都要命中')
  assert.equal(res.hits.find((h) => h.kind === 'secret').where, '标题')
  assert.equal(res.hits.some((h) => h.kind === 'note' && h.snippet), true, '便签要带命中摘要')
  const html = renderToString(h(T.Home, { state: st, run: async () => { }, onGo: () => { }, notify: () => { } }))
  assert.ok(html.includes('找账号、便签、网页'), '首页要有快搜入口')
})

test('图标表里有 undo 与 trash', () => {
  for (const name of ['undo', 'trash']) {
    const svg = renderToString(h(T.Ico, { name }))
    assert.ok(svg.includes('<svg') && svg.includes('<path'), name + ' 不是 svg')
  }
})

test('提醒页有垃圾箱入口,能恢复与彻底删', () => {
  const st = {
    ...state,
    reminderCounts: { active: 1, trash: 1 },
    trashedReminders: [{ id: 'rt1', title: '被删的提醒', time: '21:00', deletedAt: Date.now() }],
    reminders: [{ id: 'r1', title: '每日打卡', time: '21:00', weekdays: [], leadMin: 30, status: 'upcoming', done: false, active: true }],
  }
  const html = renderToString(h(T.RemindersPage, { state: st, run }))
  assert.ok(html.includes('垃圾箱 (1)'), '要有垃圾箱入口')
  assert.ok(html.includes('每日打卡'))
  assert.ok(!html.includes('被删的提醒'), '垃圾箱内容不该进主列表')
})

test('生日档位给出提前量天数和提示', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('天前'), '缺提前量换算')
  assert.ok(src.includes('每年自动提醒'), '缺生日提示')
  assert.ok(src.includes('4320'), '缺建议值')
})

test('浮标位置:默认右下,拖动后夹在视口内,松手吸边', () => {
  const d = T.defaultFab()
  assert.ok(d.x > 800 && d.y > 500, '默认应在右下角')
  assert.equal(d.side, 'right')

  const inside = T.clampFab(100, 200, 1280, 800)
  assert.deepEqual(inside, { x: 100, y: 200 })

  const tooFar = T.clampFab(99999, 99999, 1280, 800)
  assert.ok(tooFar.x <= 1280 - T.FAB_SIZE && tooFar.y <= 800 - T.FAB_SIZE, '不能拖出屏幕')

  const negative = T.clampFab(-500, -500, 1280, 800)
  assert.ok(negative.x >= 4 && negative.y >= 4, '也不能拖进负坐标')

  const snapRight = T.snapFab({ x: 900, y: 300 }, 1280, 800)
  assert.equal(snapRight.side, 'right')
  assert.equal(snapRight.x, 1280 - T.FAB_SIZE - T.FAB_PAD, '贴右边缘')
  assert.equal(snapRight.y, 300, '垂直位置不动')

  const snapLeft = T.snapFab({ x: 60, y: 320 }, 1280, 800)
  assert.equal(snapLeft.side, 'left')
  assert.equal(snapLeft.x, T.FAB_PAD, '贴左边缘')
})

test('浮标支持点击/拖动两件事,拖动阈值 4px', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('onFabDown') && src.includes('onFabMove') && src.includes('onFabUp'), '缺三段拖动处理')
  assert.ok(src.includes('setPointerCapture'), '拖出按钮外也要跟手')
  assert.ok(src.includes('d.moved'), '要有「点/拖」判定')
  assert.ok(src.includes('saveFab'), '位置要能记住')
  assert.ok(src.includes('localStorage'), '位置存 localStorage')
})

test('面板一律夹在视口内(任何时候都不出屏)', () => {
  const VW = 1280; const VH = 800
  const fab = (x, y) => T.fabRectOf({ x, y })

  // 右下角:朝上开,面板不压浮标、不越过右边/上边
  const br = T.layoutPanel(fab(1216, 736), VW, VH)
  assert.ok(br.top >= 8, '上边要留白')
  assert.ok(br.top + br.height <= 736, '不能压浮标')
  assert.ok(br.left + br.width <= VW - 8, '不能出右边')

  // 左上角:朝下开,面板贴着浮标往下
  const tl = T.layoutPanel(fab(18, 18), VW, VH)
  assert.ok(tl.top >= 18 + T.FAB_SIZE, '要在浮标下方')
  assert.ok(tl.top + tl.height <= VH - 8, '不能出下边')
  assert.ok(tl.left >= 8, '左边至少留 8px')

  // 极端:浮标贴着右下角尖上,面板还得完整在屏幕内
  const corner = T.layoutPanel(fab(VW - T.FAB_SIZE, VH - T.FAB_SIZE), VW, VH)
  assert.ok(corner.left >= 0 && corner.top >= 0, '不能是负数')
  assert.ok(corner.left + corner.width <= VW && corner.top + corner.height <= VH, '不能越界')

  // 小窗口:不能宽过视口
  const small = T.layoutPanel(fab(300, 200), 360, 640)
  assert.ok(small.width <= 360 - 16, '窄窗口要跟着收窄')
  assert.ok(small.left + small.width <= 360 - 8, '收回视口')
})

test('坐标系偏移换算:宿主祖先有 transform/缩放时也对得上', () => {
  // 浮标按 (1216,736) 摆,实际量到 (1016,636):宿主容器整体偏了 -200
  const rect = T.fabRectOf({ x: 1016, y: 636 })
  const o = T.originOf(rect, { x: 1216, y: 736 })
  assert.equal(o.ox, -200)
  assert.equal(o.oy, -100)
  assert.equal(o.s, 1, '没有缩放时比例是 1')
  // 量不到真实矩形时不能瞎补,必须回到 0
  assert.deepEqual(T.originOf(null, { x: 1, y: 2 }), { ox: 0, oy: 0, s: 1 })
  assert.deepEqual(T.originOf(rect, null), { ox: 0, oy: 0, s: 1 })

  // 祖先缩放 1.3 倍:浮标设 left=100,屏幕上量到 130(原点在 0)
  const scaled = { left: 130, top: 65, right: 130 + T.FAB_SIZE * 1.3, bottom: 65 + T.FAB_SIZE * 1.3 }
  const o2 = T.originOf(scaled, { x: 100, y: 50 })
  assert.ok(Math.abs(o2.s - 1.3) < 1e-9, '要识别出 1.3 倍缩放')
  assert.ok(Math.abs(o2.ox) < 1e-6 && Math.abs(o2.oy) < 1e-6, '原点不变')

  // 视口坐标 → 本地坐标:面板要落在屏幕 (800,300) 宽 344,缩放 1.3 下本地应除回去
  const local = T.toLocal({ left: 800, top: 300, width: 344, height: 500 }, o2)
  assert.ok(Math.abs(local.left - 800 / 1.3) < 1e-6)
  assert.ok(Math.abs(local.width - 344 / 1.3) < 1e-6)
  // 无偏移无缩放时比例映射是恒等
  assert.deepEqual(T.toLocal({ left: 12, top: 34, width: 56, height: 78 }, { ox: 0, oy: 0, s: 1 }), { left: 12, top: 34, width: 56, height: 78 })
})

test('第三层兜底:量完再挪,任何坐标系下都能拉回屏幕', () => {
  const V = { vw: 1280, vh: 800 }
  const r = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h })

  // 完全在屏幕里:不动
  assert.deepEqual(T.nudgeIntoView(r(100, 100, 344, 500), V.vw, V.vh, 8), { dx: 0, dy: 0 })
  // 右边超出去 200:往左挪 200+(留白)
  const right = T.nudgeIntoView(r(1200, 100, 344, 500), V.vw, V.vh, 8)
  assert.equal(right.dx, 1280 - 8 - 1544)
  // 左边是负的:往右推回 8
  assert.equal(T.nudgeIntoView(r(-300, 100, 344, 500), V.vw, V.vh, 8).dx, 8 + 300)
  // 下边超出去:往上推
  assert.equal(T.nudgeIntoView(r(100, 700, 344, 500), V.vw, V.vh, 8).dy, 800 - 8 - 1200)
  // 整块在屏幕外(那种「点开直接飞出去」的情况):两个方向一起拉回
  const flying = T.nudgeIntoView(r(3000, 2000, 344, 500), V.vw, V.vh, 8)
  assert.equal(flying.dx, 1280 - 8 - 3344)
  assert.equal(flying.dy, 800 - 8 - 2500)
  // 挪完必须真的在屏幕内(自证)
  const moved = { left: 3000 + flying.dx, top: 2000 + flying.dy, right: 3344 + flying.dx, bottom: 2500 + flying.dy }
  assert.ok(moved.left >= 8 && moved.right <= V.vw - 8 && moved.top >= 8 && moved.bottom <= V.vh - 8, '挪完必须落在屏幕内')
})

test('面板不靠 inherited CSS 定位:自己 fixed + 量真实矩形 + 兜底平移', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(/__dk_panel\{position:fixed/.test(src), '面板自己 fixed,不依赖祖先坐标系')
  assert.ok(src.includes('getBoundingClientRect'), '要量浮标真实位置')
  assert.ok(src.includes('measureFab'), '缺浮标测量')
  assert.ok(src.includes('panelShift'), '缺最后的平移兜底')
  assert.ok(!src.includes('style.bottom = FAB_SIZE'), '不该再用相对定位的 bottom 算法')
})

test('重要等级分四档,首页今天列表按 L1 加粗', () => {
  assert.equal(T.LEVELS.home.code, 'L1')
  assert.equal(T.LEVELS.reminders.code, 'L1')
  assert.equal(T.LEVELS.notes.code, 'L2')
  assert.equal(T.LEVELS.vault.code, 'L3')
  assert.equal(T.LEVELS.settings.code, 'L4')
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('__dk_sec--act'), 'L1 段要有红点')
  assert.ok(src.includes('__dk_row--act'), 'L1 行要加粗')
  assert.ok(src.includes('__dk_sec--ref'), 'L3 段要压灰')
  assert.ok(src.includes('__dk_item--ref'), 'L3 条目要压灰')
  assert.ok(src.includes('__dk_lvl'), '标题旁要有等级胶囊')
})

test('顶栏侧门:浮标被挡住时也能打开', () => {
  const html = renderToString(h(T.HeaderButton, {}))
  assert.ok(html.includes('__dk_hbtn'), '缺顶栏按钮')
  assert.ok(html.includes('<svg'), '顶栏按钮要带图标')
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes("'conversation.session.header.utilities'"), '要注册到会话顶栏槽')
  assert.ok(src.includes('OPEN_EVENT') && src.includes('dispatchEvent'), '侧门统一走事件通知面板')
  assert.ok(src.includes('Escape'), 'Esc 要能关面板')
})

test('待办数统一口径:到点未完成 + 未确认提示', () => {
  assert.equal(T.dueCount(null), 0)
  const st2 = {
    settings: { muted: false },
    alerts: [{ id: 'a1' }],
    reminders: [{ status: 'pending', done: false }, { status: 'upcoming', done: false }, { status: 'pending', done: true }],
  }
  assert.equal(T.dueCount(st2), 2, '一条到点未完成 + 一条提示')
  assert.equal(T.dueCount({ ...st2, settings: { muted: true } }), 1, '静音后只剩待办')
})

// ---------------------------------------------------------------- 侧边栏(better-sidebar)
test('better-sidebar:注册「随手台」侧栏标签页', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes("ctx.get('betterSidebar')"), '要软取 betterSidebar 服务')
  assert.ok(src.includes('registerTab('), '要调 registerTab')
  assert.ok(src.includes("id: 'desk-kit:main'"), '标签页 id 是 desk-kit:main')
  assert.ok(src.includes('internal/service'), '要监听服务晚就绪(装插件顺序不定)')

  const registered = []
  const opened = []
  const service = {
    registerTab: (d) => { registered.push(d); return () => {} },
    openTab: (seed) => { opened.push(seed) },
  }
  const ctx = {
    slots: { inject: () => {}, register: () => () => {} },
    get: (n) => (n === 'betterSidebar' ? service : undefined),
    on: () => () => {},
    effect: (fn) => fn(),
  }
  mod.apply(ctx)
  assert.equal(registered.length, 1, '应注册且只注册一个标签页')
  const d = registered[0]
  assert.equal(d.id, 'desk-kit:main')
  assert.equal(typeof d.title, 'function')
  assert.equal(d.title(), '随手台')
  assert.equal(d.single, true, '单实例:不重复开')
  assert.equal(typeof d.component, 'function', '要有页面组件')
  assert.ok(renderToString(h(d.component, { visible: false })).includes('__dk_sp'), '侧栏页面用整页布局')
})

test('侧栏页面分类条:每个页面都有标题和图标(不能是 undefined)', () => {
  assert.deepEqual([...T.ORDER].sort(), ['home', 'links', 'notes', 'reminders', 'settings', 'vault'])
  for (const id of T.ORDER) {
    assert.equal(typeof T.PANEL_LABELS[id], 'string', id + ' 缺标题')
    assert.ok(T.PANEL_LABELS[id].length > 0, id + ' 标题为空')
    assert.equal(typeof T.PANEL_ICONS[id], 'string', id + ' 缺图标名')
    assert.ok(T.PATHS[T.PANEL_ICONS[id]], id + ' 的图标 ' + T.PANEL_ICONS[id] + ' 不在图标表里')
  }
})

test('侧栏页面渲染:标题条 + 五个分类 + 首页内容都在,没有 undefined 泄漏', () => {
  const html = renderToString(h(T.SidebarView, {
    state, page: 'home', seq: 0, reply: '', err: '', run,
    onGo: () => {}, onCaptureDone: () => {}, onLink: () => {},
  }))
  assert.ok(html.includes('__dk_sp'), '整页容器')
  assert.ok(html.includes('__dk_sphead'), '标题条')
  assert.ok(html.includes('__dk_spnav'), '分类条')
  for (const label of ['首页', '提醒', '便签', '保险库', '设置']) assert.ok(html.includes(label), '缺分类 ' + label)
  assert.ok(html.includes('__dk_stab on'), '当前分类要高亮')
  assert.ok(html.includes('随手台'), '标题')
  assert.ok(!html.includes('undefined'), '不能把 undefined 写进页面')
  // 每个分类页都要能渲染出来
  for (const p of T.SIDEBAR_ORDER) {
    const one = renderToString(h(T.SidebarView, {
      state, page: p, seq: 1, reply: '', err: '', run,
      onGo: () => {}, onCaptureDone: () => {}, onLink: () => {},
    }))
    assert.ok(one.includes('__dk_spbody'), p + ' 页正文缺失')
    assert.ok(!one.includes('undefined'), p + ' 页泄漏了 undefined')
  }
  // 没数据时是「正在读取」,不是白屏
  const loading = renderToString(h(T.SidebarView, { state: null, page: 'home', seq: 0, reply: '', err: '', run, onGo: () => {}, onCaptureDone: () => {}, onLink: () => {} }))
  assert.ok(loading.includes('正在读取'), '加载态要有提示')
})

test('浮标让位:有侧栏标签页就不画浮标,显式开关能强制打开', () => {
  // floatEnabled(state, sidebarReady) —— 纯函数,不读模块级状态
  assert.equal(T.floatEnabled({ settings: {} }, true), false, '有侧栏服务时浮标默认让位')
  assert.equal(T.floatEnabled({ settings: { floatFab: true } }, true), true, '显式打开要生效')
  assert.equal(T.floatEnabled({ settings: { floatFab: false } }, true), false, '显式关闭要生效')
  assert.equal(T.floatEnabled(null, true), false, '状态还没加载出来时不画浮标')
  assert.equal(T.floatEnabled({ settings: {} }, false), true, '没有侧栏服务时浮标兜底')
  assert.equal(T.floatEnabled({ settings: { floatFab: false } }, false), false, '没侧栏也可以显式关掉')
})

test('侧门监听归插件所有:apply 挂一个,dispose 必须摘掉', () => {
  const added = []
  const removed = []
  const prev = globalThis.window
  globalThis.window = {
    __ModuleLoader__: prev.__ModuleLoader__,
    addEventListener: (type, fn) => added.push([type, fn]),
    removeEventListener: (type, fn) => removed.push([type, fn]),
  }
  try {
    const service = { registerTab: () => () => {}, openTab: () => {} }
    const disposers = []
    const ctx = {
      slots: { inject: () => {}, register: () => () => {} },
      get: (n) => (n === 'betterSidebar' ? service : undefined),
      on: () => () => {},
      effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    }
    mod.apply(ctx)
    const openAdded = added.filter(([type]) => type === T.OPEN_EVENT)
    assert.equal(openAdded.length, 1, '侧门只挂一个监听,重复 apply 不能叠加')
    for (const dispose of disposers) dispose()
    const openRemoved = removed.filter(([type]) => type === T.OPEN_EVENT)
    assert.equal(openRemoved.length, 1, 'dispose 必须摘掉侧门监听')
    assert.equal(openRemoved[0][1], openAdded[0][1], '摘掉的必须是同一个函数')
  } finally {
    globalThis.window = prev
  }
})

test('提醒坞:最多 3 条,超出按页轮转,尾页不满也不空', () => {
  const mk = (i) => ({ id: 'a' + i, refId: 'r' + i, title: 'T' + i, dueAt: 1, over: i === 0, dueDate: '2026-11-16' })
  assert.equal(T.DOCK_MAX, 3, '一屏最多 3 条')
  // 空
  assert.deepEqual(T.dockSlice([], 0).shown, [])
  assert.equal(T.dockSlice([], 0).pages, 1)
  // 1 / 3 条:只有一页
  assert.equal(T.dockSlice([mk(0)], 0).pages, 1)
  assert.equal(T.dockSlice([mk(0), mk(1), mk(2)], 0).pages, 1)
  assert.equal(T.dockSlice([mk(0), mk(1), mk(2)], 0).shown.length, 3)
  // 5 条:2 页,第 2 页也要给满 3 格(取尾部 3 条)
  const five = [mk(0), mk(1), mk(2), mk(3), mk(4)]
  assert.equal(T.dockSlice(five, 0).pages, 2)
  assert.deepEqual(T.dockSlice(five, 0).shown.map((a) => a.id), ['a0', 'a1', 'a2'])
  assert.deepEqual(T.dockSlice(five, 1).shown.map((a) => a.id), ['a2', 'a3', 'a4'], '尾页填满 3 格')
  assert.equal(T.dockSlice(five, 1).rest, 2, '提示「还有 N 条」')
  // 越界页码夹回,不崩
  assert.equal(T.dockSlice(five, 99).page, 1)
  assert.equal(T.dockSlice(five, -3).page, 0)
  // 轮转间隔合理(不闪)
  assert.ok(T.DOCK_ROTATE_MS >= 4000 && T.DOCK_ROTATE_MS <= 12000)

  // 渲染:3 条就是 3 个卡片,5 条也只渲染 3 个
  const html3 = renderToString(h(T.AlertDock, { alerts: five.slice(0, 3), run, onOpen: () => {} }))
  assert.equal((html3.match(/__dk_alert/g) || []).length >= 3, true, '渲染 3 个卡片')
  const html5 = renderToString(h(T.AlertDock, { alerts: five, run, onOpen: () => {} }))
  const cardCount = html5.split('class="__dk_alert').length - 1
  assert.equal(cardCount, 3, '5 条也只渲染 3 个')
  assert.ok(html5.includes('__dk_dockmore'), '要提示还有几条')
  assert.ok(!html5.includes('undefined'), '不能泄漏 undefined')
  // 空列表不渲染任何东西
  assert.equal(renderToString(h(T.AlertDock, { alerts: [], run, onOpen: () => {} })), '')
})

test('日期格式化:侧栏头部用中文日期,脏输入不炸', () => {
  assert.equal(T.fmtDay('2026-11-16'), '11月16日 周一')
  assert.equal(T.fmtDay('2026-01-01'), '1月1日 周四')
  for (const bad of [null, undefined, '', 'x', '2026', '2026-13-40']) {
    assert.equal(typeof T.fmtDay(bad), 'string', '必须是字符串')
    assert.ok(!T.fmtDay(bad).includes('undefined'), '不能泄漏 undefined')
  }
})

test('提醒卡片:完成/稍后/知道了三个动作都在,稍后能选时长', () => {
  const a = { id: 'a1', refId: 'r1', title: '每日打卡', dueAt: Date.now(), over: true, dueDate: '2026-11-16' }
  const html = renderToString(h(T.AlertCard, { a, run, onOpen: () => {} }))
  assert.ok(html.includes('完成'), '缺完成按钮')
  assert.ok(html.includes('稍后'), '缺稍后按钮')
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('SNOOZE_CHOICES'), '缺稍后时长选项')
  assert.ok(src.includes("'30 分钟'") && src.includes("'1 小时'"), '稍后不该只有 10 分钟一种')
  assert.ok(html.includes('每日打卡'), '缺标题')
  assert.ok(html.includes('__dk_aicon'), '缺状态图标')
  assert.ok(html.includes('__dk_alert'), '缺卡片样式类')
  const calm = renderToString(h(T.AlertCard, { a: { ...a, over: false }, run, onOpen: () => {} }))
  assert.ok(calm.includes('__dk_alert--calm'), '未到点用另一档配色')
})

test('侧门事件优先把侧栏标签页叫到前面', () => {
  const opened = []
  const listeners = []
  const prevWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: prevWindow.__ModuleLoader__,
    addEventListener: (type, fn) => { if (type === T.OPEN_EVENT) listeners.push(fn) },
    removeEventListener: () => {},
  }
  try {
    const service = { registerTab: () => () => {}, openTab: (seed) => { opened.push(seed) } }
    const ctx = {
      slots: { inject: () => {}, register: () => () => {} },
      get: (n) => (n === 'betterSidebar' ? service : undefined),
      on: () => () => {},
      effect: (fn) => fn(),
    }
    mod.apply(ctx)
    for (const fn of listeners) fn()
    assert.equal(opened.length, 1, '顶栏图标/快捷键触发时应打开侧栏标签页')
    assert.equal(opened[0].type, 'desk-kit:main')
  } finally {
    globalThis.window = prevWindow
  }
})


// ---------------------------------------------------------------- 1.6.0 交互契约

test('一句话输入:输入法选词时按 Enter 不能提交', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('isComposing'), '缺 IME 选词判定(nativeEvent.isComposing)')
  assert.ok(src.includes('onCompositionStart') && src.includes('onCompositionEnd'), '缺 composition 事件')
  assert.ok(src.includes('keyCode === 229'), '缺老浏览器 229 兜底')
  const html = renderToString(h(T.CaptureBar, { run, onDone: () => {} }))
  assert.ok(html.includes('<textarea'), '仍是 textarea')
})

test('存完提示:分类、标题、摘要一眼可见', () => {
  const meta = T.captureToast({
    parsed: { kind: 'reminder' },
    item: { title: '喂猫粮', time: '16:00', leadMin: 0 },
    reply: '已排成提醒:喂猫粮 · 2026-11-19 16:00',
  })
  assert.equal(meta.label, '提醒')
  assert.equal(meta.title, '喂猫粮')
  assert.equal(meta.tone, 'reminder')
  assert.ok(meta.detail.includes('2026-11-19'), '摘要要保留时间')
  assert.ok(!meta.detail.includes('喂猫粮'), '标题不要重复抄进摘要')
  const html = renderToString(h(T.ReplyBar, {
    reply: { ...meta, text: meta.detail, life: 4200 }, run, onClear: () => {},
  }))
  assert.ok(html.includes('__dk_toast--reminder'), '要有分类色')
  assert.ok(html.includes('__dk_toastbadge') && html.includes('提醒'), '要显示栏位')
  assert.ok(html.includes('已保存') && html.includes('喂猫粮'), '要显示成功和事项')
  assert.ok(html.includes('__dk_toastlife'), '要有自动消失的进度条')

  const note = T.captureToast({ parsed: { kind: 'note' }, item: { text: '第一行\n第二行' }, reply: '已记成便签' })
  assert.equal(note.label, '便签')
  assert.equal(note.title, '第一行')
})

test('反馈条:有撤销动作才出「撤销」按钮', () => {
  const withUndo = renderToString(h(T.ReplyBar, {
    reply: { text: '已移入垃圾箱', undo: { action: 'note.restore', payload: { id: 'n1' } } }, run, onClear: () => {},
  }))
  assert.ok(withUndo.includes('已移入垃圾箱'))
  assert.ok(withUndo.includes('撤销'), '软删必须能一键撤回')
  assert.ok(withUndo.includes('__dk_replybtn'))

  const plain = renderToString(h(T.ReplyBar, { reply: { text: '已复制到剪贴板' }, run, onClear: () => {} }))
  assert.ok(plain.includes('已复制到剪贴板'))
  assert.ok(!plain.includes('撤销'), '单纯提示不该给撤销')

  assert.equal(renderToString(h(T.ReplyBar, { reply: null, run, onClear: () => {} })), '')
})

test('便签超出 8 条:给「显示更多」而不是让人自己去搜', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: 'n' + i, text: '便签' + i, tags: [], shelf: 'daily',
    completedAt: 0, deletedAt: 0, createdAt: 1, updatedAt: 100 - i,
  }))
  const html = renderToString(h(T.NotesPage, { state: { ...state, notes: many, noteCounts: { active: 20, long: 0, done: 0, trash: 0 } }, run }))
  assert.ok(html.includes('显示更多'),
    '要有分页入口')
  assert.ok(html.includes('还有 12 条'), '要报还剩多少条')
  assert.ok(!html.includes('便签19'), '第一屏仍然只放 8 条')
})

test('首页超过 4 条提醒:给「查看全部」出口', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: 'r' + i, title: '待办' + i, time: '21:00', weekdays: [], leadMin: 30,
    status: 'upcoming', done: false, active: true, occurrenceAt: Date.now() + i * 1e6,
  }))
  const noGo = renderToString(h(T.Home, { state: { ...state, reminders: many, notes: [] }, run, onLink: () => {} }))
  assert.ok(!noGo.includes('查看全部'), '没传 onGo 时不能渲染死按钮')
  const html = renderToString(h(T.Home, { state: { ...state, reminders: many, notes: [] }, run, onLink: () => {}, onGo: () => {} }))
  assert.ok(html.includes('查看全部 7 项'), '要能跳到提醒页看全量')
})

test('提醒坞轮播:鼠标停留时暂停,离开再继续', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('setPaused(true)') && src.includes('setPaused(false)'), '缺悬停暂停')
  assert.ok(src.includes('[pages, paused]'), '暂停要真的停掉轮播定时器')
  assert.ok(src.includes('onMouseEnter') && src.includes('onMouseLeave'), '悬停事件没挂上')
  assert.ok(src.includes('onFocusCapture'), '键盘聚焦时也要停')
})

test('保险库明文会自动收起', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('VAULT_HIDE_MS'), '缺自动收起时长常量')
  assert.ok(src.includes('30 秒后自动收起'), '要给用户一句说明')
})

test('表单按「什么时候 / 提前多久 / 链接」分块,提前量能点选', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('LEAD_PRESETS'), '缺常用提前量预设')
  assert.ok(src.includes('提前多久提醒'), '缺提前量分组')
  assert.ok(src.includes('打开链接'), '链接单独一块')
  assert.ok(src.includes('__dk_group'), '缺分组样式类')
})

test('提示音:现场合成,不打包音频文件,不支持的浏览器静默跳过', () => {
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('AudioContext'), '要用 Web Audio 合成')
  assert.ok(!/\.(mp3|wav|ogg|m4a)/i.test(src), '不该打包音频文件')
  assert.ok(typeof T.playChime === 'function', '缺 playChime')
  // node 里没有 AudioContext:必须返回 false 而不是抛错
  assert.equal(T.playChime(), false)
  assert.ok(Array.isArray(T.SOUND.notes) && T.SOUND.notes.length === 2, '两声')
  assert.ok(T.SOUND.decay > 0 && T.SOUND.attack < 0.05, '起音要短、衰减要够')
})

test('设置里能开关提示音并试听', () => {
  const html = renderToString(h(T.Settings, { state: { ...state, settings: {} }, run, sidebarReady: true }))
  assert.ok(html.includes('提示音'), '缺提示音开关')
  assert.ok(html.includes('试听'), '缺试听按钮')
  const off = renderToString(h(T.Settings, { state: { ...state, settings: { sound: false } }, run, sidebarReady: true }))
  assert.ok(/提示音[\s\S]{0,400}?__dk_switch(?! on)/.test(off), '关掉时开关要灭')
})

test('手动表单也能排「一次性 / 每月」,编辑时周期要回显正确', () => {
  const once = renderToString(h(T.ReminderForm, {
    initial: { id: 'r1', title: '交电费', time: '10:00', date: '2026-11-18', weekdays: [] },
    onSave: () => {}, onCancel: () => {}, title: '编辑',
  }))
  assert.ok(once.includes('type="date"'), '一次性要有日期选择')
  assert.ok(once.includes('只提醒一次'), '周期说明要对')
  assert.ok(/__dk_chip on">一次性/.test(once), '应选中「一次性」而不是「每天」')
  assert.ok(/__dk_chip on">准时/.test(once), '新提醒默认准时,不再提前 30 分')

  const monthly = renderToString(h(T.ReminderForm, {
    initial: { id: 'r2', title: '交房租', time: '09:00', monthly: 1, weekdays: [] },
    onSave: () => {}, onCancel: () => {}, title: '编辑',
  }))
  assert.ok(/__dk_chip on">每月/.test(monthly), '应选中「每月」')
  assert.ok(monthly.includes('月末') || monthly.includes('最后一天'), '要说清小月怎么算')

  assert.ok(T.CYCLE.some(([k]) => k === 'once') && T.CYCLE.some(([k]) => k === 'monthly'), 'CYCLE 要含一次性/每月')
  assert.equal(T.todayISO(new Date(2026, 10, 18)), '2026-11-18', 'todayISO 用本地日期,别用 UTC')
})

test('开机补提醒:卡片写「错过的提醒」而不是普通的到点了', () => {
  const late = { id: 'a2', refId: 'r2', title: '吃药', dueAt: new Date('2026-11-18T08:00:00').getTime(), over: true, late: true, dueDate: '2026-11-18' }
  const html = renderToString(h(T.AlertCard, { a: late, run, onOpen: () => {} }))
  assert.ok(html.includes('错过的提醒'), '要说明这条是关着 DSH 时错过的')
  assert.equal(T.alertHead(late), '错过的提醒 · ')
  assert.equal(T.alertHead({ over: true }), '到点了 · ')
  assert.equal(T.alertHead({ over: false }), '快到点了 · ')
})

test('网页页:格子 + 分类 + 空分类提示', () => {
  const links = [
    { id: 'w1', title: '文档中心', url: 'https://docs.example.com', group: '工作', icon: '', pinned: true },
    { id: 'w2', title: 'Figma', url: 'https://www.figma.com/files', group: '设计', icon: '' },
    { id: 'w3', title: '新闻', url: 'https://news.example.com', group: '' },
  ]
  const st = {
    ...state, links,
    linkGroups: { groups: [{ name: '工作', count: 1 }, { name: '设计', count: 1 }], ungrouped: 1 },
    linkCounts: { active: 3, trash: 1 },
    trashedLinks: [{ id: 'w9', title: '旧站', url: 'https://old.example.com', group: '', deletedAt: 1 }],
  }
  const html = renderToString(h(T.LinksPage, { state: st, run, notify: () => {} }))
  assert.ok(html.includes('__dk_grid'), '要用格子排,不是列表')
  assert.ok(html.includes('文档中心') && html.includes('Figma'), '标题要在')
  for (const g of ['全部 3', '工作 1', '设计 1', '未分类 1']) assert.ok(html.includes(g), '缺分类 chip:' + g)
  assert.ok(html.includes('垃圾箱 (1)'))
  // 首字 + 底色:hue 由域名算,同一个站点永远一样
  assert.equal(T.linkInitial({ title: 'GitHub', url: 'https://github.com' }), 'G')
  assert.equal(T.linkInitial({ title: '设计稿', url: 'x' }), '设')
  assert.equal(T.linkHue('https://a.example.com'), T.linkHue('https://a.example.com/x?y=1'))
  assert.notEqual(T.linkHue('https://a.example.com'), T.linkHue('https://b.example.com'))
  // 空分类要说话
  const empty = renderToString(h(T.LinksPage, { state: { ...st, links: [] }, run, notify: () => {} }))
  assert.ok(empty.includes('还没有收藏网页'))
})

test('首页有「常去」:直接点常用网页,不用先进网页页', () => {
  const st = { ...state, links: [{ id: 'w1', title: '文档中心', url: 'https://docs.example.com', group: '' }] }
  const html = renderToString(h(T.Home, { state: st, run, notify: () => {}, onLink: () => {}, onGo: () => {} }))
  assert.ok(html.includes('常去'), '缺常去分区')
  assert.ok(html.includes('文档中心'))
  const none = renderToString(h(T.Home, { state: { ...state, links: [] }, run, notify: () => {}, onLink: () => {}, onGo: () => {} }))
  assert.ok(!none.includes('常去'), '没有网页就别占位')
})

test('转存:回执下能改分类,网页格子显示备注', () => {
  // 回执 + 「分错了?转存到」
  const reply = { text: '已收进网页:Example', move: { kind: 'link', id: 'w1' } }
  const html = renderToString(h(T.ReplyMove, { reply, run, onSay: () => {} }))
  for (const label of ['便签', '保险库', '提醒']) assert.ok(html.includes(label), '缺目标分类 ' + label)
  assert.ok(html.includes('分错了'), '要有一句人话')
  assert.equal(renderToString(h(T.ReplyMove, { reply: { text: 'x' }, run })), '', '没有可挪的条目就别显示')

  // 网页格子:名字下面一行备注
  const tile = renderToString(h(T.LinkTile, {
    l: { id: 'w1', title: 'Example', url: 'https://example.com', note: '用来查资料', group: '', icon: '', pinned: false },
    run, notify: () => {}, favicons: false, onEdit: () => {},
  }))
  assert.ok(tile.includes('__dk_appnote') && tile.includes('用来查资料'), '备注要显示在名字下面')

  // 每个分类能转去的目标是对称的,别把「保险库 → 保险库」列出来
  for (const [from, targets] of Object.entries(T.MOVE_TARGETS)) {
    assert.ok(targets.length >= 2, from + ' 至少两个去处')
    assert.ok(!targets.some(([to]) => to === from), from + ' 不该转给自己')
  }
})

test('附件:格子/大图/剪贴板识别', () => {
  const png = { id: 'f1', name: '截图 1.png', mime: 'image/png', size: 2048, w: 800, h: 600 }
  const pdf = { id: 'f2', name: '合同.pdf', mime: 'application/pdf', size: 200000, w: 0, h: 0 }

  assert.equal(T.isImage(png), true)
  assert.equal(T.isImage(pdf), false)
  assert.equal(T.isImage({ mime: 'image/svg+xml' }), false, 'SVG 不当图片内联(它是可执行文档)')
  assert.equal(T.fmtSize(2048), '2KB')
  assert.equal(T.fmtSize(200000), '195KB')
  assert.equal(T.fmtSize(3 * 1048576), '3.0MB')
  assert.equal(T.extOf('合同.pdf'), 'PDF')
  assert.equal(T.extOf('没有扩展名'), 'FILE')
  assert.match(T.shotName({ type: 'image/png' }), /^截图 \d{8}-\d{6}\.png$/)

  const chip = renderToString(h(T.FileChip, { file: png }))
  assert.ok(chip.includes('/desk-kit-api/files/f1'), '图片要用取件地址当 src')
  assert.ok(chip.includes('alt="截图 1.png"'))

  const doc = renderToString(h(T.FileChip, { file: pdf }))
  assert.ok(doc.includes('PDF'), '非图片要显示扩展名')
  assert.ok(!doc.includes('undefined'), '别把 undefined 渲染出来')

  const grid = renderToString(h(T.FileGrid, { files: [png, pdf] }))
  assert.ok(grid.includes('__dk_fgrid'))
  assert.equal(renderToString(h(T.FileGrid, { files: [] })), '', '没附件就什么都不渲染')
  assert.ok(renderToString(h(T.FileChip, { file: png, onRemove: () => {} })).includes('__dk_fdel'), '可删时要有小叉')

  const light = renderToString(h(T.Lightbox, { file: png, onClose: () => {} }))
  assert.ok(light.includes('__dk_lightimg') && light.includes('800×600'), '要看得到尺寸')
  assert.ok(light.includes('下载'), '要有下载')
  assert.equal(renderToString(h(T.Lightbox, { file: null, onClose: () => {} })), '', '没图就别占屏')

  // 剪贴板/拖拽:只挑 file 类,文本照旧走原来的路
  const img = { kind: 'file', getAsFile: () => ({ name: 'a.png' }) }
  const txt = { kind: 'string', getAsFile: () => null }
  const picked = T.filesFromDataTransfer({ items: [txt, img] })
  assert.equal(picked.length, 1)
  assert.equal(T.filesFromDataTransfer({ files: [{ name: 'b.pdf' }] }).length, 1, '没有 items 时退回 files')
  assert.equal(T.filesFromDataTransfer(null).length, 0)
})

test('便签页:有附件的便签渲染缩略图,纯图片不再占一行假正文', () => {
  const state = {
    now: Date.now(),
    notes: [
      { id: 'n1', text: '看这三张', tags: [], shelf: 'daily', files: ['f1', 'f2'], createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n2', text: '', tags: [], shelf: 'daily', files: ['f1'], createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n3', text: '', tags: [], shelf: 'daily', createdAt: Date.now(), updatedAt: Date.now() },
    ],
    files: [
      { id: 'f1', name: 'a.png', mime: 'image/png', size: 1024, w: 10, h: 10, kind: 'note', ownerId: 'n1' },
      { id: 'f2', name: 'b.pdf', mime: 'application/pdf', size: 2048, w: 0, h: 0, kind: 'note', ownerId: 'n1' },
    ],
    noteCounts: { active: 3, long: 0, done: 0, trash: 0, archived: 0 },
    reminders: [], secrets: [], links: [], settings: {},
  }
  const html = renderToString(h(T.NotesPage, { state, run: async () => null }))
  assert.ok(html.includes('__dk_fgrid'), '要渲染附件格子')
  assert.ok(html.includes('2 个附件'), '要标出附件数量')
  assert.ok(html.includes('files/f1'), '图片要有取件地址')
  assert.ok(html.includes('b.pdf') && html.includes('PDF'), '非图片显示扩展名和名字(不内联)')
  assert.ok(!html.includes('（图片）'), '纯图片便签不再显示假正文占位')
  const src = readFileSync(join(HERE, 'client.js'), 'utf8')
  assert.ok(src.includes('__dk_editsection') && src.includes('removeEditFile'), '编辑时图片要以单位显示并可移除')
  assert.ok(src.includes('__dk_editacts'), '编辑保存/取消要在卡片内成行')
})

test('清理卡片:用量/到期表/保留天数都能渲染', () => {
  assert.equal(T.daysText(0), '下次清理就清掉')
  assert.equal(T.daysText(1), '还有 1 天')
  assert.equal(T.daysText(7), '还有 7 天')
  assert.equal(T.daysText(null), '不会自动清')

  const state = {
    trash: [
      { kind: 'note', id: 'n1', title: '三天前删的便签', daysLeft: 4, dueAt: Date.now() + 4 * 86400000 },
      { kind: 'link', id: 'w1', title: 'example.com', daysLeft: 0, dueAt: Date.now() - 1000 },
    ],
    trashKeepDays: 7, lastSweepAt: Date.now() - 3600000,
    notes: [], files: [], reminders: [], links: [], secrets: [], settings: {},
  }
  const html = renderToString(h(T.CleanupCard, { state, run: async () => null }))
  assert.ok(html.includes('存储与清理'), '要有标题')
  assert.ok(html.includes('2 条待清'), '要说清垃圾箱有几条')
  assert.ok(html.includes('三天前删的便签'), '要逐条列出来')
  assert.ok(html.includes('还有 4 天') && html.includes('下次清理就清掉'), '每条的到期日要分开算')
  assert.ok(html.includes('现在清理') && html.includes('刷新用量'), '要能手动清')
  for (const d of ['7 天', '30 天', '90 天', '不清']) assert.ok(html.includes(d), '保留天数缺 ' + d)
  assert.ok(html.includes('保险库不参与'), '要写明保险库不参与自动清理')
})

test('便签页搜索:附件按文件名命中,能点开看', () => {
  const state = {
    now: Date.now(),
    notes: [], reminders: [], secrets: [], links: [],
    files: [{ id: 'f9', name: '登录页截图.png', mime: 'image/png', size: 1024, w: 10, h: 10, kind: 'note', ownerId: 'n1' }],
    noteCounts: { active: 0, long: 0, done: 0, trash: 0, archived: 0 },
    trash: [], settings: {},
  }
  const html = renderToString(h(T.NotesPage, { state, run: async () => null }))
  // 没有关键词时不该出现「附件里命中」
  assert.ok(!html.includes('附件里命中'), '没搜索就别显示命中分组')
})

test('设置页:还原备份的入口在,措辞说清两种模式', () => {
  const html = renderToString(h(T.ImportRow, { run: async () => null }))
  assert.ok(html.includes('从 JSON 还原'), '要有还原入口')
  assert.ok(html.includes('合并') && html.includes('替换'), '要说明两种模式')
  assert.ok(html.includes('先自动备份'), '替换会备份,得写出来')
})
