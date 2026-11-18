/**
 * dsh-desk-kit · 宿主半侧
 *
 * 三件事:
 *   1. 便签      —— 随手记,落 $DSH_HOME/desk-kit/data.json
 *   2. 提醒      —— 到点前提醒(打卡/待办类),完成后当天静默;由本插件自己的定时器驱动
 *   3. 保险库    —— 账号/密钥长期保存,AES-256-GCM 加密落盘(主密钥在本机 vault.key,0600)
 *
 * 对外:13 个 Agent 工具 + 一条同源 HTTP API(/desk-kit-api),浏览器半侧轮询它。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { appendFileSync, mkdirSync } from 'node:fs'
import { DeskStore, localYmd } from './store.js'
import { localDefineTool } from './tool.js'
import { parseCapture, describeCapture } from './capture.js'

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
        leadMin: 30,
        url: site.url,
        note: '每天打卡',
      }))
      have.add(key)
    }
    const reply = '已整理成 ' + created.length + ' 条每日打卡提醒(21:00 前,提前 30 分提醒)'
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
    const mapped = {
      kind: 'reminder',
      title: str(ai.title).slice(0, 120) || '提醒',
      time: clock(ai.time) || '09:00',
      weekdays: Array.isArray(ai.weekdays) ? ai.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      leadMin: Number.isFinite(Number(ai.leadMin)) ? Math.max(0, Math.min(10080, Number(ai.leadMin))) : 30,
      url: str(ai.url),
      note: str(ai.note),
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str(ai.date))) mapped.date = str(ai.date)
    if (ai.lunar && Number.isFinite(Number(ai.lunar.month)) && Number.isFinite(Number(ai.lunar.day))) {
      mapped.lunar = { month: Number(ai.lunar.month), day: Number(ai.lunar.day) }
      mapped.yearly = true
    } else if (/^\d{2}-\d{2}$/.test(str(ai.annual))) {
      mapped.annual = str(ai.annual)
      mapped.yearly = true
    }
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
const PLUGIN_VERSION = '1.10.0'
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

/**
 * 冷启动时 ctx.tools 可能还没 ACTIVE:同步 register 不抛错但不进表。
 * 照 dsh-meme 的兜底做法,先 ctx.inject(['tools']) 等依赖就绪。
 */
function registerToolWhenReady(ctx, label, register, owns) {
  const report = (error) => {
    const text = '[desk-kit] ' + label + ' 注册失败: ' + String((error && error.message) || error)
    try { console.error(text) } catch { }
    try { if (ctx.logger && ctx.logger.error) ctx.logger.error(text) } catch { }
  }
  const safe = () => {
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

/** 动作分发:ctx 与 store 都由调用方显式传入,不依赖模块级状态。 */
async function act(ctx, s, action, payload) {
  switch (action) {
    case 'capture': return await applyCaptureSmart(ctx, s, payload.text)
    case 'note.add': return s.addNote(payload)
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
    case 'secret.delete': return s.deleteSecret(payload.query || payload.id)
    case 'secret.get': {
      const found = s.getSecret(payload.query || payload.id)
      if (!found) throw new Error('找不到条目')
      return found
    }
    case 'settings.update': {
      if (Number.isFinite(payload.tickSeconds)) {
        s.data.settings.tickSeconds = Math.max(5, Math.min(600, payload.tickSeconds))
      }
      if (typeof payload.muted === 'boolean') s.data.settings.muted = payload.muted
      // 白名单漏了这两个:设置页拨开关会「拨完又弹回去」,因为存根本没写进去
      if (typeof payload.sound === 'boolean') s.data.settings.sound = payload.sound
      if (typeof payload.linkFavicons === 'boolean') s.data.settings.linkFavicons = payload.linkFavicons
      if (typeof payload.recognizeProvider === 'string') s.data.settings.recognizeProvider = payload.recognizeProvider
      if (typeof payload.recognizeModel === 'string') s.data.settings.recognizeModel = payload.recognizeModel
      if (typeof payload.classifyProvider === 'string') s.data.settings.classifyProvider = payload.classifyProvider
      if (typeof payload.classifyModel === 'string') s.data.settings.classifyModel = payload.classifyModel
      // 浮标是兜底入口:显式 true/false 才记,不设就是「有侧栏就当没有」
      if (typeof payload.floatFab === 'boolean') s.data.settings.floatFab = payload.floatFab
      s.save()
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
  const reg = (label, make) => registerToolWhenReady(ctx, label, make, toolDisposers)
  ctx.effect(() => () => {
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
    },
    output: outputSpec,
    async execute(args) {
      const note = s.addNote({ text: args.text, tags: args.tags, pinned: args.pinned })
      return out('已记下便签「' + note.text.slice(0, 40) + '」,id=' + note.id, note)
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
        ? notes.map((n, i) => (i + 1) + '. ' + (n.pinned ? '[置顶] ' : '') + n.text.replace(/\n/g, ' ') + '  (' + fmtTime(n.updatedAt) + ', id=' + n.id + ')').join('\n')
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
        ? items.map((e) => '- ' + e.title + (e.tags && e.tags.length ? ' [' + e.tags.join(',') + ']' : '') + ' | id=' + e.id).join('\n')
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
      // 另一个 DSH 实例刚写过盘:先把内存换成磁盘上的,别拿旧数据整份覆盖
      try { s.refresh() } catch (error) { /* 读不到就按内存里的继续 */ }
      if (guarded) {
        json(res, 403, { ok: false, error: guarded })
        return
      }
      try {
        // 模型目录:给设置页的「识图模型」下拉用
        if (url.pathname === ROUTE + '/models') {
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
        // 整库导出:给设置页的「备份」按钮,浏览器直接落成 .json
        if (url.pathname === ROUTE + '/export') {
          json(res, 200, { ok: true, backup: s.exportAll() })
          return
        }
        if (method === 'GET') {
          const s2 = s
          s2.tick()
          json(res, 200, { ok: true, state: s2.snapshot() })
          return
        }
        if (method === 'POST') {
          const body = await readBody(req)
          const action = String(body.action || '')
          const s2 = s
          s2.tick()
          const result = await act(ctx, s2, action, body.payload || {})
          json(res, 200, { ok: true, result, state: s2.snapshot() })
          return
        }
        json(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        json(res, 400, { ok: false, error: String((error && error.message) || error) })
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
