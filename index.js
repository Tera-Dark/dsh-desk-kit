/**
 * dsh-desk-kit · 宿主半侧
 *
 * 三件事:
 *   1. 便签      —— 随手记,落 $DSH_HOME/desk-kit/data.json
 *   2. 提醒      —— 到点前提醒(打卡/待办类),完成后当天静默;由本插件自己的定时器驱动
 *   3. 保险库    —— 账号/密钥长期保存,AES-256-GCM 加密落盘(主密钥在本机 vault.key,0600)
 *
 * 对外:27 个 Agent 工具 + 一条同源 HTTP API(/desk-kit-api),浏览器半侧轮询它。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DeskStore, localYmd } from './store.js'
import { localDefineTool } from './tool.js'
import { parseCapture, describeCapture, parseLeadMin, cleanTitle } from './capture.js'

/** 版本号只从 package.json 读:不在代码里再写一份,发版时不会三处对不齐。 */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || '0.0.0'
  } catch { return '0.0.0' }
})()

/** 把已解析的结果落盘(本地规则与 AI 分类共用这一段)。 */
function persistParsed(s, parsed, rawText) {
  // 多站点批量:一句「这些站每天打卡」→ N 条每日提醒
  if (parsed.kind === 'multi') {
    const created = []
    const skipped = []
    const have = new Set((s.data.reminders || []).map((r) => String(r.url || '').replace(/\/+$/, '')))
    for (const site of parsed.sites) {
      const key = String(site.url).replace(/\/+$/, '')
      if (have.has(key)) { skipped.push(site.title); continue }
      created.push(s.addReminder({
        title: site.title,
        time: '21:00',
        weekdays: [],
        leadMin: 0,
        url: site.url,
        note: '每天打卡',
      }))
      have.add(key)
    }
    const reply = '已整理成 ' + created.length + ' 条每日打卡提醒(21:00 到点提醒)'
      + (skipped.length ? ';跳过已存在的 ' + skipped.length + ' 条' : '')
      + (created.length ? ':' + created.map((r2) => r2.title.replace(' 打卡', '')).join('、') : '')
    return { parsed, reply, item: created, created: { kind: 'reminder', ids: created.map((r2) => r2.id) } }
  }
  if (parsed.kind === 'link') {
    // 一句话里的用途说明要一起存进备注(以前只存了标题和网址)
    const item = s.addLink({ title: parsed.title, url: parsed.url, group: parsed.group, note: parsed.note || '' })
    return {
      parsed,
      reply: item.deduped ? '这个网址已经收过了,已把它顶到前面:' + item.title : describeCapture(parsed),
      item,
      created: { kind: 'link', id: item.id, deduped: !!item.deduped },
    }
  }
  if (parsed.kind === 'secret') {
    const item = s.addSecret({ title: parsed.title, username: parsed.username, password: parsed.password, url: parsed.url, note: parsed.note })
    return { parsed, reply: describeCapture(parsed), item, created: { kind: 'secret', id: item.id } }
  }
  if (parsed.kind === 'reminder') {
    const r = s.addReminder({
      title: parsed.title,
      time: parsed.time,
      weekdays: parsed.weekdays,
      date: parsed.date,
      lunar: parsed.lunar,
      annual: parsed.annual,
      yearly: parsed.yearly,
      monthly: parsed.monthly,
      leadMin: parsed.leadMin,
      url: parsed.url,
      note: parsed.note || '',
    })
    // 已经有了就明说,别让「说了两遍」变成「两条提醒」
    const base = r.deduped
      ? '这条提醒已经有了:' + String(describeCapture(parsed)).replace(/^已排成[^:]*:/, '')
      : describeCapture(parsed)
    // 一次性提醒给了个过去的日期:存下了但永远不会响,得当面说清楚
    const past = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && parsed.date < localYmd()
    const reply = past ? base + ' · 不过这天已经过去了,不会响;要改时间直接编辑它' : base
    return { parsed, reply, item: r, created: { kind: 'reminder', id: r.id, deduped: !!r.deduped } }
  }
  const note = s.addNote({ text: parsed.text || rawText })
  const reply = note.deduped
    ? '这条刚才就存过,已经帮你顶到最前面了'
    : parsed.missingTime
      ? '记成便签了;要提醒的话补个时间,比如「明天10点提醒我…」'
      : describeCapture(parsed)
  return { parsed, reply, item: note, created: { kind: 'note', id: note.id, deduped: !!note.deduped } }
}

/** 本地规则:一句话 → 解析结果 → 落盘。 */
function applyCapture(s, text) {
  return persistParsed(s, parseCapture(text), text)
}

/** 当前选定的「分类模型」;没配就是 null(走本地规则)。 */
function classifySelectionOf(s) {
  const st = (s && s.data && s.data.settings) || {}
  const provider = typeof st.classifyProvider === 'string' ? st.classifyProvider.trim() : ''
  const model = typeof st.classifyModel === 'string' ? st.classifyModel.trim() : ''
  return provider && model ? { provider, model } : null
}

/** 把模型吐的 JSON 归一成 capture.js 那套结构。 */
function normalizeAI(ai, raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const clock = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str(v))
    if (!m) return ''
    const h = Math.min(23, Number(m[1]))
    return String(h).padStart(2, '0') + ':' + m[2]
  }
  if (ai.kind === 'link') {
    const url = str(ai.url)
    const title = str(ai.title).slice(0, 80)
    if (!url) return { kind: 'note', text: str(ai.text) || raw }
    return { kind: 'link', title, url, group: str(ai.group).slice(0, 24), note: str(ai.note).slice(0, 300), raw }
  }
  if (ai.kind === 'secret') {
    // 模型有时把「一个网址 + 用途」判成 secret;没有凭据值就不该进保险库
    if (!str(ai.password) && !str(ai.username)) {
      const url = str(ai.url)
      return url
        ? { kind: 'link', title: str(ai.title).slice(0, 80), url, group: '', note: str(ai.note).slice(0, 300) || raw, raw }
        : { kind: 'note', text: str(ai.text) || str(ai.note) || raw }
    }
    return {
      kind: 'secret',
      title: str(ai.title).slice(0, 80) || '未命名条目',
      username: str(ai.username),
      password: str(ai.password),
      url: str(ai.url),
      note: str(ai.note) || raw,
    }
  }
  if (ai.kind === 'reminder') {
    const local = (() => { try { return parseCapture(raw) } catch { return null } })()
    const generic = /^(提醒|未命名提醒|便签|记录|备忘|待办|任务)$/
    const aiTitle = str(ai.title)
    const fallbackTitle = local && local.kind === 'reminder' && local.title && !generic.test(local.title)
      ? local.title
      : cleanTitle(raw)
    const title = aiTitle && !generic.test(aiTitle) ? aiTitle : (fallbackTitle || '未命名提醒')
    const aiNote = str(ai.note)
    const note = aiNote && aiNote !== title && !generic.test(aiNote) ? aiNote : ''
    const localTime = local && local.kind === 'reminder' ? local.time : ''
    const localWeekdays = local && local.kind === 'reminder' && Array.isArray(local.weekdays) ? local.weekdays : []
    const mapped = {
      kind: 'reminder',
      title: title.slice(0, 120),
      // AI 漏了时间就沿用本地解析;AI 给了时间以 AI 为准,但不替用户提前
      time: clock(ai.time) || localTime || '09:00',
      weekdays: Array.isArray(ai.weekdays) && ai.weekdays.length
        ? ai.weekdays.map(Number).filter((d) => d >= 0 && d <= 6)
        : localWeekdays,
      // 默认准时;只有原话明确「提前 X」才提前,模型自己填的 leadMin 不采信
      leadMin: parseLeadMin(raw),
      url: str(ai.url),
      note,
    }
    const aiDate = str(ai.date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(aiDate)) mapped.date = aiDate
    else if (local && local.kind === 'reminder' && local.date) mapped.date = local.date
    if (ai.lunar && Number.isFinite(Number(ai.lunar.month)) && Number.isFinite(Number(ai.lunar.day))) {
      mapped.lunar = { month: Number(ai.lunar.month), day: Number(ai.lunar.day) }
      mapped.yearly = true
    } else if (/^\d{2}-\d{2}$/.test(str(ai.annual))) {
      mapped.annual = str(ai.annual)
      mapped.yearly = true
    } else if (local && local.kind === 'reminder') {
      if (local.monthly) mapped.monthly = local.monthly
      if (local.annual) { mapped.annual = local.annual; mapped.yearly = true }
    }
    // 生日/纪念日仍默认提前 3 天;普通提醒才默认到点
    if (mapped.yearly) mapped.leadMin = parseLeadMin(raw) || 4320
    return mapped
  }
  return { kind: 'note', text: str(ai.text) || raw }
}

/**
 * 让选定的分类模型把一句话整理成 JSON。
 * 纯文字模型就够(不要求识图);任何异常都返回 null,由调用方回退本地规则。
 */
async function aiClassify(ctx, text, sel) {
  const llm = ctx.get('llm')
  if (!llm || typeof llm.stream !== 'function') return null
  const today = localYmd()
  const weekday = '日一二三四五六'[new Date().getDay()]
  const system = [
    '你是信息整理助手。把用户随口说的一句话整理成 JSON。只输出 JSON,不要解释,不要代码块。',
    'kind 必须四选一:',
    '- reminder:有明确时间点、或需要到点提醒(签到/打卡/上课/开会/交费/吃药/生日/纪念日)',
    '- secret:含真正的账号、密码、密钥、卡号等凭据值',
    '- link:用户想收藏/推荐一个网址,常配有「这个站不错」「可以用来干什么」之类的说明',
    '- note:其余(想法、清单、合集、长文、备忘)',
    '可用字段(没有就省略):kind, title, time("HH:MM" 24小时制), date("YYYY-MM-DD"), weekdays([0=周日..6=周六]), lunar({month,day}), annual("MM-DD"), leadMin(数字,分钟), url, group, text(note 的正文,尽量保留原话), username, password, note',
    '规则:生日/纪念日优先用 annual 或 lunar,不要用 date;一般提醒才用 time+date/weekdays。',
    '规则:提醒的 title 只写要做的事/事件本身,必须去掉「帮我记一下/提醒我/记得/别忘了」这类口语;不能只写「提醒」「便签」「记录」。',
    '规则:note 只放补充信息;没有就省略,不要把 title 或「提醒」再抄一遍。',
    '规则:leadMin 默认 0(到点提醒);只有用户明确说「提前 X 分钟/小时」才填 X,不要自行提前。',
    '规则:用户给了钟点就用该时间,不要自行加减。',
    '规则:只提到网址、没有账号密码值的,不要用 secret —— 那是 link(用途说明写进 note);',
    '规则:link 的 title 用站点名或用户起的名字,别把整句说明塞进标题。',
    '今天是 ' + today + '(星期' + weekday + ')。',
  ].join('\n')

  let out = ''
  try {
    const iter = llm.stream({
      provider: sel.provider,
      model: sel.model,
      system,
      maxTokens: 600,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      signal: AbortSignal.timeout(25000),
    })
    for await (const chunk of iter) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      else if (chunk.type === 'text' && typeof chunk.text === 'string') out += chunk.text
    }
  } catch (e) {
    return null
  }
  const m = /\{[\s\S]*\}/.exec(out)
  if (!m) return null
  let parsed
  try { parsed = JSON.parse(m[0]) } catch { return null }
  if (!parsed || !['reminder', 'note', 'secret', 'link'].includes(parsed.kind)) return null
  return parsed
}

/** 一句话落盘:配了分类模型先问模型,失败/没配就走本地规则。 */
/**
 * 要不要为了这句话去问一次模型。
 * 本地规则已经能排出时间的、已经认出凭据的、多站点批量的,都不必再花一次调用;
 * 只有「本地只能当成便签、但看起来像待办或凭据」才值得问。
 */
const TODO_HINT = /提醒|叫我|记得|别忘|截止|deadline|到期|该交|要交|得交|之前|以前|前(?:把|得|要|交|给)|别迟到|签到|打卡/
const TIME_HINT = /\d\s*(点|号|日|月|小时|分钟|:|：)|[一二三四五六七八九十两半]{1,3}\s*(点|号|日|月|小时|分钟|钟头|周|星期|天)/
const SECRET_HINT = /密码|账号|密钥|token|恢复码|备用码/i

function shouldAskAI(local, text) {
  if (!local) return true
  // 本地已经能排出时间/认出凭据/拆成多条了,再问一遍模型只是多花钱多等几秒
  if (local.kind === 'multi' || local.kind === 'secret' || local.kind === 'reminder') return false
  if (local.kind === 'link') return false
  const t = String(text || '')
  if (local.missingTime) return true
  return TODO_HINT.test(t) || TIME_HINT.test(t) || SECRET_HINT.test(t)
}

async function applyCaptureSmart(ctx, s, text) {
  const sel = classifySelectionOf(s)
  const local = parseCapture(text)
  if (!sel || !shouldAskAI(local, text)) return persistParsed(s, local, text)
  if (sel) {
    const ai = await aiClassify(ctx, text, sel)
    if (ai) {
      try {
        const out2 = persistParsed(s, normalizeAI(ai, text), text)
        return { ...out2, viaAI: true, model: sel.provider + '/' + sel.model }
      } catch (e) { /* 落盘失败也回退 */ }
    }
  }
  return applyCapture(s, text)
}

/**
 * 优先用宿主的 defineTool;导入失败(以符号链接安装时这是必然的,见 tool.js 注释)
 * 就退回本地实现。forceLocal 便于两条路都测到。
 */
async function pickDefineTool() {
  if (process.env.DESK_KIT_FORCE_LOCAL_TOOLS !== '1') {
    try {
      const mod = await import('@deepseek-ai/dsh-tools')
      if (mod && typeof mod.defineTool === 'function') return { defineTool: mod.defineTool, source: 'host' }
    } catch { /* 落到本地实现 */ }
  }
  return { defineTool: localDefineTool, source: 'local' }
}

const picked = await pickDefineTool()
const defineTool = picked.defineTool

export const name = 'dsh-desk-kit'
export const inject = ['webServer']

const ROUTE = '/desk-kit-api'
/** 和 store.js 的 MAX_FILE_BYTES 对齐:上传时先在这里挡一道,免得读进内存才发现太大。 */
const MAX_FILE_BYTES = 24 * 1024 * 1024
/** 附件总量上限(单文件 24MB,总量 512MB)。超了就提示清理,不静默写满盘。 */
const MAX_BLOB_BYTES = 512 * 1024 * 1024
const TICK_MS = 15000

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function storeRoot() {
  return join(dshHome(), 'desk-kit')
}

/** 每次 apply 建一个新实例,由插件生命周期持有;不再做进程级单例。 */
function openStore() {
  return new DeskStore(storeRoot())
}

/** 浏览器半侧只能从本机回环访问,别把密码本暴露到局域网。 */
function isLoopback(req) {
  const addr = String((req.socket && req.socket.remoteAddress) || '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/** 回环地址的各种写法(localhost / 127.0.0.1 / [::1] / *.localhost)。 */
function isLoopbackName(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

/**
 * 只接受「本机页面自己发出来」的请求。
 *
 * 光看 socket 来源不够:任何网页都能往 127.0.0.1 发请求,虽然读不到响应(CORS),
 * 但写操作照样会执行 —— 把提醒改成静音、往便签里塞东西都做得到。
 *   · sec-fetch-site 是 cross-site/same-site → 别的站点发起的,拒
 *   · 带 Origin 且不是本机来源 → 拒
 *   · 写操作要求自定义头 x-desk-kit:跨源要带它就得先过预检,而我们不放行 CORS
 */
function guardRequest(req, method) {
  // Host 头必须是本机名字。攻击者可以把域名解析到 127.0.0.1(DNS rebinding),
  // 此时 socket 来源、Origin 都「看着像本机」—— 只有 Host 会暴露它的真名。
  const host = String(req.headers.host || '').toLowerCase()
  if (host) {
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    if (!isLoopbackName(name)) return '只接受本机地址访问(Host 不是 127.0.0.1/localhost)'
  }
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (site === 'cross-site' || site === 'same-site') return '只允许本机页面调用'
  const origin = String(req.headers.origin || '').trim()
  if (origin) {
    let host = ''
    try { host = new URL(origin).hostname } catch { return '来源不合法' }
    if (!isLoopbackName(host)) return '只允许本机页面调用'
  }
  if (String(method || '').toUpperCase() === 'POST' && String(req.headers['x-desk-kit'] || '') !== '1') {
    return '缺少请求标记 x-desk-kit(跨站页面伪造不了这个头)'
  }
  return ''
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * 快照的 ETag:GET 和 POST 共用同一个算法,否则写完之后客户端手里的
 * 还是旧 ETag,下一次轮询必然 200,把刚返回过的整份快照再传一遍。
 * 只哈希 state 本身(不含 result / 信封),两种响应才能得到同一个值。
 * 传对象或已序列化的 JSON 字符串都行:GET 是高频路径,传字符串可少序列化一次。
 * now 只是「服务端当前时间」,客户端自己用 Date.now();不排除的话每次都是新哈希。
 */
function etagOf(state) {
  const json = typeof state === 'string' ? state : JSON.stringify(state)
  const stable = json.replace(/"now":\d+/, '"now":0')
  return '"' + createHash('sha1').update(stable).digest('hex').slice(0, 20) + '"'
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0
    let tooBig = false
    const chunks = []
    // 以前超限直接 req.destroy():浏览器只看到 ECONNRESET,拿不到一句人话。
    // 现在超限后停止缓存、继续把流读完,结束时回一句 413。
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) { tooBig = true; chunks.length = 0; return }
      if (!tooBig) chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) {
        const error = new Error('请求体过大(上限 ' + Math.round(maxBytes / 1024) + 'KB)')
        error.code = 'E_TOO_BIG'
        reject(error)
        return
      }
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 从一个本机路径收进附件库。工具用,跳过读不到/不是文件/超限的,不让一个坏路径毁掉整次调用。 */
function importOne(s, path, name) {
  const abs = String(path || '').trim()
  if (!abs) throw new Error('要给一个文件路径')
  let st
  try { st = statSync(abs) } catch { throw new Error('读不到这个文件:' + abs) }
  if (!st.isFile()) throw new Error('这不是文件:' + abs)
  const buf = readFileSync(abs)
  const base = abs.split(/[\\/]/).pop() || 'file'
  return s.addFile({ buffer: buf, name: String(name || base), mime: guessMime(base) })
}

/** 工具里一次可以带多个路径;坏的跳过,好的照存。 */
function importPaths(s, list) {
  if (!Array.isArray(list)) return []
  const ids = []
  for (const path of list.slice(0, 8)) {
    try { ids.push(importOne(s, path).id) } catch { /* 这个路径不行,下一个 */ }
  }
  return ids
}

/** 按扩展名猜类型。只为让浏览器知道怎么展示,猜错也不影响保存。 */
function guessMime(name) {
  const ext = String(name || '').toLowerCase().split('.').pop()
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', zip: 'application/zip',
    mp4: 'video/mp4', mp3: 'audio/mpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return map[ext] || 'application/octet-stream'
}

/** 读原始字节(附件上传用)。和 readBody 同样的处理:超限回 413,不直接掐连接。 */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0
    let tooBig = false
    const chunks = []
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) { tooBig = true; chunks.length = 0; return }
      if (!tooBig) chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) {
        const error = new Error('文件太大,上限 ' + Math.round(maxBytes / 1048576) + 'MB')
        error.code = 'E_TOO_BIG'
        reject(error)
        return
      }
      resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0))
    })
    req.on('error', reject)
  })
}

/** 下载/内联时用的头:图片可以直接 <img>,其余一律当附件下载(防 SVG/HTML 变同源脚本)。 */
function fileHeaders(rec) {
  const inline = /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(rec.mime || '')
  return {
    'content-type': inline ? rec.mime : 'application/octet-stream',
    'content-length': String(rec.size),
    'content-disposition': (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(rec.name || rec.id),
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
  }
}

/**
 * 冷启动时 ctx.tools 可能还没 ACTIVE:同步 register 不抛错但不进表。
 * 照 dsh-meme 的兜底做法,先 ctx.inject(['tools']) 等依赖就绪。
 */
function registerToolWhenReady(ctx, label, register, owns, isDisposed) {
  const report = (error) => {
    const text = '[desk-kit] ' + label + ' 注册失败: ' + String((error && error.message) || error)
    try { console.error(text) } catch { }
    try { if (ctx.logger && ctx.logger.error) ctx.logger.error(text) } catch { }
  }
  const safe = () => {
    // ctx.inject 的回调可能晚于 dispose 才到:这时再注册就会留下无人持有的工具
    if (typeof isDisposed === 'function' && isDisposed()) return false
    try {
      // 注册返回的 disposer 交给调用方统一回收:不用「报错文案里有 duplicate 就算成功」这种判法
      const dispose = register()
      if (typeof dispose === 'function') owns.push(dispose)
      return true
    } catch (error) {
      report(error)
      return false
    }
  }
  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['tools'], () => { safe() }); return } catch (error) { report(error) }
  }
  safe()
}

const out = (text, data) => ({ text, data })
const outputSpec = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: String((value && value.text) || '') }],
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 一条提醒「什么时候响」的人话版本。
 * 之前工具里一律用 weekText(weekdays):一次性、每月、每年的提醒全被说成「每天」,
 * Agent 转述给用户就是错的。
 */
function whenText(r) {
  if (r.lunar && Number.isFinite(r.lunar.month)) return '农历每年 ' + r.lunar.month + '月' + r.lunar.day + '日 ' + r.time
  if (r.annual) return '公历每年 ' + r.annual + ' ' + r.time
  if (Number.isFinite(r.monthly)) return '每月 ' + r.monthly + ' 号 ' + r.time
  if (r.date) return r.date + ' ' + r.time
  return weekText(r.weekdays) + ' ' + r.time
}

function weekText(days) {
  if (!Array.isArray(days) || !days.length) return '每天'
  return '周' + days.slice().sort().map((d) => WEEK_LABEL[d] || '?').join('、周')
}

function statusLabel(r) {
  switch (r.status) {
    case 'done': return '今天已完成'
    case 'pending': return '到点了,还没处理'
    case 'upcoming': return '还没到时间'
    case 'paused': return '已暂停'
    case 'expired': return '已过期(一次性提醒)'
    case 'not-today': return '今天不用做'
    case 'no-next': return '暂时排不出下一次(检查一下日期)'
    default: return r.status
  }
}

function findReminder(s, idOrTitle) {
  const q = String(idOrTitle || '').trim()
  return s.data.reminders.find((r) => r.id === q) || s.data.reminders.find((r) => r.title.includes(q))
}

/**
 * 设置字段声明表:类型、范围、截断都在这里写一次。
 * 以前是 11 个手写 if,新增字段忘加白名单就会出现「拨完开关又弹回去」。
 * 未知字段和不合法类型直接忽略,不落任意键值。
 */
const SETTINGS_SPEC = {
  muted: { type: 'boolean' },
  sound: { type: 'boolean' },
  linkFavicons: { type: 'boolean' },
  floatFab: { type: 'boolean' },
  recognizeProvider: { type: 'string', max: 200 },
  recognizeModel: { type: 'string', max: 200 },
  classifyProvider: { type: 'string', max: 200 },
  classifyModel: { type: 'string', max: 200 },
  trashKeepDays: { type: 'int', min: 0, max: 3650, round: true },
}

function applySettings(s, payload) {
  let changed = false
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    if (!Object.hasOwn(payload, key)) continue
    const value = payload[key]
    let next
    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') continue
      next = value
    } else if (spec.type === 'string') {
      if (typeof value !== 'string') continue
      next = value.slice(0, spec.max)
    } else if (spec.type === 'int') {
      if (!Number.isFinite(value)) continue
      next = Math.max(spec.min, Math.min(spec.max, spec.round ? Math.round(value) : value))
    } else continue
    if (s.data.settings[key] !== next) {
      s.data.settings[key] = next
      changed = true
    }
  }
  return changed
}

/** keepDays 只接受有限的数字;越界夹到 0~3650,脏输入不改变语义。 */
function clampKeepDays(value) {
  const raw = Number(value)
  return Number.isFinite(raw) ? Math.max(0, Math.min(3650, Math.round(raw))) : undefined
}

/** 工具和 HTTP 共用同一条清理路径:只清一次,不偷偷改用户的全局保留天数。 */
function cleanupNow(s, keepDays) {
  const done = s.sweepTrash({ keepDays: clampKeepDays(keepDays) })
  return { ...done, human: DeskStore.humanBytes(done.bytes) }
}

/** 动作分发:ctx 与 store 都由调用方显式传入,不依赖模块级状态。 */
async function act(ctx, s, action, payload) {
  switch (action) {
    case 'capture': return await applyCaptureSmart(ctx, s, payload.text)
    case 'note.add': return s.addNote(payload)
    // 附件:上传走 POST /desk-kit-api/files(字节流),这里只做「删」和「重新挂」
    case 'file.delete': return { deleted: s.dropFiles([String(payload.id || '')]) }
    // 用量明细(只在打开设置/点刷新时算,轮询不碰磁盘)
    case 'storage.get': return s.storage()
    case 'import.run': return s.importBackup(payload.backup || payload, { mode: payload.mode, confirm: payload.confirm === true })
    // 立刻清理一次:keepDays 只影响这一次;要改默认值请走 settings.update
    case 'cleanup.run': return cleanupNow(s, payload.keepDays)
    // 统一查找(面板里搜的是本地快照,这个给工具和「搜索兜底」用)
    case 'search.all': return s.searchAll(payload.query, { includeTrash: !!payload.includeTrash, deepVault: !!payload.deepVault })
    case 'file.attach': return s.attachFiles(String(payload.kind || 'note'), String(payload.ownerId || ''), payload.ids || [])
    case 'note.update': return s.updateNote(payload.id, payload)
    case 'note.delete': return s.deleteNote(payload.id)      // 软删:进垃圾箱
    case 'note.restore': return s.restoreNote(payload.id)    // 从垃圾箱恢复
    case 'note.purge': return s.purgeNote(payload.id)        // 彻底删除
    case 'note.complete': return s.completeNote(payload.id, payload.done !== false)
    case 'reminder.add': return s.addReminder(payload)
    case 'reminder.update': return s.updateReminder(payload.id, payload)
    case 'reminder.delete': return s.deleteReminder(payload.id)     // 软删:进垃圾箱
    case 'reminder.restore': return s.restoreReminder(payload.id)   // 从垃圾箱恢复
    case 'reminder.purge': return s.purgeReminder(payload.id)       // 彻底删除
    case 'reminder.checkin': {
      const r = findReminder(s, payload.id || payload.query)
      if (!r) throw new Error('找不到提醒')
      return s.checkin(r.id, payload.date)
    }
    case 'reminder.uncheckin': {
      const r = findReminder(s, payload.id || payload.query)
      if (!r) throw new Error('找不到提醒')
      return s.uncheckin(r.id, payload.date)
    }
    case 'reminder.snooze': {
      const r = findReminder(s, payload.id || payload.query)
      if (!r) throw new Error('找不到提醒')
      return s.snooze(r.id, payload.minutes)
    }
    case 'alert.ack': return s.ackAlert(payload.id)
    case 'alert.ackAll': return s.ackAll()
    case 'alert.unackAll': return s.unackAll()
    // 网页收藏:手机桌面那种格子,按分类放
    case 'link.add': return s.addLink(payload)
    case 'link.update': return s.updateLink(payload.id, payload)
    case 'link.delete': return s.deleteLink(payload.id)
    case 'link.restore': return s.restoreLink(payload.id)
    case 'link.purge': return s.purgeLink(payload.id)       // 彻底删除
    case 'link.touch': return s.touchLink(payload.id)       // 打开一次,记一笔
    // 分错了自己挪:便签 ⇄ 网页 ⇄ 保险库 ⇄ 提醒
    case 'item.convert': {
      const r = s.convertItem(payload.kind, payload.id, payload.to)
      const NAME = { note: '便签', link: '网页', secret: '保险库', reminder: '提醒' }
      const what = r.item.title || String(r.item.text || '').slice(0, 20).trim() || '这条'
      return { ...r, reply: '已转到' + NAME[payload.to] + ':' + what + (r.merged ? '(和已有的那条合并了)' : '') }
    }
    case 'secret.add': return s.addSecret(payload)
    case 'secret.update': return s.updateSecret(payload.query || payload.id, payload)
    case 'secret.reorder': return s.reorderSecrets(payload.collection || '', payload.ids || [])
    case 'secret.delete': return s.deleteSecret(payload.query || payload.id)
    case 'secret.get': {
      const found = s.getSecret(payload.query || payload.id)
      if (!found) throw new Error('找不到条目')
      return found
    }
    case 'settings.update': {
      // 只在真的有字段变化时写盘:空 patch(以前用来「顺手拉快照」)不再白写一次
      if (applySettings(s, payload)) s.save()
      return s.data.settings
    }
    default: throw new Error('未知 action: ' + action)
  }
}

export function apply(ctx) {
  let s
  try {
    s = openStore()
  } catch (error) {
    try { ctx.logger && ctx.logger.error && ctx.logger.error('[desk-kit] 存储初始化失败: ' + String(error && error.message)) } catch { }
    return
  }

  // 不再给新用户凭空塞一条提醒。
  // 以前会种一条 21:00 的「每日打卡」:装完当天晚上就为一件自己没安排的事弹提醒(还带声音),
  // 用户第一反应是「这什么?」。空面板 + 一句怎么开始,比一条假数据诚实。

  // ---- 定时器:每 15 秒算一次该不该弹提醒 ----
  ctx.effect(() => {
    const tick = () => {
      try { s.tick() } catch (error) {
        try { ctx.logger && ctx.logger.error && ctx.logger.error('[desk-kit] tick 失败: ' + String(error && error.message)) } catch { }
      }
    }
    // 立刻先算一次,并把「DSH 关着的时候已经到点」的那批标成 late —— 这就是开机补提醒
    try { s.tick(Date.now(), { catchUp: true }) } catch (error) {
      try { ctx.logger && ctx.logger.warn && ctx.logger.warn('[desk-kit] 启动补提醒失败: ' + String(error && error.message)) } catch { }
    }
    const timer = setInterval(tick, TICK_MS)
    if (timer.unref) timer.unref()
    return () => clearInterval(timer)
  }, 'desk-kit: reminder tick')

  // ---- Agent 工具:注册交回的 disposer 归本插件所有,dispose 时统一释放 ----
  const toolDisposers = []
  let toolsDisposed = false
  const reg = (label, make) => registerToolWhenReady(ctx, label, make, toolDisposers, () => toolsDisposed)
  ctx.effect(() => () => {
    toolsDisposed = true
    for (const dispose of toolDisposers.splice(0)) {
      try { dispose() } catch (error) {
        try { ctx.logger && ctx.logger.warn && ctx.logger.warn('[desk-kit] 工具卸载失败: ' + String((error && error.message) || error)) } catch { }
      }
    }
  }, 'desk-kit: release tools')
  reg('desk_capture', () => ctx.tools.register(defineTool({
    name: 'desk_capture',
    description: '用户随口说一句(没指明要便签/提醒/存密码)时用这个:自动判类并落盘——有时间→提醒,有账号密码→保险库,其余→便签。传用户原话即可,不要自己拆成多个工具。',
    parameters: { text: { type: 'string', description: '用户原话,一字不改' } },
    output: outputSpec,
    async execute(args) {
      const r = applyCapture(s, args.text)
      return out(r.reply, r)
    },
  })))

  reg('desk_note_add', () => ctx.tools.register(defineTool({
    name: 'desk_note_add',
    description: '把用户随口说的想法/待记事项存成便签(长期留在 dsh-desk-kit 里,不占对话上下文)。用户说「记一下」「帮我记着」「有个想法」时用。',
    parameters: {
      text: { type: 'string', description: '便签正文,保留用户原话要点' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选标签,如 ["灵感","购物"]' },
      pinned: { type: 'boolean', description: '是否置顶' },
      files: { type: 'array', items: { type: 'string' }, description: '可选:本机文件路径(截图/图片/PDF 等),会连同便签一起存进随手台' },
    },
    output: outputSpec,
    async execute(args) {
      const ids = importPaths(s, args.files)
      const note = s.addNote({ text: args.text, tags: args.tags, pinned: args.pinned, files: ids })
      const extra = ids.length ? '(' + ids.length + ' 个附件)' : ''
      return out('已记下便签「' + (note.text || '图片').slice(0, 40) + '」' + extra + ',id=' + note.id, { ...note, files: s.filesFor('note', note.id) })
    },
  })))

  reg('desk_search', () => ctx.tools.register(defineTool({
    name: 'desk_search',
    description: '在随手台里一次搜完:便签、提醒、网页、附件文件名、保险库标题,支持「脸书/Facebook」这类中英别名。用户说「我记过/存过那个…叫什么来着」时用。',
    parameters: {
      query: { type: 'string', description: '关键词' },
      includeTrash: { type: 'boolean', description: '是否连垃圾箱一起搜' },
      deepVault: { type: 'boolean', description: '保险库标题没命中时,是否再解密内容找一次(只在内存里比对,不回传字段值)' },
    },
    output: outputSpec,
    async execute(args) {
      const res = s.searchAll(args.query, { includeTrash: !!args.includeTrash, deepVault: !!args.deepVault })
      const NAMES = { note: '便签', reminder: '提醒', link: '网页', file: '附件', secret: '保险库' }
      const text = res.hits.length
        ? res.hits.map((x, i) => (i + 1) + '. [' + (NAMES[x.kind] || x.kind) + '] ' + x.title + '  (' + x.where + ', id=' + x.id + ')' + (x.trashed ? ' [在垃圾箱]' : '')).join('\n')
          + (res.total > res.hits.length ? '\n…还有 ' + (res.total - res.hits.length) + ' 条,缩小关键词' : '')
        : '没搜到「' + String(args.query || '') + '」。'
      return out(text, res)
    },
  })))

  reg('desk_cleanup', () => ctx.tools.register(defineTool({
    name: 'desk_cleanup',
    description: '清理随手台:清掉垃圾箱里过期的记录(连附件原件)、宿主已不存在的附件、以及临时附件。返回清了什么、释放多少。',
    parameters: {
      keepDays: { type: 'number', description: '垃圾箱保留天数(默认用设置里的,通常 30;0 = 不清垃圾箱)' },
      dryRun: { type: 'boolean', description: '只报会清多少,不动手' },
    },
    output: outputSpec,
    async execute(args) {
      if (args.dryRun) {
        const info = s.storage()
        const due = info.trashDueNow + info.counts.strayFiles + info.counts.orphanFiles
        return out(due
          ? '会清 ' + info.trashDueNow + ' 条到期记录、' + (info.counts.strayFiles + info.counts.orphanFiles) + ' 个孤儿/临时附件'
          : '现在没有到期的东西(垃圾箱里还有 ' + info.trash.length + ' 条,按保留 ' + info.trashKeepDays + ' 天算)'
          , info)
      }
      const done = cleanupNow(s, args.keepDays)
      const parts = []
      if (done.notes) parts.push(done.notes + ' 条便签')
      if (done.links) parts.push(done.links + ' 个网页')
      if (done.reminders) parts.push(done.reminders + ' 条提醒')
      if (done.files) parts.push(done.files + ' 个附件')
      return out(parts.length ? '清掉了 ' + parts.join('、') + ',释放 ' + done.human : '没有需要清的东西', done)
    },
  })))

  reg('desk_file_add', () => ctx.tools.register(defineTool({
    name: 'desk_file_add',
    description: '把本机上的一个文件(截图、图片、PDF、任意格式)存进随手台的附件库。用户说「把这张图存起来」「保存这个文件」时用。',
    parameters: {
      path: { type: 'string', description: '本机文件的绝对路径' },
      name: { type: 'string', description: '可选:显示名(默认用原文件名)' },
      noteId: { type: 'string', description: '可选:挂到某个便签 id 下' },
    },
    output: outputSpec,
    async execute(args) {
      const file = importOne(s, args.path, args.name)
      if (args.noteId) {
        const note = s.data.notes.find((n) => n.id === args.noteId)
        if (!note) throw new Error('找不到便签 ' + args.noteId)
        note.files = [...new Set([...(note.files || []), file.id])]
        note.updatedAt = Date.now()
        s.attachFiles('note', note.id, [file.id])
        s.save()
      }
      return out('已存为附件「' + file.name + '」(' + Math.round(file.size / 1024) + 'KB,id=' + file.id + ')', file)
    },
  })))

  reg('desk_file_list', () => ctx.tools.register(defineTool({
    name: 'desk_file_list',
    description: '列出随手台里的附件(名字、大小、类型、挂在哪条记录下)。',
    parameters: {
      query: { type: 'string', description: '可选关键词' },
      kind: { type: 'string', description: '可选:note / reminder / link / secret' },
    },
    output: outputSpec,
    async execute(args) {
      const files = s.listFiles({ query: args.query, kind: args.kind })
      const text = files.length
        ? files.slice(0, 100).map((f, i) => (i + 1) + '. ' + f.name + '  ' + Math.round(f.size / 1024) + 'KB  ' + (f.kind || '未归档') + '  id=' + f.id).join('\n')
        : '还没有附件。'
      return out(text, files)
    },
  })))

  reg('desk_note_list', () => ctx.tools.register(defineTool({
    name: 'desk_note_list',
    description: '列出便签(默认不含已归档),可按关键词过滤。用户问「我之前记过什么」时用。',
    parameters: {
      query: { type: 'string', description: '可选关键词' },
      includeArchived: { type: 'boolean', description: '是否连归档的一起列' },    },
    output: outputSpec,
    async execute(args) {
      const notes = s.listNotes({ query: args.query, includeArchived: !!args.includeArchived })
      const text = notes.length
        ? notes.map((n, i) => (i + 1) + '. ' + (n.pinned ? '[置顶] ' : '') + (n.text || '（只有附件）').replace(/\n/g, ' ') + ((n.files || []).length ? ' [' + n.files.length + ' 个附件]' : '') + '  (' + fmtTime(n.updatedAt) + ', id=' + n.id + ')').join('\n')
        : '还没有便签。'
      return out(text, notes)
    },
  })))

  reg('desk_note_update', () => ctx.tools.register(defineTool({
    name: 'desk_note_update',
    description: '修改便签内容/标签/置顶/归档状态。',
    parameters: {
      id: { type: 'string', description: '便签 id' },
      text: { type: 'string', description: '新正文(可选)' },
      tags: { type: 'array', items: { type: 'string' }, description: '新标签(可选)' },
      pinned: { type: 'boolean', description: '置顶开关(可选)' },
      archived: { type: 'boolean', description: '归档开关(可选)' },
    },
    output: outputSpec,
    async execute(args) {
      const note = s.updateNote(args.id, args)
      return out('已更新便签 ' + note.id, note)
    },
  })))

  reg('desk_note_delete', () => ctx.tools.register(defineTool({
    name: 'desk_note_delete',
    description: '把便签移入垃圾箱(可恢复,不是真删)。用户说「删掉这条」时用。',
    parameters: { id: { type: 'string', description: '便签 id' } },
    output: outputSpec,
    async execute(args) {
      const r = s.deleteNote(args.id)
      return out('已移入垃圾箱,可恢复。id=' + r.id, r)
    },
  })))

  reg('desk_note_restore', () => ctx.tools.register(defineTool({
    name: 'desk_note_restore',
    description: '把垃圾箱里的便签恢复回来。用户说「删错了」「恢复刚才那条」时用。',
    parameters: { id: { type: 'string', description: '便签 id' } },
    output: outputSpec,
    async execute(args) {
      const note = s.restoreNote(args.id)
      return out('已恢复便签「' + note.text.slice(0, 30) + '」', note)
    },
  })))

  reg('desk_note_purge', () => ctx.tools.register(defineTool({
    name: 'desk_note_purge',
    description: '从垃圾箱彻底删除一条便签(不可恢复)。只在用户明确要求「彻底删掉」时用。',
    parameters: { id: { type: 'string', description: '便签 id' } },
    output: outputSpec,
    async execute(args) {
      const r = s.purgeNote(args.id)
      return out('已彻底删除 id=' + r.id, r)
    },
  })))

  reg('desk_note_complete', () => ctx.tools.register(defineTool({
    name: 'desk_note_complete',
    description: '把便签标记为已完成(或取消完成)。用户说「这条弄完了」「做完了」时用。',
    parameters: {
      id: { type: 'string', description: '便签 id' },
      done: { type: 'boolean', description: 'true=完成,false=取消完成(默认 true)' },
    },
    output: outputSpec,
    async execute(args) {
      const note = s.completeNote(args.id, args.done !== false)
      return out((note.completedAt ? '已标记完成' : '已取消完成') + ':「' + note.text.slice(0, 30) + '」', note)
    },
  })))

  reg('desk_reminder_add', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_add',
    description: '加一条定时提醒。到「时间」前 leadMin 分钟开始提醒;当天标记完成后就不再提醒。支持每天/每周/每月(monthly)/公历每年(annual)/农历每年(lunarMonth+lunarDay)。',
    parameters: {
      title: { type: 'string', description: '提醒标题,如「交电费」「吃药」' },
      time: { type: 'string', description: '截止时间,HH:MM,如 21:00' },
      weekdays: { type: 'array', items: { type: 'number' }, description: '周几重复,0=周日…6=周六;空数组=每天' },
      date: { type: 'string', description: '一次性提醒的日期 YYYY-MM-DD(可选)' },
      annual: { type: 'string', description: '公历每年重复的生日 MM-DD(可选)' },
      lunarMonth: { type: 'number', description: '农历生日的月(1-12)' },
      lunarDay: { type: 'number', description: '农历生日的日(1-30)' },
      leadMin: { type: 'number', description: '提前多少分钟提醒,默认 30(生日建议 4320=3天)' },
      url: { type: 'string', description: '办事的跳转网址(可选)' },
      note: { type: 'string', description: '备注(可选)' },
    },
    output: outputSpec,
    async execute(args) {
      const payload = { ...args }
      if (Number.isFinite(args.lunarMonth) && Number.isFinite(args.lunarDay)) {
        payload.lunar = { month: args.lunarMonth, day: args.lunarDay }
        payload.yearly = true
      }
      const r = s.addReminder(payload)
      return out('已加提醒「' + r.title + '」: ' + whenText(r) + ' 前 ' + r.leadMin + ' 分钟提醒。id=' + r.id, r)
    },
  })))

  reg('desk_reminder_list', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_list',
    description: '列出所有提醒及今日状态(已签/待签/未到时间)。',
    parameters: {},
    output: outputSpec,
    async execute() {
      const items = s.todayView()
      const text = items.length
        ? items.map((r) => '- ' + r.title + ' | ' + whenText(r) + ' | ' + statusLabel(r) + ' | id=' + r.id).join('\n')
        : '还没有提醒。'
      return out(text, items)
    },
  })))

  reg('desk_reminder_checkin', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_checkin',
    description: '标记某条提醒今天已完成(签到)。',
    parameters: {
      query: { type: 'string', description: '提醒 id 或标题片段' },
      date: { type: 'string', description: '补签日期 YYYY-MM-DD(可选,默认今天)' },
    },
    output: outputSpec,
    async execute(args) {
      const r = findReminder(s, args.query)
      if (!r) throw new Error('找不到提醒: ' + args.query)
      const res = s.checkin(r.id, args.date)
      return out('已记录「' + r.title + '」' + res.date + ' 完成。', res)
    },
  })))

  reg('desk_reminder_delete', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_delete',
    description: '把提醒移入垃圾箱(可恢复,不是真删)。用户说「删掉这条提醒」时用。',
    parameters: { query: { type: 'string', description: '提醒 id 或标题片段' } },
    output: outputSpec,
    async execute(args) {
      const r = findReminder(s, args.query)
      if (!r) throw new Error('找不到提醒: ' + args.query)
      const res = s.deleteReminder(r.id)
      return out('已把提醒「' + r.title + '」移入垃圾箱,可恢复。', res)
    },
  })))

  reg('desk_reminder_restore', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_restore',
    description: '把垃圾箱里的提醒恢复回来。用户说「提醒删错了」「恢复那个签到」时用。',
    parameters: { query: { type: 'string', description: '提醒 id 或标题片段(含已删的)' } },
    output: outputSpec,
    async execute(args) {
      const s2 = s
      const q = String(args.query || '').trim()
      const r = s2.data.reminders.find((x) => x.id === q)
        || s2.data.reminders.find((x) => (x.deletedAt || 0) > 0 && String(x.title).includes(q))
      if (!r) throw new Error('找不到提醒: ' + args.query)
      const back = s2.restoreReminder(r.id)
      return out('已恢复提醒「' + back.title + '」。', back)
    },
  })))

  reg('desk_reminder_purge', () => ctx.tools.register(defineTool({
    name: 'desk_reminder_purge',
    description: '从垃圾箱彻底删除一条提醒(不可恢复)。只在用户明确要求「彻底删掉」时用。',
    parameters: { query: { type: 'string', description: '提醒 id 或标题片段' } },
    output: outputSpec,
    async execute(args) {
      const s2 = s
      const q = String(args.query || '').trim()
      const r = s2.data.reminders.find((x) => x.id === q)
        || s2.data.reminders.find((x) => String(x.title).includes(q))
      if (!r) throw new Error('找不到提醒: ' + args.query)
      return out('已彻底删除提醒「' + r.title + '」。', s2.purgeReminder(r.id))
    },
  })))

  reg('desk_due', () => ctx.tools.register(defineTool({
    name: 'desk_due',
    description: '查现在有没有到期还没处理的提醒。',
    parameters: {},
    output: outputSpec,
    async execute() {
      const s2 = s
      s2.tick()
      const alerts = s2.pendingAlerts()
      const text = alerts.length
        ? alerts.map((a) => '- ' + a.title + (a.over ? '【已过截止时间】' : '【快到点了】') + ' 计划 ' + fmtTime(a.dueAt)).join('\n')
        : '当前没有到期待处理的提醒。'
      return out(text, alerts)
    },
  })))

  reg('desk_link_add', () => ctx.tools.register(defineTool({
    name: 'desk_link_add',
    description: '收藏一个网页到「网页」分类(手机桌面式格子,点一下就能跳过去)。用户说「收藏这个网址」「把 xx 加到常用」时用。',
    parameters: {
      url: { type: 'string', description: '网址;不写 https:// 会自动补' },
      title: { type: 'string', description: '显示名(建议 2~6 个字),不写就用域名' },
      group: { type: 'string', description: '分类名,如「工作」「工具」「常用」;不写就是未分类' },
      icon: { type: 'string', description: '可选图标:一个 emoji,或图片地址' },
      note: { type: 'string', description: '备注(可选)' },
    },
    output: outputSpec,
    async execute(args) {
      const l = s.addLink(args)
      return out((l.deduped ? '这个网址已经收过了,已更新:' : '已收藏网页:') + l.title + ' · ' + l.url, l)
    },
  })))

  reg('desk_link_list', () => ctx.tools.register(defineTool({
    name: 'desk_link_list',
    description: '列出收藏的网页(可按分类过滤),用户问「我的常用网站有哪些」时用。',
    parameters: {
      group: { type: 'string', description: '只看这个分类;不传 = 全部' },
    },
    output: outputSpec,
    async execute(args) {
      const want = String(args && args.group || '').trim()
      const items = s.listLinks().filter((l) => !want || l.group === want)
      const text = items.length
        ? items.map((l) => '- ' + l.title + ' | ' + (l.group || '未分类') + ' | ' + l.url).join('\n')
        : (want ? '「' + want + '」这个分类下还没有网页。' : '还没有收藏网页。')
      return out(text, items)
    },
  })))

  reg('desk_item_move', () => ctx.tools.register(defineTool({
    name: 'desk_item_move',
    description: '把一条记录从原来的分类转到另一个分类(自动分类分错了、用户说「这条不该放这儿」时用)。便签/网页/提醒转走后原条目进垃圾箱;保险库条目带密码时不许转到明文的地方。',
    parameters: {
      to: { type: 'string', description: '目标分类:note(便签)/ link(网页)/ secret(保险库)/ reminder(提醒)' },
      from: { type: 'string', description: '原分类,省略就在四个分类里按名字找' },
      title: { type: 'string', description: '那条记录的标题或 id' },
    },
    output: outputSpec,
    async execute(args) {
      const to = String(args && args.to || '').trim()
      const q = String(args && args.title || '').trim()
      if (!q) throw new Error('要挪哪一条?给个标题或 id')
      const kinds = args && args.from ? [String(args.from)] : ['note', 'link', 'reminder', 'secret']
      let hit = null
      let hitKind = ''
      for (const k of kinds) {
        const list = k === 'note' ? s.listNotes({ view: 'all', includeArchived: true })
          : k === 'link' ? s.listLinks()
            : k === 'reminder' ? s.todayView()
              : s.listSecrets()
        const row = list.find((x) => x.id === q) || list.find((x) => x.title === q) || list.find((x) => String(x.title || x.text || '').includes(q))
        if (row) { hit = row; hitKind = k; break }
      }
      if (!hit) throw new Error('找不到「' + q + '」')
      const r = s.convertItem(hitKind, hit.id, to)
      const NAME = { note: '便签', link: '网页', secret: '保险库', reminder: '提醒' }
      return out('已转到' + NAME[to] + ':' + (r.item.title || '这条'), { id: r.item.id, from: hitKind, to })
    },
  })))

  reg('desk_link_delete', () => ctx.tools.register(defineTool({
    name: 'desk_link_delete',
    description: '把收藏的网页移入垃圾箱(可恢复)。',
    parameters: {
      title: { type: 'string', description: '网页的名字(或 id;名字唯一时按名字找)' },
    },
    output: outputSpec,
    async execute(args) {
      const q = String(args && args.title || '').trim()
      // 空关键字会把 includes('') 变成「谁都匹配」,一删一个准 —— 必须先挡住
      if (!q) throw new Error('要删哪个?给个名字或 id')
      const hit = s.listLinks().find((l) => l.id === q)
        || s.listLinks().find((l) => l.title === q)
        || s.listLinks().find((l) => l.title.includes(q))
      if (!hit) throw new Error('找不到网页 ' + q)
      s.deleteLink(hit.id)
      return out('已移入垃圾箱:' + hit.title, { id: hit.id, title: hit.title })
    },
  })))

  reg('desk_secret_add', () => ctx.tools.register(defineTool({
    name: 'desk_secret_add',
    description: '把账号/密钥等长期重要信息存进加密保险库(AES-256-GCM 落盘)。',
    parameters: {
      title: { type: 'string', description: '条目标题' },
      username: { type: 'string', description: '用户名/邮箱(可选)' },
      password: { type: 'string', description: '密码/密钥(可选)' },
      url: { type: 'string', description: '网址(可选)' },
      note: { type: 'string', description: '备注(可选)' },
      body: { type: 'string', description: '自由正文:想怎么记就怎么记(可选)' },
      collection: { type: 'string', description: '合集名(可选,如「梯子订阅」)' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签(可选)' },
    },
    output: outputSpec,
    async execute(args) {
      const payload = { ...args }
      if (!payload.note && args.body) payload.note = args.body
      if (!payload.username && !payload.password && !payload.url && !payload.note) {
        throw new Error('至少要有一点内容(正文或账号/密码)')
      }
      const r = s.addSecret(payload)
      return out('已加密保存「' + r.title + '」,id=' + r.id + '。', r)
    },
  })))

  reg('desk_secret_list', () => ctx.tools.register(defineTool({
    name: 'desk_secret_list',
    description: '列出保险库条目(只有标题/标签,不含明文)。',
    parameters: {},
    output: outputSpec,
    async execute() {
      const items = s.listSecrets()
      const text = items.length
        ? items.map((e) => '- ' + e.title + (e.collection ? ' {合集:' + e.collection + '}' : '') + (e.tags && e.tags.length ? ' [' + e.tags.join(',') + ']' : '') + ' | id=' + e.id).join('\n')
        : '保险库还是空的。'
      return out(text, items)
    },
  })))

  reg('desk_secret_get', () => ctx.tools.register(defineTool({
    name: 'desk_secret_get',
    description: '读出某条保险库条目的完整字段(会解密)。仅当用户明确要看时调用。',
    parameters: { query: { type: 'string', description: '条目 id 或标题片段' } },
    output: outputSpec,
    async execute(args) {
      const item = s.getSecret(args.query)
      if (!item) throw new Error('找不到条目: ' + args.query)
      const lines = Object.entries(item.fields).map(([k, v]) => k + ': ' + v)
      if (item.note) lines.push('备注: ' + item.note)
      return out('【' + item.title + '】\n' + lines.join('\n'), item)
    },
  })))

  reg('desk_secret_delete', () => ctx.tools.register(defineTool({
    name: 'desk_secret_delete',
    description: '删除保险库里的一条(不可恢复)。',
    parameters: { query: { type: 'string', description: '条目 id 或标题片段' } },
    output: outputSpec,
    async execute(args) {
      const r = s.deleteSecret(args.query)
      return out('已删除「' + r.title + '」。', r)
    },
  })))

  // ---- 浏览器半侧的 HTTP API ----
  const server = ctx.get('webServer')
  if (!server) {
    try { ctx.logger && ctx.logger.warn && ctx.logger.warn('[desk-kit] 没有 webServer,面板 API 未注册') } catch { }
    return
  }
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: '只允许本机访问' })
        return
      }
      const url = new URL(String(req.url || '/'), 'http://localhost')
      const method = String(req.method || 'GET').toUpperCase()
      const guarded = guardRequest(req, method)
      if (guarded) {
        json(res, 403, { ok: false, error: guarded })
        return
      }
      // 另一个 DSH 实例刚写过盘:先把内存换成磁盘上的,别拿旧数据整份覆盖。
      // 放在围栏之后:被拒的请求不该触发磁盘读取。
      try { s.refresh() } catch (error) { /* 读不到就按内存里的继续 */ }
      try {
        // 模型目录:给设置页的「识图模型」下拉用(只读,只认 GET)
        if (method === 'GET' && url.pathname === ROUTE + '/models') {
          const llm = ctx.get('llm')
          const providers = []
          if (llm && typeof llm.listProviders === 'function') {
            for (const p of llm.listProviders()) {
              const id = String((p && p.id) || '').trim()
              if (!id) continue
              try {
                const list = typeof llm.listModels === 'function' ? await llm.listModels(id) : []
                const models = (Array.isArray(list) ? list : []).map((m) => ({
                  id: String((m && m.id) || '').trim(),
                  name: String((m && m.name) || (m && m.id) || '').trim(),
                  image: Array.isArray(m && m.inputModalities) ? m.inputModalities.includes('image') : null,
                })).filter((m) => m.id)
                if (models.length) {
                  providers.push({ id, name: String((p && p.name) || id).trim() || id, models })
                }
              } catch (e) { /* 这个 provider 拉不到,跳过 */ }
            }
          }
          json(res, 200, { ok: true, providers })
          return
        }
        // 取附件原件。注意:这里是 GET 且要能被 <img src> 直接用,所以不要求 x-desk-kit 头;
        // 靠来源校验 + same-origin 的 CORP 头挡住别的站点。
        if (method === 'GET' && url.pathname.startsWith(ROUTE + '/files/')) {
          const id = decodeURIComponent(url.pathname.slice((ROUTE + '/files/').length))
          const { rec, bytes } = s.readFileBytes(id)
          res.writeHead(200, fileHeaders({ ...rec, size: bytes.length }))
          res.end(bytes)
          return
        }
        // 传附件:请求体就是文件本身,文件名放在自定义头里(和 x-desk-kit 一起走预检)
        if (method === 'POST' && url.pathname === ROUTE + '/files') {
          const name = (() => {
            const raw = String(req.headers['x-file-name'] || '')
            try { return decodeURIComponent(raw) } catch { return raw }
          })()
          const bytes = await readRawBody(req, MAX_FILE_BYTES + 1024)
          if (!bytes.length) { json(res, 400, { ok: false, error: '空文件' }); return }
          const mime = String(req.headers['content-type'] || '').split(';')[0].trim()
          // 配额:别让插件变成网盘。超了给一句「先清理」,而不是写满磁盘
          const used = s.storage().bytes.blobs
          if (used + bytes.length > MAX_BLOB_BYTES) {
            json(res, 413, {
              ok: false,
              error: '附件总量到上限了(已用 ' + DeskStore.humanBytes(used) + ',上限 ' + DeskStore.humanBytes(MAX_BLOB_BYTES) + ')。到设置 → 存储与清理 清一下再传',
            })
            return
          }
          const file = s.addFile({ buffer: bytes, name, mime })
          s.tick()
          json(res, 200, { ok: true, file, state: s.snapshot() })
          return
        }
        // 整库导入:备份文件可能几 MB(2000 条便签 ≈ 1.1MB),单独放宽到 32MB
        if (method === 'POST' && url.pathname === ROUTE + '/import') {
          const body = await readBody(req, 32 * 1024 * 1024)
          const report = s.importBackup(body.backup || body, { mode: body.mode, confirm: body.confirm === true })
          s.tick()
          json(res, 200, { ok: true, report, state: s.snapshot() })
          return
        }
        // 整库导出:给设置页的「备份」按钮,浏览器直接落成 .json(只读,只认 GET)
        if (method === 'GET' && url.pathname === ROUTE + '/export') {
          json(res, 200, { ok: true, backup: s.exportAll() })
          return
        }
        if (method === 'GET') {
          const s2 = s
          s2.tick()
          // 快照一次序列化:既当响应体,又当 ETag 的原料。2000 条便签时约 1.1MB,
          // 20 秒一次白烧流量 —— 内容没变就回 304,客户端连 setState 都不做。
          const stateJson = JSON.stringify(s2.snapshot())
          const payload = '{"ok":true,"state":' + stateJson + '}'
          // 哈希必须覆盖 tick() 刚刚造的告警,否则「到点了但面板不动」
          const etag = etagOf(stateJson)
          const ifNoneMatch = String(req.headers['if-none-match'] || '')
          if (ifNoneMatch && ifNoneMatch === etag) {
            res.writeHead(304, { etag, 'cache-control': 'no-store' })
            res.end()
            return
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag })
          res.end(payload)
          return
        }
        if (method === 'POST') {
          const body = await readBody(req)
          const action = String(body.action || '')
          const s2 = s
          s2.tick()
          const result = await act(ctx, s2, action, body.payload || {})
          // 写操作也回一份 ETag:客户端拿到后写进 lastEtag,下一次轮询就能命中 304,
          // 不必为「刚改过的那条」再拉一次整份快照。
          const state = s2.snapshot()
          const payload = JSON.stringify({ ok: true, result, state })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag: etagOf(state) })
          res.end(payload)
          return
        }
        json(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        // 请求体超限是 413,不是 400:客户端/用户能据此判断该减小请求,而不是以为参数写错了
        const tooBig = !!(error && error.code === 'E_TOO_BIG')
        json(res, tooBig ? 413 : 400, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'desk-kit: /desk-kit-api')

  // 启动痕迹:重启后能一眼看出加载的是哪版
  try {
    mkdirSync(storeRoot(), { recursive: true })
    appendFileSync(join(storeRoot(), 'boot.log'), new Date().toISOString() + ' apply ok · v' + PLUGIN_VERSION + ' · defineTool=' + picked.source + ' · data=' + storeRoot() + ' · api=' + ROUTE + '\n')
  } catch { }
  try {
    ctx.logger && ctx.logger.info && ctx.logger.info('[desk-kit] 就绪,数据目录 ' + storeRoot() + ', API ' + ROUTE + ', defineTool=' + picked.source)
  } catch { }
}
