/**
 * dsh-desk-kit · 存储层
 * 纯 Node 实现,不依赖 DSH,可以单独 node --test 验证。
 *
 * 目录结构($DSH_HOME/desk-kit/):
 *   data.json   便签 + 提醒 + 待确认告警(明文,可 cat/diff/备份)
 *   vault.json  加密条目(每条独立 AES-256-GCM 密文)
 *   vault.key   本机主密钥材料(0600;丢失则保险库不可解)
 *   blobs/      附件原件(图片/PDF/任何文件);保险库名下的存成 .enc,与条目同一把钥匙
 */
import {
  readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, statSync,
  unlinkSync, readdirSync, existsSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import {
  DAY_MS, isRealDate, localYmd, parseClock, beforeCreated, occurrenceOf, nextOccurrence,
} from './time.js'

// 导出面不变:test.mjs 直接从 store.js 拿这四个来验时间计算,调用方不用改。
export { isRealDate, localYmd, parseClock, occurrenceOf, nextOccurrence } from './time.js'

const ALERT_KEEP_MS = 7 * 24 * 3600 * 1000
const MAX_NOTES = 2000
const MAX_CHECKINS = 60
/** 单个附件上限。截图通常几十 KB,手机照片 3~8MB,给到 24MB 够用又不至于把盘写爆。 */
const MAX_FILE_BYTES = 24 * 1024 * 1024
/** 附件总数上限:再多就是拿它当网盘了,提示用户清理。 */
const MAX_FILES = 3000
/** 附件 id 只是文件名的一部分:不允许路径分隔符/点,防止拼出 blobs/ 之外的路径。 */
const BLOB_ID_RE = /^[A-Za-z0-9_-]{1,120}$/
const isBlobId = (id) => BLOB_ID_RE.test(String(id || ''))

// 中英别名:条目里写 Facebook、人嘴里说「脸书」,搜索要能对上。
// 与客户端 src/client/30-core.js 的 SEARCH_ALIASES 保持同一组;只影响搜索,不落库。
const SEARCH_ALIASES = [
  ['facebook', '脸书', 'fb', 'meta'],
  ['instagram', 'ins', 'ig', '图享'],
  ['wechat', '微信', 'weixin'],
  ['qq', '腾讯qq'],
  ['taobao', '淘宝'],
  ['alipay', '支付宝'],
  ['google', '谷歌', 'gmail', '谷歌邮箱'],
  ['apple', '苹果', 'icloud'],
  ['github'],
  ['twitter', '推特'],
  ['youtube', '油管', '谷歌视频'],
  ['netflix', '奈飞'],
  ['telegram', '电报', 'tg'],
  ['whatsapp', '瓦次艾普'],
  ['steam', '蒸汽平台'],
  ['microsoft', '微软', 'outlook'],
  ['amazon', '亚马逊'],
]

function searchVariants(query) {
  const raw = String(query || '').trim().toLowerCase()
  if (!raw) return []
  const flat = raw.replace(/[\s\-_./]+/g, '')
  const out = new Set([raw, flat].filter(Boolean))
  for (const group of SEARCH_ALIASES) {
    const hit = group.some((a) => (a.length >= 2 ? raw.includes(a) || flat.includes(a) : raw === a))
    if (!hit) continue
    for (const a of group) if (a.length >= 2) out.add(a)
  }
  return [...out]
}

function searchMatch(text, variants) {
  const hay = String(text || '').toLowerCase()
  if (!hay) return false
  const flat = hay.replace(/[\s\-_./]+/g, '')
  return variants.some((v) => hay.includes(v) || flat.includes(v))
}

/**
 * 从二进制头部读图片尺寸(PNG / GIF / JPEG / WebP / BMP)。
 * 只为了排版时不跳一下 —— 读不出来就返回 0,不影响保存。
 */
export function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    const head6 = buf.length > 10 ? buf.toString('ascii', 0, 6) : ''
    if (head6 === 'GIF87a' || head6 === 'GIF89a') {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
    }
    if (buf.length > 26 && buf.toString('ascii', 0, 2) === 'BM') {
      return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) }
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16)
      if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }
      }
    }
    // JPEG:一段段跳,找到 SOF 段
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
        const len = buf.readUInt16BE(i + 2)
        const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isSOF) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        i += 2 + len
      }
    }
  } catch { /* 头部不完整/格式奇怪:当成不知道尺寸 */ }
  return { w: 0, h: 0 }
}

/** 只把这些当图片直接给浏览器看 —— 其余一律 octet-stream,免得 SVG/HTML 变成同源脚本。 */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])

/** 从 URL 取主机名(不带 www.),给标题/图标兜底。 */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./i, '')
  } catch {
    return String(url || '').replace(/^https?:\/\//i, '').split('/')[0] || '未命名'
  }
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + randomBytes(3).toString('hex')
}

// ---------------- 导入数据归一化 ----------------
// 备份文件可能是手改的、旧版本的、或者干脆坏的。落库前统一补默认值/截断/丢无效项,
// 免得一条缺字段的记录让 listNotes / 搜索在以后每次调用都抛错。
const asText = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max)
const asInt = (v, fallback = 0) => {
  const n = Number(v)
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? fallback : n
}
const asClamp = (v, min, max, fallback) => Math.max(min, Math.min(max, asInt(v, fallback)))
const asList = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])
const asId = (v) => (typeof v === 'string' ? v.trim().slice(0, 120) : '')
const clockText = (c) => String(c.h).padStart(2, '0') + ':' + String(c.m).padStart(2, '0')

function normalizeNote(raw, now) {
  const id = asId(raw.id)
  if (!id) return null
  const text = asText(raw.text, 20000)
  return {
    ...raw,
    id,
    text,
    tags: asList(raw.tags).slice(0, 12),
    files: asList(raw.files),
    color: asText(raw.color, 20),
    pinned: !!raw.pinned,
    archived: !!raw.archived,
    shelf: raw.shelf === 'long' || raw.shelf === 'daily' ? raw.shelf : DeskStore.inferShelf(raw, text),
    completedAt: asInt(raw.completedAt),
    deletedAt: asInt(raw.deletedAt),
    createdAt: asInt(raw.createdAt, now),
    updatedAt: asInt(raw.updatedAt, now),
    // 常用度:看过/改过几次、最后一次是什么时候。老数据没有这两个字段就是 0,
    // 排序时按「新建 + 更新时间」兜底,不需要迁移。
    views: Math.max(0, asInt(raw.views)),
    lastViewedAt: asInt(raw.lastViewedAt),
  }
}

function normalizeReminder(raw, now) {
  const id = asId(raw.id)
  if (!id) return null
  // 时间存坏的提醒永远不会响,不如在导入时跳过并计数,而不是留一条假提醒
  const clock = parseClock(raw.time)
  if (!clock) return null
  // 一次性提醒的日期不存在时同理:不能把它悄悄降级成「每天」
  const date = raw.date === undefined || raw.date === null || raw.date === ''
    ? undefined
    : (isRealDate(raw.date) ? String(raw.date) : null)
  if (date === null) return null
  const lunar = raw.lunar && typeof raw.lunar === 'object'
    && Number.isFinite(Number(raw.lunar.month)) && Number.isFinite(Number(raw.lunar.day))
    ? {
      month: asClamp(raw.lunar.month, 1, 12, 1),
      day: asClamp(raw.lunar.day, 1, 30, 1),
      isLeap: !!raw.lunar.isLeap,
    }
    : undefined
  const annual = typeof raw.annual === 'string' && /^\d{2}-\d{2}$/.test(raw.annual) && isRealDate('2000-' + raw.annual)
    ? raw.annual
    : undefined
  const monthly = Number.isInteger(Number(raw.monthly)) && Number(raw.monthly) >= 1 && Number(raw.monthly) <= 31
    ? Number(raw.monthly)
    : undefined
  const url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url.trim()) ? raw.url.trim().slice(0, 600) : ''
  return {
    ...raw,
    id,
    title: asText(raw.title, 120) || '未命名提醒',
    note: asText(raw.note, 2000),
    time: clockText(clock),
    weekdays: [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : [])
      .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))],
    date,
    lunar,
    annual,
    monthly,
    yearly: !!raw.yearly,
    leadMin: asClamp(raw.leadMin, 0, 10080, 0),
    snoozeMin: asClamp(raw.snoozeMin, 1, 720, 20),
    url,
    active: raw.active !== false,
    doneDates: asList(raw.doneDates),
    silencedDates: asList(raw.silencedDates),
    snoozeUntil: asInt(raw.snoozeUntil),
    createdAt: asInt(raw.createdAt, now),
    updatedAt: asInt(raw.updatedAt, now),
  }
}

function normalizeLink(raw, now) {
  const id = asId(raw.id)
  if (!id) return null
  const url = asText(raw.url, 600).trim()
  if (!/^https?:\/\//i.test(url)) return null
  return {
    ...raw,
    id,
    title: asText(raw.title, 80) || hostOf(url),
    url,
    group: asText(raw.group, 24),
    icon: asText(raw.icon, 400),
    note: asText(raw.note, 2000),
    pinned: !!raw.pinned,
    hits: Math.max(0, asInt(raw.hits)),
    lastOpenedAt: asInt(raw.lastOpenedAt),
    createdAt: asInt(raw.createdAt, now),
    updatedAt: asInt(raw.updatedAt, now),
    deletedAt: asInt(raw.deletedAt),
  }
}

function normalizeFile(raw, now) {
  const id = asId(raw.id)
  if (!id || !isBlobId(id)) return null
  const kind = ['note', 'reminder', 'link', 'secret'].includes(raw.kind) ? raw.kind : ''
  return {
    ...raw,
    id,
    name: asText(raw.name, 160) || '未命名文件',
    mime: asText(raw.mime, 120) || 'application/octet-stream',
    size: Math.max(0, asInt(raw.size)),
    w: Math.max(0, asInt(raw.w)),
    h: Math.max(0, asInt(raw.h)),
    secret: !!raw.secret,
    kind,
    ownerId: asText(raw.ownerId, 120),
    createdAt: asInt(raw.createdAt, now),
  }
}

function normalizeAlert(raw) {
  const id = asId(raw.id)
  if (!id) return null
  return {
    ...raw,
    id,
    kind: asText(raw.kind, 20),
    refId: asText(raw.refId, 120),
    date: asText(raw.date, 10),
    dueDate: asText(raw.dueDate, 10),
    title: asText(raw.title, 200),
    text: asText(raw.text, 2000),
    at: asInt(raw.at),
    dueAt: asInt(raw.dueAt),
    over: !!raw.over,
    late: !!raw.late,
    acked: !!raw.acked,
  }
}

function normalizeImported(kind, raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (kind === 'notes') return normalizeNote(raw, now)
  if (kind === 'reminders') return normalizeReminder(raw, now)
  if (kind === 'links') return normalizeLink(raw, now)
  if (kind === 'files') return normalizeFile(raw, now)
  if (kind === 'alerts') return normalizeAlert(raw)
  return null
}

/** 半衰:多少天后权重剩一半。新东西衰减快(新鲜感过了就该让位),常用度衰减慢。 */
const HALF_FRESH_DAYS = 3
const HALF_USED_DAYS = 10

const decay = (at, now, halfDays) => {
  const t = Number(at) || 0
  if (!t) return 0
  const days = Math.max(0, (now - t) / DAY_MS)
  return Math.pow(0.5, days / halfDays)
}

/**
 * 一条记录的「注意力权重」:谁该排在前面。
 *
 * 三件事叠加,各自都想得明白:
 * 1. **新鲜**:刚建的、一次都没碰过的东西给 0.12(3 天半衰)。新东西本来就已经靠
 *    「新近」拿到高分,这一项只是让「刚存的」压过「很久没碰过的」,不该压过「刚点开过的」——
 *    所以它比「用过一次」的加成小。
 * 2. **新近**:最后一次被用到(看过 / 打开过 / 改过)有多近(10 天半衰)。
 * 3. **常用**:用过几次,对数饱和 —— 第 1 次就有明显加成,第 15 次之后不再涨,
 *    免得一条看了 200 遍的老记录永远压着别的。
 *
 * 置顶不在这里算:置顶是「我说了算」,永远在权重之上。
 */
export function attentionScore(x, now = Date.now()) {
  if (!x) return 0
  const created = Number(x.createdAt) || 0
  const used = Math.max(
    Number(x.lastViewedAt) || 0,
    Number(x.lastOpenedAt) || 0,
    Number(x.updatedAt) || 0,
    created,
  )
  const count = Math.max(Number(x.views) || 0, Number(x.hits) || 0)
  const fresh = count ? 0 : 0.12 * decay(created, now, HALF_FRESH_DAYS)
  const recent = 0.5 * decay(used, now, HALF_USED_DAYS)
  const often = 0.6 * Math.min(1, Math.log2(1 + count) / 4)
  return fresh + recent + often
}

/** 排序:置顶 → 权重 → 时间倒序(同分时 newest first,顺序才稳定)。 */
function byAttention(a, b, now) {
  const pin = (Number(b.pinned) - Number(a.pinned))
  if (pin) return pin
  const d = attentionScore(b, now) - attentionScore(a, now)
  if (Math.abs(d) > 1e-9) return d
  return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
}

const backedUp = new Set()

/** 文件指纹(修改时间 + 大小);读不到返回空串。 */
function stampOf(file) {
  try {
    const st = statSync(file)
    return st.mtimeMs + ':' + st.size
  } catch { return '' }
}

/** 文本里能认出的网址:带协议的直接用,裸域名补 https。 */
function urlInText(text) {
  const s = String(text || '')
  const withScheme = /https?:\/\/[^\s,，。；)）]+/i.exec(s)
  if (withScheme) return withScheme[0]
  const bare = /(?:^|[\s「(（])((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\s/」)）]|$)/i.exec(s)
  return bare ? 'https://' + bare[1] : ''
}

/** 从一段话里取个像名字的标题:像句子就用域名,别把整句塞进标题。 */
export function titleFromText(text, url, fallback = '') {
  const first = String(text || '').split('\n')[0] || ''
  let t = first
    .replace(/https?:\/\/[^\s,，。；)）]+/gi, ' ')
    .replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const looksDesc = !t || t.length > 20 || /[，。、；:：!?]/.test(t) || /不错|好用|挺好|适合|可以用|用来|推荐/.test(t)
  if (looksDesc) {
    const host = url ? String(url).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '') : ''
    return (host || t.slice(0, 40) || fallback).slice(0, 80)
  }
  return t.slice(0, 80)
}

function readJson(file, fallback) {
  try {
    const raw = readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    // 文件存在但读不出来(半截写入 / 手改坏 / 磁盘错):先原样留一份再当成空库,
    // 否则下一次 save() 就把它覆盖掉,里面的便签一条都找不回来了。
    if (!backedUp.has(file)) {
      backedUp.add(file)   // 同一个文件只留一份,别每次读都写一个
      try {
        const stuck = readFileSync(file, 'utf8')
        if (stuck.trim()) writeFileSync(file + '.corrupt-' + Date.now(), stuck)
      } catch { /* 读都读不到就算了 */ }
    }
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + randomBytes(2).toString('hex')
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

export class DeskStore {
  constructor(root) {
    this.root = root
    this.dataFile = join(root, 'data.json')
    this.vaultFile = join(root, 'vault.json')
    this.keyFile = join(root, 'vault.key')
    this.blobDir = join(root, 'blobs')
    this.data = this.loadData()
    this._stamp = stampOf(this.dataFile)
  }

  loadData() {
    const base = {
      version: 1,
      notes: [],
      reminders: [],
      links: [],
      files: [],
      alerts: [],
      settings: {
        // 定时器间隔由宿主半侧写死(TICK_MS);这里只放用户真正能改的设置。
        muted: false, sound: true,
        // 垃圾箱里的东西留几天(0 = 永不自动清)
        trashKeepDays: 30,
        // 上次自动清理的时间戳,给「什么时候清过」一个凭据
        lastSweepAt: 0,
        // 旧版默认提前 30 分;这里标记迁移是否跑过(不暴露到设置页)
        leadDefaultMigrated: true,
      },
    }
    const raw = readJson(this.dataFile, null)
    if (!raw || typeof raw !== 'object') return base
    const notes = Array.isArray(raw.notes) ? raw.notes : []
    const reminders = Array.isArray(raw.reminders) ? raw.reminders : []
    const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
    // 老数据迁移:没有 shelf 的按同一条规则补上(只跑一次,补完回写)
    let migrated = 0
    for (const n of notes) {
      if (n && typeof n === 'object' && (n.shelf !== 'daily' && n.shelf !== 'long')) {
        n.shelf = DeskStore.inferShelf(n, String(n.text || ''))
        migrated++
      }
    }
    // 旧版把 30 分钟当成默认提前量。用户记录时间时通常已经算好,
    // 升级后一次性把「仍是旧默认 30 分」的提醒改成准时;自定义的其它提前量不动。
    const legacyLead = rawSettings.leadDefaultMigrated !== true
    if (legacyLead) {
      for (const r of reminders) {
        if (r && typeof r === 'object' && r.leadMin === 30) r.leadMin = 0
      }
    }
    const settings = { ...base.settings, ...rawSettings }
    if (legacyLead) settings.leadDefaultMigrated = true
    if (migrated > 0 || legacyLead) {
      try { writeJson(this.dataFile, { ...raw, notes, reminders, settings }) } catch { /* 写不进去下次再补 */ }
    }
    return {
      ...base,
      ...raw,
      notes,
      reminders,
      links: Array.isArray(raw.links) ? raw.links : [],
      files: Array.isArray(raw.files) ? raw.files : [],
      alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
      settings,
    }
  }

  save() {
    writeJson(this.dataFile, this.data)
    this._stamp = stampOf(this.dataFile)
  }

  /**
   * 磁盘变了就把内存里的换掉。
   * 桌面端和 web profile 各开一个 DSH 时,两边各有一份 DeskStore:谁后保存谁赢,
   * 先保存的那次改动会凭空消失。每次处理请求 / 每轮 tick 前对一下文件时间戳,
   * 至少让「另一边刚写过」这件事不会被我这边整份覆盖。
   */
  refresh() {
    const stamp = stampOf(this.dataFile)
    if (!stamp) return this
    // 空串 = 上次读的时候文件还不存在 / 读不到,现在出现了也算「变了」
    if (stamp !== this._stamp) {
      this.data = this.loadData()
      this._stamp = stamp
    }
    return this
  }

  // ---------------- 便签 ----------------

  /**
   * 自动判 shelf(不逼用户做选择):
   *   打了标签 / 正文 >200 字 / 含非签到网址 → 长期资料
   *   其余 → 进行中
   */
  static inferShelf(input, text) {
    const asked = typeof input.shelf === 'string' ? input.shelf : ''
    if (asked === 'long' || asked === 'daily') return asked
    // 长文、非签到网址、以及"资料类"标签名 → 长期;普通标签(生活/购物)不算
    if (text.length > 200) return 'long'
    if (/https?:\/\//i.test(text) && !/签到|打卡|每日|每天/.test(text)) return 'long'
    const tags = Array.isArray(input.tags) ? input.tags.join(' ') : ''
    if (/资料|合集|参考|词库|池|手册|清单|备忘库/.test(tags)) return 'long'
    return 'daily'
  }

  addNote(input = {}) {
    const text = String(input.text || '').trim()
    const files = this.pickFileIds(input.files)
    // 只有一张图、一个字都没写也算数 —— 截完图直接贴进来是常见用法
    if (!text && !files.length) throw new Error('便签内容不能为空')
    const now = Date.now()
    // 同一句话 10 分钟内又存一次:不新增重复条目,只把它顶上来
    // (没写字的纯图片便签不参与去重,否则所有截图会挤成一条)
    const dup = text ? this.data.notes.find((n) => !n.deletedAt && !n.completedAt && n.text === text
      && now - (n.updatedAt || n.createdAt || 0) < 10 * 60000) : null
    if (dup) {
      // 重复提交时如果带了新标签,并进去(别让标签白白丢掉)
      const extra = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : []
      if (extra.length) dup.tags = [...new Set([...(dup.tags || []), ...extra])].slice(0, 12)
      if (input.pinned) dup.pinned = true
      if (files.length) dup.files = [...new Set([...(dup.files || []), ...files])]
      dup.updatedAt = now
      this.save()
      return { ...dup, deduped: true }
    }
    const note = {
      id: uid('n-'),
      text: text.slice(0, 20000),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 12) : [],
      color: typeof input.color === 'string' ? input.color.slice(0, 20) : '',
      pinned: !!input.pinned,
      archived: false,
      files,                                  // 附件 id(原件在 blobs/)
      shelf: DeskStore.inferShelf(input, text),  // 'daily' 进行中 | 'long' 长期资料
      completedAt: 0,   // >0 = 已完成
      deletedAt: 0,     // >0 = 在垃圾箱里
      createdAt: now,
      updatedAt: now,
    }
    this.data.notes.unshift(note)
    // 上传时还不知道要挂给谁,建好便签才认领(先存字节再挂,挂不上原件也还在)
    if (files.length) this.attachFiles('note', note.id, files)
    // 到上限不再静默截断(以前直接丢掉最旧的):转成归档,还在快照里、还能搜到
    if (this.data.notes.length > MAX_NOTES) {
      const overflow = this.data.notes.splice(MAX_NOTES)
      for (const old of overflow) old.archived = true
      this.data.notes.push(...overflow)
    }
    this.save()
    return note
  }

  updateNote(id, patch = {}) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    const beforeFiles = new Set(Array.isArray(note.files) ? note.files : [])
    const removeWanted = new Set(Array.isArray(patch.removeFiles) ? patch.removeFiles.map(String) : [])
    // 先算好「改完是什么样」,再动 note —— 否则空文本/空图片时会先改内存再抛错,
    // 内存和磁盘短暂不一致,轮询可能把半截状态发出去。
    const nextText = typeof patch.text === 'string' ? patch.text.trim() : String(note.text || '')
    let nextFiles
    if (patch.files !== undefined) nextFiles = this.pickFileIds(patch.files)
    else if (removeWanted.size) nextFiles = (note.files || []).filter((fid) => !removeWanted.has(fid))
    else nextFiles = Array.isArray(note.files) ? note.files.slice() : []
    if (!nextText && !nextFiles.length) throw new Error('便签内容不能为空')

    if (typeof patch.text === 'string') note.text = nextText.slice(0, 20000)
    if (Array.isArray(patch.tags)) note.tags = patch.tags.map(String).filter(Boolean).slice(0, 12)
    if (typeof patch.pinned === 'boolean') note.pinned = patch.pinned
    if (typeof patch.archived === 'boolean') note.archived = patch.archived
    if (patch.shelf === 'long' || patch.shelf === 'daily') note.shelf = patch.shelf
    if (typeof patch.color === 'string') note.color = patch.color.slice(0, 20)
    note.files = nextFiles
    if (patch.files !== undefined && nextFiles.length) this.attachFiles('note', note.id, nextFiles)
    note.updatedAt = Date.now()
    this.save()
    // 从这条便签里移掉的图片,保存成功后再清原件;只清原本就属于它的,别误删别人的
    const gone = [...removeWanted].filter((fid) => beforeFiles.has(fid) && !nextFiles.includes(fid))
    if (gone.length) this.dropFiles(gone)
    return note
  }

  /** 删除 = 移入垃圾箱(可恢复)。要真删用 purgeNote。 */
  deleteNote(id) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.deletedAt = Date.now()
    note.updatedAt = Date.now()
    this.save()
    return { trashed: id, id }
  }

  /** 从垃圾箱恢复。 */
  restoreNote(id) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.deletedAt = 0
    note.updatedAt = Date.now()
    this.save()
    return note
  }

  /** 彻底删除(不可恢复)。附件原件跟着删。 */
  purgeNote(id) {
    const before = this.data.notes.length
    const target = this.data.notes.find((n) => n.id === id)
    this.data.notes = this.data.notes.filter((n) => n.id !== id)
    if (this.data.notes.length === before) throw new Error('找不到便签 ' + id)
    this.dropFiles(target && target.files)
    this.save()
    return { purged: id, id }
  }

  /** 标记完成 / 取消完成。 */
  completeNote(id, done = true) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.completedAt = done ? Date.now() : 0
    note.updatedAt = Date.now()
    this.save()
    return note
  }

  /**
   * 列便签。
   * view: active(默认,未完成未删) / done(已完成) / trash(垃圾箱) / all(未删的全部)
   */
  listNotes({ includeArchived = false, query = '', view = 'active' } = {}) {
    const q = String(query || '').trim().toLowerCase()
    const base = this.data.notes
    let rows
    const isLong = (n) => n.shelf === 'long'
    const alive = (n) => !((n.deletedAt || 0) > 0)
    const open = (n) => alive(n) && !((n.completedAt || 0) > 0)
    if (view === 'trash') rows = base.filter((n) => (n.deletedAt || 0) > 0)
    else if (view === 'done') rows = base.filter((n) => alive(n) && (n.completedAt || 0) > 0)
    else if (view === 'long') rows = base.filter((n) => open(n) && isLong(n) && (includeArchived || !n.archived))
    else if (view === 'all') rows = base.filter(alive)
    else rows = base.filter((n) => open(n) && !isLong(n) && (includeArchived || !n.archived))
    return rows
      // 用 String 兜底:手改过的 data.json 里可能有缺 text 的旧记录,
      // 一处 throw 会让整个搜索/快照永久报错。
      .filter((n) => !q || String(n.text || '').toLowerCase().includes(q) || (n.tags || []).join(' ').toLowerCase().includes(q))
      // 置顶 → 常用/新近 → 时间。搜索结果也走这一套:常查的那几条本来就该在上面。
      .sort((a, b) => byAttention(a, b, Date.now()))
  }

  /** 三个分类的条数,给界面显示小红点/角标用。 */
  noteCounts() {
    const notes = this.data.notes
    const alive = (n) => !((n.deletedAt || 0) > 0)
    const open = (n) => alive(n) && !((n.completedAt || 0) > 0)
    return {
      active: notes.filter((n) => open(n) && n.shelf !== 'long').length,
      long: notes.filter((n) => open(n) && n.shelf === 'long').length,
      done: notes.filter((n) => alive(n) && (n.completedAt || 0) > 0).length,
      trash: notes.filter((n) => (n.deletedAt || 0) > 0).length,
    }
  }

  // ---------------- 提醒 ----------------

  addReminder(input = {}) {
    const title = String(input.title || '').trim()
    if (!title) throw new Error('提醒标题不能为空')
    const clock = parseClock(input.time)
    if (!clock) throw new Error('时间格式必须是 HH:MM,例如 21:00')
    const days = Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : []
    const now = Date.now()
    // 两种入口统一:lunar 对象(面板) 或 lunarMonth/lunarDay(工具/API 简写)
    const lunarIn = input.lunar
      || (Number.isFinite(Number(input.lunarMonth)) && Number.isFinite(Number(input.lunarDay))
        ? { month: Number(input.lunarMonth), day: Number(input.lunarDay) }
        : null)
    const reminder = {
      id: uid('r-'),
      title: title.slice(0, 120),
      note: String(input.note || '').slice(0, 2000),
      time: String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0'),
      weekdays: days,
      date: (() => {
        if (input.date === undefined || input.date === null || input.date === '') return undefined
        const d = String(input.date)
        // 以前只验格式:2026-02-30 会原样存下,那天永远不存在,提醒也不会响
        if (!isRealDate(d)) throw new Error('日期不存在:' + d)
        return d
      })(),
      // 农历每年(生日):{month,day,isLeap}
      lunar: lunarIn && Number.isFinite(Number(lunarIn.month)) && Number.isFinite(Number(lunarIn.day))
        ? { month: Math.max(1, Math.min(12, Number(lunarIn.month))), day: Math.max(1, Math.min(30, Number(lunarIn.day))), isLeap: !!lunarIn.isLeap }
        : undefined,
      // 公历每年:'MM-DD'
      annual: typeof input.annual === 'string' && /^\d{2}-\d{2}$/.test(input.annual) ? input.annual : undefined,
      // 每月 N 号(交房租/信用卡这类)
      monthly: Number.isFinite(Number(input.monthly)) && Number(input.monthly) >= 1 && Number(input.monthly) <= 31
        ? Number(input.monthly)
        : undefined,
      // 每年重复标记(生日类),只用于展示
      yearly: !!input.yearly,
      // 上限 7 天:生日这类要提前几天提醒,原来卡在 720 分钟(12h)会让提前量失效
      leadMin: Number.isFinite(input.leadMin) ? Math.max(0, Math.min(10080, input.leadMin)) : 0,
      snoozeMin: Number.isFinite(input.snoozeMin) ? Math.max(1, Math.min(720, input.snoozeMin)) : 20,
      url: typeof input.url === 'string' && /^https?:\/\//i.test(input.url.trim()) ? input.url.trim().slice(0, 600) : '',
      active: true,
      doneDates: [],
      // 点过「知道了」的日期(YYYY-MM-DD):这一天不再提醒,但不是删掉
      silencedDates: [],
      snoozeUntil: 0,
      createdAt: now,
      updatedAt: now,
    }
    // 同一件事说两遍(或者换个写法再说一遍):返回已有那条,别再存一份。
    // 以前会存出两条一模一样的提醒,到点弹两次、列表里也是一对。
    const sig = (x) => [
      x.title, x.time, x.date || '', x.monthly || '', x.annual || '',
      x.lunar ? x.lunar.month + '-' + x.lunar.day : '', (x.weekdays || []).join(','),
    ].join('|')
    const same = this.data.reminders.find((x) => (x.deletedAt || 0) === 0 && sig(x) === sig(reminder))
    if (same) {
      same.updatedAt = now
      this.save()
      return { ...same, deduped: true }
    }
    // 新登记的重复提醒,如果今天这次的点在你登记之前就已经过去,别立刻说「你错过了」——
    // 下午三点登记「每天早上 7:50 吃药」,要的是从明早开始。
    //
    // 判断基准是「这次的点 vs 登记时间」,不写死某个日期:
    // 写 silencedDates 会把「今天」固化下来,测试和跨时区补算都按别的 now 查一次就错位;
    // 用 createdAt 推导,任何时候拿任意 now 来问都得到同一个答案。
    // 只超过 5 分钟以上才算「过去」:刚刚到点的那次照常响。一次性(明说了日期)不动。
    if (!reminder.date) {
      const todayAt = occurrenceOf(reminder, new Date(now))
      const dueFrom = todayAt ? todayAt.getTime() - (reminder.leadMin || 0) * 60000 : 0
      if (todayAt && dueFrom <= now - 5 * 60000) reminder.startTomorrow = true
    }
    this.data.reminders.push(reminder)
    this.save()
    return reminder
  }

  updateReminder(id, patch = {}) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    if (typeof patch.title === 'string' && patch.title.trim()) r.title = patch.title.trim().slice(0, 120)
    if (typeof patch.note === 'string') r.note = patch.note.slice(0, 2000)
    if (patch.time !== undefined) {
      const clock = parseClock(patch.time)
      if (!clock) throw new Error('时间格式必须是 HH:MM')
      r.time = String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0')
    }
    if (Array.isArray(patch.weekdays)) r.weekdays = patch.weekdays.map(Number).filter((d) => d >= 0 && d <= 6)
    if (Number.isFinite(patch.leadMin)) r.leadMin = Math.max(0, Math.min(10080, patch.leadMin))
    if (Number.isFinite(patch.snoozeMin)) r.snoozeMin = Math.max(1, Math.min(720, patch.snoozeMin))
    if (typeof patch.active === 'boolean') r.active = patch.active
    if (typeof patch.url === 'string') {
      const u = patch.url.trim()
      r.url = /^https?:\/\//i.test(u) ? u.slice(0, 600) : ''
    }
    // 周期是互斥的:选了哪一种,就把其它的清掉。
    // 以前只清 date→其它,反向不清:把「明天」改成「每月 1 号」后 date 还压在上面。
    if (patch.lunar === null) r.lunar = undefined
    else if (patch.lunar && Number.isFinite(patch.lunar.month) && Number.isFinite(patch.lunar.day)) {
      r.lunar = { month: Math.max(1, Math.min(12, patch.lunar.month)), day: Math.max(1, Math.min(30, patch.lunar.day)), isLeap: !!patch.lunar.isLeap }
      r.date = undefined; r.monthly = undefined; r.annual = undefined; r.weekdays = []
    }
    if (patch.annual === null) r.annual = undefined
    else if (typeof patch.annual === 'string' && /^\d{2}-\d{2}$/.test(patch.annual)) {
      r.annual = patch.annual
      r.date = undefined; r.monthly = undefined; r.lunar = undefined; r.weekdays = []
    }
    if (patch.monthly === null) r.monthly = undefined
    else if (Number.isFinite(patch.monthly) && patch.monthly >= 1 && patch.monthly <= 31) {
      r.monthly = Number(patch.monthly)
      r.date = undefined; r.annual = undefined; r.lunar = undefined; r.weekdays = []
    }
    if (typeof patch.date === 'string' && patch.date) {
      if (!isRealDate(patch.date)) throw new Error('日期不存在:' + patch.date)
      r.date = patch.date
      r.weekdays = []; r.annual = undefined; r.lunar = undefined; r.monthly = undefined
    }
    if (patch.date === null) r.date = undefined
    // 改了时间点/周期 = 用户还想让它响,今天的静音作废
    const touchedSchedule = patch.time !== undefined || Array.isArray(patch.weekdays) || patch.date !== undefined
      || patch.monthly !== undefined || patch.annual !== undefined || patch.lunar !== undefined
    if (touchedSchedule) r.silencedDates = []
    if (typeof patch.yearly === 'boolean') r.yearly = patch.yearly
    if (typeof patch.calendar === 'string') r.calendar = patch.calendar === 'lunar' ? 'lunar' : 'solar'
    r.updatedAt = Date.now()
    this.save()
    return r
  }

  /** 删除 = 移入垃圾箱(可恢复)。要真删用 purgeReminder。 */
  deleteReminder(id) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    r.deletedAt = Date.now()
    r.active = false
    r.updatedAt = Date.now()
    // 未确认的告警一起撤掉,别在删完还弹
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && !a.acked))
    this.save()
    return { trashed: id, id, title: r.title }
  }

  /** 从垃圾箱恢复。 */
  restoreReminder(id) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    r.deletedAt = 0
    r.active = true
    r.updatedAt = Date.now()
    this.save()
    return r
  }

  /** 彻底删除(不可恢复)。 */
  purgeReminder(id) {
    const before = this.data.reminders.length
    const target = this.data.reminders.find((r) => r.id === id)
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id)
    if (this.data.reminders.length === before) throw new Error('找不到提醒 ' + id)
    this.data.alerts = this.data.alerts.filter((a) => a.refId !== id)
    this.dropFiles(target && target.files)
    this.save()
    return { purged: id, id }
  }

  /** 提醒分档计数(给界面用)。 */
  reminderCounts() {
    const rs = this.data.reminders
    const trashed = rs.filter((r) => (r.deletedAt || 0) > 0).length
    return { active: rs.length - trashed, trash: trashed }
  }

  /** 今日签到(可补签某天:date 传 YYYY-MM-DD)。 */
  checkin(id, date) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const day = date ? String(date).slice(0, 10) : localYmd()
    if (!r.doneDates.includes(day)) r.doneDates.push(day)
    if (r.doneDates.length > MAX_CHECKINS) r.doneDates = r.doneDates.slice(-MAX_CHECKINS)
    r.silencedDates = (r.silencedDates || []).filter((d) => d !== day)
    r.snoozeUntil = 0
    r.updatedAt = Date.now()
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && a.date === day))
    this.save()
    return { reminder: r, date: day }
  }

  /** 取消今天(或指定某天)的签到。 */
  uncheckin(id, date) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const day = date ? String(date).slice(0, 10) : localYmd()
    r.doneDates = (r.doneDates || []).filter((d) => d !== day)
    r.updatedAt = Date.now()
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && a.date === day))
    this.save()
    return { reminder: r, date: day }
  }

  /** 静音到某个时刻(点「稍后提醒」)。 */
  snooze(id, minutes, nowMs = Date.now()) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const min = Number.isFinite(minutes) ? Math.max(1, Math.min(720, minutes)) : r.snoozeMin || 20
    r.snoozeUntil = nowMs + min * 60000
    // 点「稍后」就是要它再响一次,今天的静音先解除
    r.silencedDates = (r.silencedDates || []).filter((d) => d !== localYmd(new Date(nowMs)))
    this.save()
    return r
  }

  /** 今日各提醒状态(给 UI / Agent 看)。 */
  todayView(now = new Date()) {
    const today = localYmd(now)
    return this.data.reminders
      .filter((r) => !((r.deletedAt || 0) > 0))   // 垃圾箱里的不进主列表
      .map((r) => {
        // 用 nextOccurrence:生日/周几的提前量会跨天,occurrenceOf 只认"今天"
        let occ = nextOccurrence(r, now)
        // 一次性提醒今天的时间已经过了:nextOccurrence 说「没有下一次」,
        // 但 tick 当天还会补一张告警 —— 两边说法要一致,别一个「到点了」一个「没有下一次」。
        if (!occ) { const todayAt = occurrenceOf(r, now); if (todayAt) occ = todayAt }
        const dueDate = occ ? localYmd(occ) : today
        const done = (r.doneDates || []).includes(dueDate)
        const doneToday = (r.doneDates || []).includes(today)
        let status = 'idle'
        if (!r.active) status = 'paused'
        else if (done) status = 'done'
        // 登记之前就已经过去的点:今天不吵,理由挂在 startTomorrow 上给界面用。
        else if (occ && localYmd(occ) === today && beforeCreated(r, occ, now.getTime())) status = 'silenced'
        else if (occ && localYmd(occ) === today && (r.silencedDates || []).includes(today)) status = 'silenced'
        else if (!occ) status = r.date && r.date < today ? 'expired' : 'no-next'
        else if (now.getTime() >= occ.getTime() - (r.leadMin || 0) * 60000) status = 'pending'
        else status = 'upcoming'
        return {
          ...r,
          today,
          dueDate,
          startTomorrow: beforeCreated(r, occ, now.getTime()),
          done: done || doneToday,
          occurrenceAt: occ ? occ.getTime() : null,
          status,
          secondsLeft: occ ? Math.round((occ.getTime() - now.getTime()) / 1000) : null,
        }
      })
  }

  /**
   * 主循环:算出该不该弹提醒。
   * 返回这一轮新增的告警数(便于日志)。
   */
  tick(nowMs = Date.now(), opts = {}) {
    const now = new Date(nowMs)
    const today = localYmd(now)
    let created = 0
    let mutated = false
    const alerts = this.data.alerts
    for (const r of this.data.reminders) {
      if ((r.deletedAt || 0) > 0) continue      // 垃圾箱里的不提醒
      if (!r.active) continue
      let occ = nextOccurrence(r, now)          // 生日提前 3 天也要能算出来
      if (!occ) {
        // 一次性提醒的时间今天已经过了,nextOccurrence 会说「没有下一次」。
        // 于是「早上八点关机、晚上才开 DSH」就永远收不到 —— 当天内补一张。
        const todayAt = occurrenceOf(r, now)
        if (todayAt && todayAt.getTime() <= nowMs) occ = todayAt
      }
      if (!occ) continue
      const dueDate = localYmd(occ)
      if ((r.doneDates || []).includes(dueDate) || (r.doneDates || []).includes(today)) continue
      // 「知道了」= 今天这条不再提。之前 ack 只标记那条 alert,tick 20 分钟后又造一条新的,
      // 按钮写着「不再提醒」却在弹 —— 现在按日期记在提醒上。
      if ((r.silencedDates || []).includes(today)) continue
      // 这次的点早于登记时间(超过 5 分钟宽限):本来就不存在,不补「错过」。
      if (!r.date && beforeCreated(r, occ, nowMs)) continue
      const dueFrom = occ.getTime() - (r.leadMin || 0) * 60000
      if (nowMs < dueFrom) continue
      if (r.snoozeUntil && nowMs < r.snoozeUntil) continue
      const sameDay = alerts.filter((a) => a.refId === r.id && a.date === today)
      const last = sameDay.sort((a, b) => b.at - a.at)[0]
      // 同一条还没被确认:就地更新,不要再叠一张。
      // 以前逾期后每 snoozeMin 分钟 push 一条新的,十分钟后右下角就有三张一模一样的卡片。
      // 确认过的那张会被 silencedDates 挡住一整天,唯一还会再建新卡的是「稍后」到点。
      if (last && !last.acked) {
        if (nowMs >= occ.getTime() && !last.over) { last.over = true; mutated = true }
        if (r.snoozeUntil && nowMs >= r.snoozeUntil) { r.snoozeUntil = 0; mutated = true }
        continue
      }
      // 没有卡片,或者上一张已经确认过(「稍后」到点):建一张新的
      if (!last || last.acked) {
        alerts.push({
          id: uid('a-'),
          kind: 'reminder',
          refId: r.id,
          date: today,
          dueDate,
          title: r.title,
          text: r.note || '',
          at: nowMs,
          dueAt: occ.getTime(),
          over: nowMs >= occ.getTime(),
          // 超过一分钟才算「错过」(开机补算的、当天补的一次性提醒都走这条),
          // 界面上写「计划几点」,而不是假装刚刚到点。
          late: nowMs - dueFrom >= 60000,
          acked: false,
        })
        created++
      }
    }
    // 清理 7 天前的告警
    const cutoff = nowMs - ALERT_KEEP_MS
    this.data.alerts = alerts.filter((a) => a.at >= cutoff).slice(-300)
    // 到期的垃圾箱/孤儿附件:每 6 小时最多跑一次,不用等用户点
    let swept = null
    if (nowMs - (this.data.settings.lastSweepAt || 0) > 6 * 3600 * 1000) {
      try { swept = this.sweepTrash({ nowMs }) } catch { /* 清理失败不能连累提醒 */ }
    }
    if (created || mutated || swept) this.save()
    return created
  }

  ackAlert(id) {
    const a = this.data.alerts.find((x) => x.id === id)
    if (!a) return { acked: false }
    a.acked = true
    a.ackedAt = Date.now()
    // 同一天的其它未读也一起收掉,否则点一条还剩三条同标题的
    for (const other of this.data.alerts) {
      if (other.refId && other.refId === a.refId && other.date === a.date && !other.acked) {
        other.acked = true
        other.ackedAt = a.ackedAt
      }
    }
    if (a.refId && a.date) {
      const r = this.data.reminders.find((x) => x.id === a.refId)
      if (r) {
        r.silencedDates = Array.isArray(r.silencedDates) ? r.silencedDates : []
        if (!r.silencedDates.includes(a.date)) r.silencedDates.push(a.date)
        if (r.silencedDates.length > MAX_CHECKINS) r.silencedDates = r.silencedDates.slice(-MAX_CHECKINS)
        // 「今天点已过,明天开始」只在登记当天成立;之后自己点「知道了」不该再挂这句话
        r.startTomorrow = false
      }
    }
    this.save()
    return { acked: true, id, date: a.date || null }
  }

  ackAll() {
    const now = Date.now()
    const today = localYmd()
    for (const a of this.data.alerts) {
      if (a.acked) continue
      a.acked = true
      a.ackedAt = now
      // 「全部知道了」和单条 X 一样:今天不再提这些(否则 20 分钟后又是一堆卡片)
      if (a.refId && a.date) {
        const r = this.data.reminders.find((x) => x.id === a.refId)
        if (r) {
          r.silencedDates = Array.isArray(r.silencedDates) ? r.silencedDates : []
          if (!r.silencedDates.includes(a.date)) r.silencedDates.push(a.date)
          if (r.silencedDates.length > MAX_CHECKINS) r.silencedDates = r.silencedDates.slice(-MAX_CHECKINS)
          r.startTomorrow = false
        }
      }
    }
    this.data.alerts = this.data.alerts.filter((a) => a.at >= now - ALERT_KEEP_MS).slice(-300)
    void today
    this.save()
    return { acked: true, at: now }
  }

  /** 「全部知道了」的撤销:5 分钟内点撤销,把刚确认的那批恢复未读并解除当天静音。 */
  unackAll() {
    const now = Date.now()
    let restored = 0
    for (const a of this.data.alerts) {
      if (!a.acked || now - (a.ackedAt || 0) > 5 * 60000) continue
      a.acked = false
      a.ackedAt = 0
      restored++
      if (a.refId && a.date) {
        const r = this.data.reminders.find((x) => x.id === a.refId)
        if (r) r.silencedDates = (r.silencedDates || []).filter((d) => d !== a.date)
      }
    }
    this.save()
    return { restored }
  }

  pendingAlerts() {
    return this.data.alerts.filter((a) => !a.acked).sort((a, b) => b.at - a.at)
  }


  // ---------------- 网页收藏 ----------------

  /** 网址归一化:没写协议补 https://,顺手把跟踪参数和末尾斜杠去掉。 */
  static normalizeUrl(input) {
    let u = String(input || '').trim()
    if (!u) throw new Error('网址不能为空')
    if (!/^https?:\/\//i.test(u)) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]|$)/i.test(u)) throw new Error('网址看起来不对:' + u)
      u = 'https://' + u
    }
    let url
    try { url = new URL(u) } catch { throw new Error('网址看起来不对:' + u) }
    // 网址里带 user:pass 会明文躺进 data.json,书签也用不上,直接丢掉
    if (url.username || url.password) { url.username = ''; url.password = '' }
    // www 和不带 www 视为同一个站点(同一个页面存两遍的常见来源)
    if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4)
    // 常见的分享跟踪参数留着没用,反而让同一条链接存两遍
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|share_|ref$|fbclid$|gclid$)/i.test(k)) url.searchParams.delete(k)
    }
    let out = url.toString()
    if (out.endsWith('/') && !url.search && !url.hash) out = out.slice(0, -1)
    return out.slice(0, 2000)
  }

  /** 分类名归一化:去掉首尾空白和符号,空 = 未分类。 */
  static normalizeGroup(input) {
    return String(input || '').trim().replace(/^[#\s]+/, '').replace(/\s+/g, ' ').slice(0, 24)
  }

  /** 保险库合集名:只做轻量清洗,不强迫用户拆字段。 */
  static normalizeCollection(input) {
    return String(input || '').trim().replace(/^[#\s]+/, '').replace(/\s+/g, ' ').slice(0, 32)
  }

  /** 网页:一条一条存的常用入口(手机桌面那种格子)。 */
  addLink(input = {}) {
    const url = DeskStore.normalizeUrl(input.url)
    const now = Date.now()
    const title = String(input.title || '').trim().slice(0, 80) || hostOf(url)
    const link = {
      id: uid('w-'),
      title,
      url,
      group: DeskStore.normalizeGroup(input.group),
      icon: String(input.icon || '').trim().slice(0, 400),
      note: String(input.note || '').slice(0, 2000),
      pinned: !!input.pinned,
      hits: 0,
      lastOpenedAt: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: 0,
    }
    // 同一条链接不存两遍:已经有了就把它顶回前面(顺手补上分类/图标)
    const same = this.data.links.find((x) => !((x.deletedAt || 0) > 0) && x.url === url)
    if (same) {
      if (link.group && !same.group) same.group = link.group
      if (link.icon && !same.icon) same.icon = link.icon
      if (input.title && !same.title) same.title = link.title
      // 同一条链接又补了一句用途:别把备注丢了,也别把旧的一句顶掉
      if (link.note && !same.note) same.note = link.note
      else if (link.note && !same.note.includes(link.note) && same.note.length < 200) same.note = (same.note + ' · ' + link.note).slice(0, 2000)
      same.updatedAt = now
      this.save()
      return { ...same, deduped: true }
    }
    this.data.links.unshift(link)
    this.save()
    return link
  }

  updateLink(id, patch = {}) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) throw new Error('找不到网页 ' + id)
    if (typeof patch.title === 'string' && patch.title.trim()) x.title = patch.title.trim().slice(0, 80)
    if (typeof patch.url === 'string') {
      const url = DeskStore.normalizeUrl(patch.url)
      const clash = this.data.links.find((l) => l.id !== id && !((l.deletedAt || 0) > 0) && l.url === url)
      if (clash) throw new Error('这个网址已经收过了:' + clash.title)
      x.url = url
    }
    if (patch.group !== undefined) x.group = DeskStore.normalizeGroup(patch.group)
    if (typeof patch.icon === 'string') x.icon = patch.icon.trim().slice(0, 400)
    if (typeof patch.note === 'string') x.note = patch.note.slice(0, 2000)
    if (typeof patch.pinned === 'boolean') x.pinned = patch.pinned
    x.updatedAt = Date.now()
    this.save()
    return x
  }

  // ---------------- 转存:分错了自己挪 ----------------

  /** 找一条原始记录(note/link/reminder/secret)。 */
  findAny(kind, id) {
    const list = kind === 'note' ? this.data.notes
      : kind === 'link' ? this.data.links
        : kind === 'reminder' ? this.data.reminders
          : kind === 'secret' ? null : null
    if (kind === 'secret') return this.getSecret(id)
    if (!list) throw new Error('不认识的分类:' + kind)
    return list.find((x) => x.id === id) || null
  }

  /**
   * 把一条记录搬到另一个分类(自动分类分错了,用户自己挪)。
   * 便签/网页/提醒搬走时原条目进垃圾箱;保险库没有垃圾箱 ——
   * 没密码的直接删(内容已经在目标里),带密码的不许搬去明文分类。
   */
  convertItem(kind, id, to) {
    const NAMES = { note: '便签', link: '网页', secret: '保险库', reminder: '提醒' }
    const from = String(kind || '')
    const target = String(to || '')
    if (!NAMES[from]) throw new Error('不认识的分类:' + from)
    if (!NAMES[target]) throw new Error('不认识的分类:' + target)
    if (from === target) throw new Error('它已经在' + NAMES[from] + '里了')
    const src = this.findAny(from, id)
    if (!src) throw new Error('找不到这条' + NAMES[from])

    let title = ''
    let url = ''
    let note = ''
    let text = ''
    let username = ''
    let password = ''
    if (from === 'note') {
      text = String(src.text || '')
      url = (text.match(/https?:\/\/[^\s,，。；]+/i) || [''])[0] || urlInText(text)
      title = titleFromText(text, url)
      // 网址已经是单独一个字段,备注里不用再重复一遍
      note = url
        ? text.split('\n').map((l) => l.split(url).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
        : text
    } else if (from === 'link') {
      title = src.title || ''
      url = src.url || ''
      note = src.note || ''
      text = [title, note, url].filter(Boolean).join('\n')
    } else if (from === 'reminder') {
      title = src.title || ''
      note = src.note || ''
      url = src.url || ''
      text = [title, note].filter(Boolean).join('\n')
    } else if (from === 'secret') {
      title = src.title || ''
      url = String(src.fields['网址'] || '') || urlInText([src.title, src.note, src.fields['内容']].filter(Boolean).join(' '))
      username = String(src.fields['用户名'] || '')
      password = String(src.fields['密码'] || '')
      note = src.note || String(src.fields['内容'] || '')
      // 明文便签 / 网页备注里放密码等于把保险库白开了
      if (password) throw new Error('这条里有密码,不能搬到明文的地方;要挪的话先在保险库里删掉密码')
      text = [title, note, url].filter(Boolean).join('\n')
    }

    // 附件要先算好:目标记录创建时就带上,免得建完再补(补不上就丢)
    const carried = this.filesFor(from, id).map((f) => f.id)
    let item
    if (target === 'link') {
      if (!url) throw new Error('这条里没有网址,存不成网页')
      item = this.addLink({ title, url, note: note.slice(0, 300), group: '' })
      // 撞上已有条目时把说明补进去,别让备注白丢
      if (item.deduped && note && !item.note) item = this.updateLink(item.id, { note: note.slice(0, 300) })
    } else if (target === 'note') {
      item = this.addNote({ text: text || title || '', files: carried })
    } else if (target === 'secret') {
      // 正文走 note(和「内容」一样加密),带网址时也不会被 addSecret 丢掉
      item = this.addSecret({ title: title || '未命名条目', username, password, url, note: text || note || title, body: text || note || title, files: carried })
    } else {
      item = this.addReminder({
        title: title || '提醒',
        time: '09:00',
        leadMin: 0,
        note: [note, url].filter(Boolean).join(' ').slice(0, 500),
        url,
      })
    }

    // 附件跟着搬:便签/提醒/网页之间挪是明文对明文,只在保险库进出时重新加解密
    if (carried.length && item && item.id) {
      const outOfVault = from === 'secret' && target !== 'secret'
      for (const fid of carried) {
        try {
          if (outOfVault) this.setFileSecret(fid, false)
          this.attachFiles(target, item.id, [fid])
          // 目标记录自己也要记住这些 id(便签行就是按 n.files 渲染缩略图的)
          item.files = [...new Set([...(item.files || []), fid])]
        } catch { /* 单个搬不动就先留在原处,原条目删除前会把它一起清掉 */ }
      }
      // secret 的删除在下面统一做,这里不能提前 drop
    }

    if (from === 'note') { this.deleteNote(id); this.attachCarried(id, item, target) }
    else if (from === 'link') { this.deleteLink(id); this.attachCarried(id, item, target) }
    else if (from === 'reminder') { this.deleteReminder(id); this.attachCarried(id, item, target) }
    else this.deleteSecret(id)

    return { item, from, to: target, merged: !!item.deduped, files: carried.length }
  }

  /**
   * 转存后收尾:原条目只是移进垃圾箱(还在),孤儿清理不会误删已经挂到新家的附件。
   * 这里只处理「原条目彻底没了」的情况 —— 把已经从它名下搬走的附件记录一次,别让 id 悬空。
   */
  attachCarried(fromKind, ownerId, item, toKind) {
    if (!item || !item.id) return
    for (const f of this.data.files || []) {
      if (f.kind === fromKind && f.ownerId === ownerId) { f.kind = toKind; f.ownerId = item.id }
    }
  }

  /** 打开一次:记一笔,方便「最近用的排前面」。 */
  touchLink(id) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) return null
    x.hits = (x.hits || 0) + 1
    x.lastOpenedAt = Date.now()
    this.save()
    return { id: x.id, hits: x.hits, lastOpenedAt: x.lastOpenedAt }
  }

  /** 看过一次便签:只记「看过」,不动 updatedAt —— 看不是改,别把排序时间戳搅乱。 */
  touchNote(id) {
    const n = this.data.notes.find((x) => x.id === id)
    if (!n) return null
    n.views = (n.views || 0) + 1
    n.lastViewedAt = Date.now()
    this.save()
    return { id: n.id, views: n.views, lastViewedAt: n.lastViewedAt }
  }

  deleteLink(id) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) throw new Error('找不到网页 ' + id)
    x.deletedAt = Date.now()
    x.pinned = false
    x.updatedAt = Date.now()
    this.save()
    return { trashed: x.id, id: x.id }
  }

  restoreLink(id) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) throw new Error('找不到网页 ' + id)
    // 删掉之后又把同一个网址加回来了:恢复时合并进现有那条,不然会有两条一样的
    const clash = this.data.links.find((l) => l.id !== id && !((l.deletedAt || 0) > 0) && l.url === x.url)
    if (clash) {
      if (!clash.group && x.group) clash.group = x.group
      if (!clash.icon && x.icon) clash.icon = x.icon
      if (!clash.note && x.note) clash.note = x.note
      clash.pinned = clash.pinned || x.pinned
      clash.updatedAt = Date.now()
      this.data.links = this.data.links.filter((l) => l.id !== id)
      this.save()
      return { ...clash, merged: true }
    }
    x.deletedAt = 0
    x.updatedAt = Date.now()
    this.save()
    return x
  }

  purgeLink(id) {
    const before = this.data.links.length
    this.data.links = this.data.links.filter((l) => l.id !== id)
    if (this.data.links.length === before) throw new Error('找不到网页 ' + id)
    this.save()
    return { purged: id }
  }

  /** 活跃网页:置顶 → 最近打开 → 新收的在前。 */
  listLinks(view = 'all') {
    const sort = (a, b) => byAttention(a, b, Date.now())
    if (view === 'trash') {
      return this.data.links.filter((l) => (l.deletedAt || 0) > 0).sort((a, b) => b.deletedAt - a.deletedAt)
    }
    return this.data.links.filter((l) => !((l.deletedAt || 0) > 0)).sort(sort)
  }

  /** 分类列表:按条数从多到少,未收分类的单独算。 */
  linkGroups() {
    const counts = new Map()
    let ungrouped = 0
    for (const l of this.listLinks()) {
      const g = l.group || ''
      if (!g) { ungrouped++; continue }
      counts.set(g, (counts.get(g) || 0) + 1)
    }
    const groups = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { groups, ungrouped }
  }

  linkCounts() {
    const links = this.data.links
    const trash = links.filter((l) => (l.deletedAt || 0) > 0).length
    return { active: links.length - trash, trash }
  }

  // ---------------- 导入 ----------------

  /**
   * 从导出的 JSON 还原。两种模式:
   *   merge   按 id 去重,本地优先 —— 合并两份机器上的数据用这个
   *   replace 整份替换(会先把当前 data.json 另存一份 .before-import-<时间>)
   *
   * 保险库条目逐条用**本机钥匙**试解:解不开的(换过 vault.key)整条跳过并计数,
   * 不塞进来假装成功 —— 否则列表里会出现一条永远打不开的条目。
   */
  importBackup(input, opts = {}) {
    const backup = input && input.backup ? input.backup : input
    if (!backup || typeof backup !== 'object') throw new Error('这不是一份备份文件')
    if (backup.kind !== 'dsh-desk-kit-backup') throw new Error('文件不像是随手台的备份(缺少 kind 标记)')
    if (Number(backup.version) !== 1) throw new Error('备份版本不认识:' + backup.version)
    const mode = opts.mode === 'replace' ? 'replace' : 'merge'
    if (mode === 'replace' && opts.confirm !== true) throw new Error('整体替换要先确认(confirm: true)')

    const incoming = backup.data && typeof backup.data === 'object' ? backup.data : {}
    const now = Date.now()
    const report = { mode, added: { notes: 0, reminders: 0, links: 0, files: 0, alerts: 0, secrets: 0 }, skipped: 0, locked: 0, missingBlobs: 0, backupFile: '' }

    if (mode === 'replace') {
      // 先把现在这份存起来:替换是「整份盖掉」,没有回滚文件就是不可逆操作
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
      const keep = join(this.root, 'data.json.before-import-' + stamp)
      try {
        mkdirSync(this.root, { recursive: true })
        writeFileSync(keep, JSON.stringify(this.data, null, 2))
        report.backupFile = keep
      } catch { /* 写不了回滚文件就别替换 —— 下面这行会抛 */ }
      if (!report.backupFile) throw new Error('没法先备份现有数据,停止替换')
      this.data.notes = []
      this.data.reminders = []
      this.data.links = []
      this.data.files = []
      this.data.alerts = []
    }

    const mergeList = (key, list, countKey) => {
      if (!Array.isArray(list)) return
      const seen = new Set((this.data[key] || []).map((x) => x && x.id))
      for (const item of list) {
        // 先归一化:缺字段/坏时间/坏日期的条目跳过并计数,不让坏数据进库
        const clean = normalizeImported(key, item, now)
        if (!clean) { report.skipped++; continue }
        if (seen.has(clean.id)) { report.skipped++; continue }
        seen.add(clean.id)
        this.data[key].push(clean)
        if (countKey) report.added[countKey]++
      }
    }
    mergeList('notes', incoming.notes, 'notes')
    mergeList('reminders', incoming.reminders, 'reminders')
    mergeList('links', incoming.links, 'links')
    mergeList('alerts', incoming.alerts, 'alerts')
    mergeList('files', incoming.files, 'files')

    // 导入也要遵守本地的上限:便签超出活动上限转归档(不丢数据),
    // 附件记录超出总数上限就丢弃多出来的元信息并报数。
    if (this.data.notes.length > MAX_NOTES) {
      for (const old of this.data.notes.slice(MAX_NOTES)) old.archived = true
    }
    if (this.data.files.length > MAX_FILES) {
      report.skipped += this.data.files.length - MAX_FILES
      this.data.files.length = MAX_FILES
    }

    // 附件:记录进来了,原件不一定在(导出不含 blobs/)
    for (const f of this.data.files || []) {
      // 手改过的 data.json 可能带 ../ 之类的 id:只标缺原件,绝不按它去拼路径
      if (!isBlobId(f.id)) { f.missingBlob = true; continue }
      if (!existsSync(this.blobFile(f.id, !!f.secret))) { f.missingBlob = true; report.missingBlobs++ }
      else if (f.missingBlob) delete f.missingBlob
    }

    // 设置:替换时被备份覆盖(清理时间这类运行状态保留本机的)
    if (incoming.settings && typeof incoming.settings === 'object') {
      const keepSweep = this.data.settings.lastSweepAt
      this.data.settings = { ...this.data.settings, ...incoming.settings, lastSweepAt: keepSweep }
    }

    // 保险库:密文逐条试解,解得开才收
    const vin = backup.vault && Array.isArray(backup.vault.entries) ? backup.vault : null
    if (vin) {
      const vault = this.vaultRaw()
      // 保险库的盐在 vault.json 里,密钥材料在 vault.key。还原到一台新机器时,
      // 本机密钥是新生成的 —— 只有把备份的盐一并接手,用户拷过来的 vault.key 才对得上。
      // 本机已有条目时绝不能换盐(会把它们变成解不开的废文)。
      if (vin.kdf && vin.kdf.salt) {
        const empty = mode === 'replace' || vault.entries.length === 0
        if (empty && vin.kdf.salt !== vault.kdf.salt) {
          vault.kdf = vin.kdf
          this._mk = null
          this._mkSalt = ''
          // 先落盘:masterKey() 是重新读盘的,不写下去校验用的还是旧盐
          writeJson(this.vaultFile, vault)
        }
      }
      const seen = new Set(vault.entries.map((e) => e.id))
      if (mode === 'replace') { vault.entries = []; seen.clear() }
      for (const entry of vin.entries) {
        if (!entry || !entry.id) { report.skipped++; continue }
        if (seen.has(entry.id)) { report.skipped++; continue }
        try {
          this.decryptPayload(entry)      // 只是验证:解不开就别塞进来
        } catch {
          report.locked++
          continue
        }
        entry.collection = DeskStore.normalizeCollection(entry.collection)
        entry.order = Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0
        vault.entries.push(entry)
        seen.add(entry.id)
        report.added.secrets++
      }
      writeJson(this.vaultFile, vault)
    }

    this.save()
    report.total = Object.values(report.added).reduce((n, v) => n + v, 0)
    return report
  }

  // ---------------- 查找 / 用量 / 清理 ----------------

  /**
   * 一次搜全库:便签、提醒、网页、附件、保险库标题。
   *
   * 为什么要有:分开搜意味着用户得记住「那句话我记在哪一格了」——
   * 而随手记的东西,恰恰是记不清才记的。这里只返回**定位**(kind + id + 命中字段),
   * 具体内容去对应的页面看,不在搜索结果里再拼一份。
   */
  searchAll(query, opts = {}) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return { query: '', hits: [], total: 0 }
    const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50))
    const variants = searchVariants(q)
    const hits = []
    const add = (kind, id, title, where, extra) => {
      hits.push({ kind, id, title: String(title || '').slice(0, 200), where, ...(extra || {}) })
    }
    const inText = (text) => searchMatch(text, variants)

    for (const n of this.data.notes || []) {
      if ((n.deletedAt || 0) > 0 && !opts.includeTrash) continue
      const where = []
      if (inText(n.text)) where.push('正文')
      if ((n.tags || []).some((t) => String(t).toLowerCase().includes(q))) where.push('标签')
      if (where.length) add('note', n.id, n.text || '（图片）', where.join('/'), { trashed: (n.deletedAt || 0) > 0 })
    }
    for (const r of this.data.reminders || []) {
      if ((r.deletedAt || 0) > 0 && !opts.includeTrash) continue
      const where = []
      if (inText(r.title)) where.push('标题')
      if (inText(r.note)) where.push('备注')
      if (where.length) add('reminder', r.id, r.title, where.join('/'), { trashed: (r.deletedAt || 0) > 0 })
    }
    for (const l of this.data.links || []) {
      if ((l.deletedAt || 0) > 0 && !opts.includeTrash) continue
      const where = []
      if (inText(l.title)) where.push('标题')
      if (inText(l.url)) where.push('网址')
      if (inText(l.note)) where.push('备注')
      if (inText(l.group)) where.push('分类')
      if (where.length) add('link', l.id, l.title || l.url, where.join('/'), { trashed: (l.deletedAt || 0) > 0 })
    }
    // 附件:按文件名找。名字记不清也能靠「截图 2026」这种前缀捞到
    for (const f of this.data.files || []) {
      if (f.secret) continue          // 保险库名下的附件不在全局出现,免得标题泄漏
      if (!inText(f.name)) continue
      add('file', f.id, f.name, '文件名', { ownerKind: f.kind, ownerId: f.ownerId, mime: f.mime, size: f.size })
    }
    // 保险库:默认只搜标题。
    // deepVault 是用户显式点「在内容里找」才走:解密只发生在内存里,
    // 结果仍只回 id/标题/命中位置,不把字段值带出去。
    const vaultEntries = this.vaultRaw().entries
    // 深搜时先取一次钥匙,避免每条都重复 scrypt/读盘(100 条就是 100 次)
    const vaultKey = opts.deepVault ? this.masterKey() : null
    for (const e of vaultEntries) {
      const where = []
      if (inText(e.title)) where.push('标题')
      if (inText(DeskStore.normalizeCollection(e.collection))) where.push('合集')
      if (opts.deepVault && !where.length) {
        try {
          const payload = this.decryptPayload(e, vaultKey)
          if (inText(payload.note)) where.push('内容')
          if (!where.length) {
            for (const [k, v] of Object.entries(payload.fields || {})) {
              if (inText(k) || inText(v)) { where.push('内容'); break }
            }
          }
        } catch { /* 解不开的条目跳过,不能拖垮整次搜索 */ }
      }
      if (where.length) add('secret', e.id, e.title, where.join('/'), {})
    }
    hits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind.localeCompare(b.kind)))
    return { query: q, hits: hits.slice(0, limit), total: hits.length }
  }

  /** 一个便签/提醒/网页/保险库条目名下的附件(按 id 找,不看 kind)。 */
  filesOfAny(kind, id) {
    return this.filesFor(kind, id)
  }

  /**
   * 垃圾箱到期表:快照、用量卡片、清理预览共用同一份算法。
   * 以前 snapshot() 和 storage() 各写一遍,改了保留天数规则很容易只改到一半。
   */
  trashEntries(nowMs = Date.now()) {
    const keep = Number(this.data.settings.trashKeepDays ?? 30)
    const dueAt = (deletedAt) => (keep > 0 ? (deletedAt || 0) + keep * 86400000 : 0)
    const out = []
    const push = (kind, item) => {
      const at = dueAt(item.deletedAt)
      out.push({
        kind, id: item.id,
        title: String(item.title || item.text || item.url || '').slice(0, 80),
        deletedAt: item.deletedAt || 0,
        dueAt: at,
        daysLeft: at ? Math.max(0, Math.ceil((at - nowMs) / 86400000)) : null,
      })
    }
    for (const n of this.data.notes) if ((n.deletedAt || 0) > 0) push('note', n)
    for (const r of this.data.reminders) if ((r.deletedAt || 0) > 0) push('reminder', r)
    for (const l of this.data.links) if ((l.deletedAt || 0) > 0) push('link', l)
    return out.sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
  }

  /** 磁盘用量与「有什么在等着被清」。设置页那张卡片就靠它。 */
  storage(nowMs = Date.now()) {
    const sizeOf = (file) => {
      try { return statSync(file).size } catch { return 0 }
    }
    let blobBytes = 0
    let blobCount = 0
    try {
      for (const name of readdirSync(this.blobDir)) {
        blobBytes += sizeOf(join(this.blobDir, name))
        blobCount++
      }
    } catch { /* 目录还没建 */ }
    const trash = this.trashEntries(nowMs)
    // 「传上来一直没挂上」的临时附件:一天后会被清
    const strayFiles = (this.data.files || []).filter((f) => !f.kind)
    const orphans = (this.data.files || []).filter((f) => {
      if (!f.kind) return false
      const set = {
        note: this.data.notes, reminder: this.data.reminders, link: this.data.links,
      }[f.kind]
      if (f.kind === 'secret') return false
      return !set || !set.some((x) => x.id === f.ownerId)
    })
    return {
      bytes: {
        data: sizeOf(this.dataFile),
        vault: sizeOf(this.vaultFile),
        key: sizeOf(this.keyFile),
        blobs: blobBytes,
        total: sizeOf(this.dataFile) + sizeOf(this.vaultFile) + sizeOf(this.keyFile) + blobBytes,
      },
      counts: {
        notes: this.data.notes.length,
        notesTrashed: this.data.notes.filter((n) => (n.deletedAt || 0) > 0).length,
        reminders: this.data.reminders.length,
        remindersTrashed: this.data.reminders.filter((r) => (r.deletedAt || 0) > 0).length,
        links: this.data.links.length,
        linksTrashed: this.data.links.filter((l) => (l.deletedAt || 0) > 0).length,
        secrets: this.vaultRaw().entries.length,
        files: (this.data.files || []).length,
        blobFiles: blobCount,
        strayFiles: strayFiles.length,
        orphanFiles: orphans.length,
        alerts: this.data.alerts.length,
      },
      trash,
      // 现在就到期、下次清理真的会动的条数(垃圾箱里「还有 20 天」的不算)
      trashDueNow: trash.filter((t) => t.daysLeft === 0).length,
      trashKeepDays: Number(this.data.settings.trashKeepDays ?? 30),
      lastSweepAt: this.data.settings.lastSweepAt || 0,
      dir: this.root,
    }
  }

  /**
   * 清理。三类东西,分开算:
   *   1. 垃圾箱里超过保留天数的记录(连附件原件一起删)
   *   2. 宿主已经不存在的附件
   *   3. 传上来一天还没挂上的临时附件
   *
   * 保险库没有垃圾箱 —— 删就是删,不参与自动清理(不能替用户做这个决定)。
   * 返回每一类清了什么,方便回执说人话。
   */
  sweepTrash({ nowMs = Date.now(), keepDays = null } = {}) {
    const keep = Number.isFinite(Number(keepDays)) ? Number(keepDays) : Number(this.data.settings.trashKeepDays ?? 30)
    const cutoff = keep > 0 ? nowMs - keep * 86400000 : 0
    const done = { notes: 0, reminders: 0, links: 0, alerts: 0, files: 0, bytes: 0, keepDays: keep }

    const dropNote = (n) => {
      for (const id of n.files || []) {
        const rec = (this.data.files || []).find((f) => f.id === id)
        if (rec) done.bytes += rec.size || 0
      }
      this.dropFiles(n.files)
      done.notes++
    }
    if (cutoff) {
      const keepNotes = []
      for (const n of this.data.notes) {
        if ((n.deletedAt || 0) > 0 && n.deletedAt <= cutoff) dropNote(n)
        else keepNotes.push(n)
      }
      this.data.notes = keepNotes

      const keepRem = []
      for (const r of this.data.reminders) {
        if ((r.deletedAt || 0) > 0 && r.deletedAt <= cutoff) {
          this.dropFiles(r.files)
          this.data.alerts = this.data.alerts.filter((a) => a.refId !== r.id)
          done.reminders++
        } else keepRem.push(r)
      }
      this.data.reminders = keepRem

      const keepLinks = []
      for (const l of this.data.links) {
        if ((l.deletedAt || 0) > 0 && l.deletedAt <= cutoff) { this.dropFiles(l.files); done.links++ }
        else keepLinks.push(l)
      }
      this.data.links = keepLinks
    }

    // 告警本身也有寿命,顺手清
    const alertCutoff = nowMs - ALERT_KEEP_MS
    const beforeAlerts = this.data.alerts.length
    this.data.alerts = this.data.alerts.filter((a) => a.at >= alertCutoff)
    done.alerts = beforeAlerts - this.data.alerts.length

    // 孤儿 + 临时附件(一天)
    const alive = {
      note: new Set(this.data.notes.map((n) => n.id)),
      reminder: new Set(this.data.reminders.map((r) => r.id)),
      link: new Set(this.data.links.map((l) => l.id)),
    }
    const dead = []
    for (const f of this.data.files || []) {
      const recBytes = f.size || 0
      if (!f.kind) {
        if (nowMs - (f.createdAt || 0) > 86400000) { dead.push(f.id); done.files++; done.bytes += recBytes }
        continue
      }
      if (f.kind === 'secret') continue
      const set = alive[f.kind]
      if (!set || !set.has(f.ownerId)) { dead.push(f.id); done.files++; done.bytes += recBytes }
    }
    if (dead.length) this.dropFiles(dead)
    // blobs/ 里没有记录的散件
    try {
      const known = new Set((this.data.files || []).map((f) => f.id))
      for (const name of readdirSync(this.blobDir)) {
        const id = name.replace(/\.(bin|enc)$/, '')
        if (!known.has(id)) { done.files++; try { unlinkSync(join(this.blobDir, name)) } catch { } }
      }
    } catch { /* 目录不存在 */ }

    this.data.settings.lastSweepAt = nowMs
    this.save()
    return done
  }

  /** 空手清理掉的字节数,给回执用一句人话。 */
  static humanBytes(n) {
    const v = Number(n) || 0
    if (v >= 1073741824) return (v / 1073741824).toFixed(2) + 'GB'
    if (v >= 1048576) return (v / 1048576).toFixed(1) + 'MB'
    if (v >= 1024) return Math.round(v / 1024) + 'KB'
    return v + 'B'
  }

  // ---------------- 附件 ----------------

  /** 只留真实存在、且不属于保险库的附件 id —— 垃圾 id 悄悄丢掉,不留悬空引用。 */
  pickFileIds(list) {
    if (!Array.isArray(list)) return []
    const out = []
    for (const raw of list) {
      const id = String(raw || '').trim()
      if (!id || out.includes(id)) continue
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      out.push(id)
      if (out.length >= 12) break
    }
    return out
  }

  blobFile(id, enc) {
    return join(this.blobDir, id + (enc ? '.enc' : '.bin'))
  }

  /** 保险库名下的附件:整块二进制用同一把钥匙 AES-256-GCM,格式 iv|tag|data。 */
  encryptBuffer(buf) {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(buf), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), data])
  }

  decryptBuffer(buf) {
    if (buf.length < 28) throw new Error('附件文件损坏')
    const key = this.masterKey()
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
  }

  /**
   * 收一个附件。buffer 是原始字节,name/mime 只用于显示。
   * secret=true(保险库条目)时落盘前加密,并把 mark 记在记录里。
   */
  addFile(input = {}) {
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || '')
    if (!buffer.length) throw new Error('空文件')
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error('文件太大(' + Math.round(buffer.length / 1048576) + 'MB),上限 ' + Math.round(MAX_FILE_BYTES / 1048576) + 'MB')
    }
    if ((this.data.files || []).length >= MAX_FILES) {
      throw new Error('附件已有 ' + MAX_FILES + ' 个,先清掉一些再存')
    }
    const name = String(input.name || '').trim().slice(0, 160) || '未命名文件'
    const mime = String(input.mime || '').split(';')[0].trim().toLowerCase().slice(0, 120) || 'application/octet-stream'
    const secret = !!input.secret
    const id = uid('f-')
    mkdirSync(this.blobDir, { recursive: true })
    const { w, h } = imageSize(buffer)
    writeFileSync(this.blobFile(id, secret), secret ? this.encryptBuffer(buffer) : buffer, { mode: 0o600 })
    const rec = {
      id, name, mime,
      size: buffer.length,
      w: w || 0,
      h: h || 0,
      secret,
      kind: '',
      ownerId: '',
      createdAt: Date.now(),
    }
    this.data.files.unshift(rec)
    this.save()
    return { ...rec }
  }

  /** 给浏览器/工具读原件。保险库名下的会在这里解密。 */
  readFileBytes(id) {
    const rec = (this.data.files || []).find((f) => f.id === id)
    if (!rec) throw new Error('找不到附件 ' + id)
    if (!isBlobId(rec.id)) throw new Error('附件 id 不合法')
    let buf
    try {
      buf = readFileSync(this.blobFile(rec.id, rec.secret))
    } catch {
      throw new Error('附件原件丢了(可能被手动删过)')
    }
    return { rec, bytes: rec.secret ? this.decryptBuffer(buf) : buf }
  }

  /**
   * 把附件挪进/挪出保险库:整个文件重新加解密一遍,再换掉原件。
   * 先写新文件、成功了才删旧的 —— 中途出错不会只剩半截。
   */
  setFileSecret(id, flag) {
    const rec = (this.data.files || []).find((f) => f.id === id)
    if (!rec || !isBlobId(rec.id)) return null
    const want = !!flag
    if (!!rec.secret === want) return { ...rec }
    let raw
    try { raw = readFileSync(this.blobFile(rec.id, rec.secret)) } catch { throw new Error('附件原件丢了,没法搬') }
    const plain = rec.secret ? this.decryptBuffer(raw) : raw
    const target = this.blobFile(rec.id, want)
    writeFileSync(target, want ? this.encryptBuffer(plain) : plain, { mode: 0o600 })
    try { unlinkSync(this.blobFile(rec.id, rec.secret)) } catch { }
    rec.secret = want
    this.save()
    return { ...rec }
  }

  /** 把一批附件整体设成 secret / 明文(转存时用)。 */
  setFilesSecret(ids, flag) {
    for (const id of Array.isArray(ids) ? ids : []) this.setFileSecret(String(id), flag)
  }

  /** 真删:记录 + 原件。ids 里找不到的直接跳过,别让调用方为一个空 id 报错。 */
  dropFiles(ids) {
    const list = Array.isArray(ids) ? ids.map(String) : []
    if (!list.length) return 0
    let n = 0
    for (const id of list) {
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      // id 不合法时只删记录,不按它去 unlink(否则可能删到 blobs/ 之外的同名 .bin/.enc)
      if (isBlobId(rec.id)) {
        try { unlinkSync(this.blobFile(rec.id, rec.secret)) } catch { /* 原件本来就不在了 */ }
      }
      this.data.files = this.data.files.filter((f) => f.id !== id)
      n++
    }
    if (n) this.save()
    return n
  }

  /** 把上传好的附件挂到某条便签/提醒/网页名下(先存字节、再挂,失败不会丢原件)。 */
  attachFiles(kind, ownerId, ids) {
    const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
    for (const id of list) {
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      rec.kind = String(kind || '').slice(0, 20)
      rec.ownerId = String(ownerId || '')
    }
    if (list.length) this.save()
    return this.filesFor(kind, ownerId)
  }

  /** 某条记录名下的附件(按加入顺序)。 */
  filesFor(kind, ownerId) {
    return (this.data.files || []).filter((f) => f.kind === kind && f.ownerId === ownerId).map((f) => ({ ...f }))
  }

  /**
   * 清孤儿:宿主已经不在了的附件、以及上传完就没人认领的(超过 1 天)。
   * 在 apply 时和每次 tick 里跑一次,成本 O(附件数)。
   */
  sweepFiles(nowMs = Date.now()) {
    const alive = {
      note: new Set(this.data.notes.map((n) => n.id)),
      reminder: new Set(this.data.reminders.map((r) => r.id)),
      link: new Set(this.data.links.map((l) => l.id)),
      secret: new Set(this.data.files.filter((f) => f.secret).map((f) => f.ownerId)),
    }
    const dead = []
    for (const f of this.data.files || []) {
      if (!f.kind) {
        // 传上来还没挂上的临时文件:给一天时间
        if (nowMs - (f.createdAt || 0) > 24 * 3600 * 1000) dead.push(f.id)
        continue
      }
      const set = alive[f.kind]
      if (!set) { dead.push(f.id); continue }
      if (!set.has(f.ownerId)) dead.push(f.id)
    }
    if (dead.length) this.dropFiles(dead)
    // blobs/ 里没有记录的散件(上次崩在写记录之前)
    try {
      mkdirSync(this.blobDir, { recursive: true })
      const known = new Set((this.data.files || []).map((f) => f.id))
      for (const name of readdirSync(this.blobDir)) {
        const id = name.replace(/\.(bin|enc)$/, '')
        if (!known.has(id)) { try { unlinkSync(join(this.blobDir, name)) } catch { } }
      }
    } catch { /* 目录读不到就算了 */ }
    return dead.length
  }

  /** 附件总览:给「文件」视图和工具用。 */
  listFiles({ query = '', kind = '' } = {}) {
    const q = String(query || '').trim().toLowerCase()
    return (this.data.files || [])
      .filter((f) => (kind ? f.kind === kind : true))
      .filter((f) => !q || String(f.name || '').toLowerCase().includes(q))
      .map((f) => ({ ...f }))
  }

  // ---------------- 保险库 ----------------

  vaultRaw() {
    const v = readJson(this.vaultFile, null)
    if (!v || v.v !== 1) {
      const fresh = { v: 1, kdf: { alg: 'scrypt', salt: randomBytes(16).toString('base64') }, entries: [] }
      writeJson(this.vaultFile, fresh)
      return fresh
    }
    if (!Array.isArray(v.entries)) v.entries = []
    return v
  }

  masterKey() {
    let secret = ''
    try {
      secret = readFileSync(this.keyFile, 'utf8').trim()
    } catch {
      secret = ''
    }
    if (!secret) {
      secret = randomBytes(48).toString('hex')
      mkdirSync(this.root, { recursive: true })
      writeFileSync(this.keyFile, secret, { mode: 0o600 })
      try { chmodSync(this.keyFile, 0o600) } catch { }
    }
    const vault = this.vaultRaw()
    const salt = vault.kdf.salt
    // 缓存:scrypt 一次 ~80ms,贴几张图就卡;但密钥材料换了必须重算(换机/被清掉)
    if (this._mk && this._mkSalt === salt && this._mkSecret === secret) return this._mk
    const key = scryptSync(secret, Buffer.from(salt, 'base64'), 32)
    this._mk = key
    this._mkSalt = salt
    this._mkSecret = secret
    return key
  }

  encryptPayload(payload) {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  decryptPayload(entry, key) {
    const k = key || this.masterKey()
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(entry.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'))
    const out = Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()])
    return JSON.parse(out.toString('utf8'))
  }

  /** 同一合集里下一个排序号;老数据没有 order 时从 1 开始。 */
  nextSecretOrder(collection, exceptId = '') {
    const target = DeskStore.normalizeCollection(collection)
    let max = 0
    for (const e of this.vaultRaw().entries) {
      if (exceptId && e.id === exceptId) continue
      if (DeskStore.normalizeCollection(e.collection) !== target) continue
      const n = Number(e.order)
      if (Number.isFinite(n) && n > max) max = n
    }
    return max + 1
  }

  addSecret(input = {}) {
    const title = String(input.title || '').trim()
    if (!title) throw new Error('条目标题不能为空')
    const fields = {}
    if (input.fields && typeof input.fields === 'object') {
      for (const [k, v] of Object.entries(input.fields)) {
        const key = String(k).trim()
        if (!key) continue
        const val = String(v ?? '')
        if (val) fields[key] = val.slice(0, 8000)
      }
    }
    for (const [k, v] of [['用户名', input.username], ['密码', input.password], ['网址', input.url]]) {
      if (v) fields[k] = String(v).slice(0, 8000)
    }
    // 自由正文:整段存,不拆字段(用户说"正常需求很复杂")
    const body = String(input.body || '').trim()
    if (body && !Object.keys(fields).length) fields['内容'] = body.slice(0, 8000)
    const fileIds = this.pickFileIds(input.files)
    const noteText = String(input.note || '').slice(0, 4000)
    // 只有附件、或只有一段说明,也算一条(一张截图 + 标题就是很多人的记法);
    // 转存进来的条目往往就是「标题 + 说明」,不能在这里被拦下
    if (!Object.keys(fields).length && !fileIds.length && !noteText.trim()) throw new Error('至少要有一点内容')
    const vault = this.vaultRaw()
    const now = Date.now()
    const blob = this.encryptPayload({ fields, note: String(input.note || '').slice(0, 4000), files: fileIds })
    const collection = DeskStore.normalizeCollection(input.collection)
    const entry = {
      id: uid('s-'),
      title: title.slice(0, 120),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 12) : [],
      collection,
      // 同一合集内按 order 升序;新条目先放末尾,用户可拖动重排
      order: this.nextSecretOrder(collection),
      createdAt: now,
      updatedAt: now,
      ...blob,
    }
    vault.entries.unshift(entry)
    writeJson(this.vaultFile, vault)
    // 附件在写密文成功之后才加密搬迁:先建后改,失败也不丢原件
    for (const id of fileIds) {
      try { this.setFileSecret(id, true); this.attachFiles('secret', entry.id, [id]) } catch { /* 搬不动就留在外面,数据还在 */ }
    }
    return { id: entry.id, title: entry.title, tags: entry.tags, collection: entry.collection, createdAt: now }
  }

  listSecrets() {
    return this.vaultRaw().entries.map((e) => ({
      id: e.id, title: e.title, tags: e.tags || [],
      collection: DeskStore.normalizeCollection(e.collection),
      order: Number.isFinite(Number(e.order)) ? Number(e.order) : 0,
      createdAt: e.createdAt, updatedAt: e.updatedAt,
      fieldCount: 0,
    }))
  }

  findSecret(query) {
    const q = String(query || '').trim().toLowerCase()
    const entries = this.vaultRaw().entries
    if (!q) return null
    return entries.find((e) => e.id === query) || entries.find((e) => e.title.toLowerCase() === q) || entries.find((e) => e.title.toLowerCase().includes(q))
  }

  getSecret(query) {
    const entry = this.findSecret(query)
    if (!entry) return null
    const payload = this.decryptPayload(entry)
    return {
      id: entry.id, title: entry.title, tags: entry.tags || [],
      collection: DeskStore.normalizeCollection(entry.collection),
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      fields: payload.fields || {}, note: payload.note || '',
      // 只给元信息;原件走 /desk-kit-api/files/<id>(读的时候才解密)
      files: (Array.isArray(payload.files) ? payload.files : [])
        .map((fid) => (this.data.files || []).find((f) => f.id === fid))
        .filter(Boolean)
        .map((f) => ({ ...f })),
    }
  }

  deleteSecret(query) {
    const entry = this.findSecret(query)
    if (!entry) throw new Error('找不到条目 ' + query)
    let fileIds = []
    try { fileIds = this.decryptPayload(entry).files || [] } catch { /* 解不开就按记录里的归属清 */ }
    const vault = this.vaultRaw()
    vault.entries = vault.entries.filter((e) => e.id !== entry.id)
    writeJson(this.vaultFile, vault)
    // 只删「还挂在这条名下」的附件:转存时已经搬到别处的不算,不能跟着一起清
    const owned = (this.data.files || [])
      .filter((f) => (f.kind === 'secret' && f.ownerId === entry.id) || (!f.kind && fileIds.includes(f.id)))
      .map((f) => f.id)
    this.dropFiles([...new Set(owned)])
    return { deleted: entry.id, title: entry.title }
  }

  updateSecret(query, patch = {}) {
    // 注意:必须在同一个 vault 对象里找条目并就地改 —— findSecret() 会重新读盘,
    // 改到的副本写不回去(踩过一次:更新成功但读回还是旧值)。
    const vault = this.vaultRaw()
    const q = String(query || '').trim().toLowerCase()
    const entry = vault.entries.find((e) => e.id === query)
      || vault.entries.find((e) => e.title.toLowerCase() === q)
      || vault.entries.find((e) => e.title.toLowerCase().includes(q))
    if (!entry) throw new Error('找不到条目 ' + query)
    const current = this.decryptPayload(entry)
    const fields = { ...(current.fields || {}) }
    if (patch.fields && typeof patch.fields === 'object') {
      for (const [k, v] of Object.entries(patch.fields)) {
        if (v === null || v === '') delete fields[String(k)]
        else fields[String(k)] = String(v).slice(0, 8000)
      }
    }
    // 编辑正文:整段替换字段(自由正文条目编辑后仍是一条「内容」)
    if (typeof patch.body === 'string') {
      const body = patch.body.trim()
      if (!body) throw new Error('内容不能为空')
      for (const k of Object.keys(fields)) delete fields[k]
      fields['内容'] = body.slice(0, 8000)
    }
    if (patch.title) entry.title = String(patch.title).slice(0, 120)
    if (Array.isArray(patch.tags)) entry.tags = patch.tags.map(String).filter(Boolean).slice(0, 12)
    if (patch.collection !== undefined) {
      const next = DeskStore.normalizeCollection(patch.collection)
      if (next !== DeskStore.normalizeCollection(entry.collection)) {
        entry.collection = next
        entry.order = this.nextSecretOrder(next, entry.id)
      }
    }
    if (patch.order !== undefined && Number.isFinite(Number(patch.order))) entry.order = Number(patch.order)
    const note = typeof patch.note === 'string' ? patch.note.slice(0, 4000) : current.note || ''
    let fileIds = Array.isArray(current.files) ? current.files.slice() : []
    if (patch.files !== undefined) fileIds = this.pickFileIds(patch.files)
    Object.assign(entry, this.encryptPayload({ fields, note, files: fileIds }))
    entry.updatedAt = Date.now()
    writeJson(this.vaultFile, vault)
    // 加进来的加密、被移出去的还回明文;两边都失败也只是留在原状态,不会丢
    const before = new Set(Array.isArray(current.files) ? current.files : [])
    for (const id of fileIds) {
      try { this.setFileSecret(id, true); this.attachFiles('secret', entry.id, [id]) } catch { }
    }
    for (const id of before) if (!fileIds.includes(id)) { try { this.setFileSecret(id, false) } catch { } }
    return { id: entry.id, title: entry.title }
  }

  /**
   * 合集内拖动排序:只接受当前合集里真实存在的 id,按传入顺序重编号。
   * 不跨合集搬家(搬家请走 updateSecret 的 collection),避免拖一下改错归属。
   */
  reorderSecrets(collection, ids) {
    const target = DeskStore.normalizeCollection(collection)
    const vault = this.vaultRaw()
    const wanted = Array.isArray(ids) ? ids.map(String) : []
    const seen = new Set()
    for (const id of wanted) {
      if (!id || seen.has(id)) throw new Error('排序列表里有重复或空 id')
      seen.add(id)
    }
    const byId = new Map(vault.entries.map((e) => [e.id, e]))
    for (const id of wanted) {
      const entry = byId.get(id)
      if (!entry) throw new Error('排序列表里有不存在的条目:' + id)
      if (DeskStore.normalizeCollection(entry.collection) !== target) {
        throw new Error('不能把别的合集拖进来排序:' + entry.title)
      }
    }
    // 传入的 id 先按新顺序占 0..n-1;没传到的同合集条目接在后面,
    // 保持原有相对顺序,避免「只排了一部分」时出现重复 order。
    let next = 0
    for (const id of wanted) byId.get(id).order = next++
    const rest = vault.entries
      .filter((e) => DeskStore.normalizeCollection(e.collection) === target && !seen.has(e.id))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    for (const e of rest) e.order = next++
    writeJson(this.vaultFile, vault)
    return { collection: target, count: wanted.length }
  }

  /** 整库导出(给「备份」按钮用)。vault 是密文,key 不在这里,要单独拷。 */
  exportAll(now = new Date()) {
    let vault = null
    try { vault = readJson(this.vaultFile, null) } catch { vault = null }
    return {
      kind: 'dsh-desk-kit-backup',
      version: 1,
      exportedAt: now.toISOString(),
      data: this.data,
      vault,
      // 附件原件不在这个 JSON 里:要完整备份得连 blobs/ 目录一起拷
      note: 'vault.json 是密文,要还原保险库还需要 ~/.dsh/desk-kit/vault.key;附件原件在 blobs/ 目录,备份时要一起拷',
    }
  }

  // ---------------- 汇总 ----------------

  snapshot(now = new Date()) {
    return {
      now: now.getTime(),
      today: localYmd(now),
      // 快照带上归档项:面板「看归档」直接用同一份数据过滤,否则切过去是空列表
      // 一次性给全(含已完成、垃圾箱),界面切 chip 就不用再请求
      notes: this.listNotes({ view: 'all', includeArchived: true }).concat(this.listNotes({ view: 'trash' })),
      noteCounts: this.noteCounts(),
      notesArchivedCount: this.data.notes.filter((n) => n.archived).length,
      reminders: this.todayView(now),
      alerts: this.pendingAlerts(),
      reminderCounts: this.reminderCounts(),
      trashedReminders: this.data.reminders
        .filter((r) => (r.deletedAt || 0) > 0)
        .map((r) => ({ id: r.id, title: r.title, time: r.time, url: r.url, deletedAt: r.deletedAt, annual: r.annual, lunar: r.lunar })),
      links: this.listLinks(),
      trashedLinks: this.listLinks('trash').map((l) => ({ id: l.id, title: l.title, url: l.url, group: l.group, deletedAt: l.deletedAt })),
      linkGroups: this.linkGroups(),
      linkCounts: this.linkCounts(),
      // 附件元信息(名字/大小/宽高):保险库名下的不在这里露面,要看请先 reveal
      files: (this.data.files || []).filter((f) => !f.secret).map((f) => ({ ...f })),
      fileCounts: {
        note: (this.data.files || []).filter((f) => f.kind === 'note').length,
        reminder: (this.data.files || []).filter((f) => f.kind === 'reminder').length,
        link: (this.data.files || []).filter((f) => f.kind === 'link').length,
        secret: (this.data.files || []).filter((f) => f.secret).length,
        bytes: (this.data.files || []).reduce((n, f) => n + (f.size || 0), 0),
      },
      // 垃圾箱到期表:每条还有几天被自动清掉(0 天 = 已经到期,下次清理就没)
      trash: this.trashEntries(now.getTime()),
      trashKeepDays: Number(this.data.settings.trashKeepDays ?? 30),
      lastSweepAt: this.data.settings.lastSweepAt || 0,
      secrets: this.listSecrets(),
      settings: this.data.settings,
      root: this.root,
    }
  }
}
