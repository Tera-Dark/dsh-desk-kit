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
import { isRealDate, localYmd, parseClock, beforeCreated, occurrenceOf, nextOccurrence } from './time.js'
import { byAttention } from './rank.js'
import { notes, inferShelf } from './domains/notes.js'
import { reminders } from './domains/reminders.js'
import { links, normalizeUrl, normalizeGroup, normalizeCollection } from './domains/links.js'
import { vault } from './domains/vault.js'
import { files } from './domains/files.js'

// 导出面不变:test.mjs 直接从 store.js 拿这四个来验时间计算,调用方不用改。
export { isRealDate, localYmd, parseClock, occurrenceOf, nextOccurrence } from './time.js'
export { attentionScore } from './rank.js'

export const ALERT_KEEP_MS = 7 * 24 * 3600 * 1000
export const MAX_NOTES = 2000
export const MAX_CHECKINS = 60
/** 单个附件上限。截图通常几十 KB,手机照片 3~8MB,给到 24MB 够用又不至于把盘写爆。 */
export const MAX_FILE_BYTES = 24 * 1024 * 1024
/** 附件总数上限:再多就是拿它当网盘了,提示用户清理。 */
export const MAX_FILES = 3000
/** 附件 id 只是文件名的一部分:不允许路径分隔符/点,防止拼出 blobs/ 之外的路径。 */
const BLOB_ID_RE = /^[A-Za-z0-9_-]{1,120}$/
export const isBlobId = (id) => BLOB_ID_RE.test(String(id || ''))

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

const backedUp = new Set()

/** 文件指纹(修改时间 + 大小);读不到返回空串。 */
function stampOf(file) {
  try {
    const st = statSync(file)
    return st.mtimeMs + ':' + st.size
  } catch { return '' }
}

/** 文本里能认出的网址:带协议的直接用,裸域名补 https。 */
export function urlInText(text) {
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

export function readJson(file, fallback) {
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

export function writeJson(file, value) {
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

  // ---------------- 转存:分错了自己挪 ----------------

  /** 找一条原始记录(note/link/reminder/secret)。 */
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
}

// ---------------- 域方法挂载 ----------------
// 用 mixin 而不是重写:方法还是那些方法,this.data / this.save() 一个字没变,
// 只是搬家到 domains/ 下,store.js 只剩装配和持久化。
Object.assign(DeskStore.prototype, notes, reminders, links, vault, files)
// 静态分拣规则:DeskStore.inferShelf 保持不变,域模块上也留一份同名引用。
DeskStore.inferShelf = inferShelf
notes.inferShelf = inferShelf
// 静态规则:名字集合与拆分前一致(normalizeUrl / normalizeGroup / normalizeCollection)
Object.assign(DeskStore, { normalizeUrl, normalizeGroup, normalizeCollection })
