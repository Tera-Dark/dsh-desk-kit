/**
 * dsh-desk-kit · 存储层
 * 纯 Node 实现,不依赖 DSH,可以单独 node --test 验证。
 *
 * 目录结构($DSH_HOME/desk-kit/):
 *   data.json   便签 + 提醒 + 待确认告警(明文,可 cat/diff/备份)
 *   vault.json  加密条目(每条独立 AES-256-GCM 密文)
 *   vault.key   本机主密钥材料(0600;丢失则保险库不可解)
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { solar2lunar } from './lunar.js'

const ALERT_KEEP_MS = 7 * 24 * 3600 * 1000
const MAX_NOTES = 2000
const MAX_CHECKINS = 60

/** 从 URL 取主机名(不带 www.),给标题/图标兜底。 */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./i, '')
  } catch {
    return String(url || '').replace(/^https?:\/\//i, '').split('/')[0] || '未命名'
  }
}

/** YYYY-MM-DD 是不是真实存在的一天(2026-02-30 / 2026-13-01 都要拒绝)。 */
export function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return false
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 本地 YYYY-MM-DD(不要用 toISOString:那是 UTC,晚上会串日)。 */
export function localYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + randomBytes(3).toString('hex')
}

/** 解析 "HH:MM" → 当天该时刻;格式不合法返回 null。 */
export function parseClock(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim())
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

/**
 * 某条提醒今天的计划时刻(Date),不匹配返回 null。
 *
 * 支持四种重复方式:
 *   date       一次性(YYYY-MM-DD)
 *   lunarMonth/lunarDay  农历每年(生日):按今天换算成农历后比对
 *   annual     'MM-DD' 公历每年(生日)
 *   weekdays   周几,空数组 = 每天
 */
export function occurrenceOf(reminder, now = new Date()) {
  const clock = parseClock(reminder.time)
  if (!clock) return null
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.h, clock.m, 0, 0)

  if (reminder.date) return reminder.date === localYmd(now) ? at : null

  if (reminder.lunar && Number.isFinite(reminder.lunar.month) && Number.isFinite(reminder.lunar.day)) {
    const today = solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate())
    return today.month === reminder.lunar.month && today.day === reminder.lunar.day ? at : null
  }

  if (reminder.annual) {
    const mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
    return reminder.annual === mmdd ? at : null
  }

  // 每月 N 号:月末没有这一天(31 号遇到 4 月)按当月最后一天算
  if (Number.isFinite(reminder.monthly)) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return Math.min(reminder.monthly, lastDay) === now.getDate() ? at : null
  }

  const days = Array.isArray(reminder.weekdays) ? reminder.weekdays : []
  if (days.length && !days.includes(now.getDay())) return null
  return at
}

/**
 * 下一次发生(可能是未来几天)。
 *
 * occurrenceOf 只回答"今天是不是那天",所以 leadMin 一旦跨天(生日提前 3 天)
 * 就永远等到当天才提醒 —— 提前量形同虚设。这里补上"向前找":
 *   annual/lunar 最多找 400 天,weekdays 最多找 7 天,date 只看当天。
 */
export function nextOccurrence(reminder, now = new Date()) {
  const clock = parseClock(reminder.time)
  if (!clock) return null
  const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), clock.h, clock.m, 0, 0)

  // 一次性日期:今天就是今天,以后的就是那天(以前只认今天,明天的一次性提醒会变成
  // 「没有下一次」,首页看不见、状态也不对)
  if (reminder.date) {
    const today = localYmd(now)
    if (reminder.date < today) return null
    if (reminder.date === today) return at(now)
    const d = new Date(reminder.date + 'T00:00:00')
    return Number.isNaN(d.getTime()) ? null : at(d)
  }

  if (reminder.lunar || reminder.annual) {
    // 公历每年要扫 4 年多:2 月 29 日的生日隔 4 年才有一次,400 天扫不到就变成「没有下一次」,
    // 那条提醒从此永远不响。农历一年一次,400 天足够。
    const span = reminder.annual ? 1500 : 400
    for (let i = 0; i < span; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      let hit = false
      if (reminder.lunar) {
        const l = solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate())
        hit = l.month === reminder.lunar.month && l.day === reminder.lunar.day
      } else {
        hit = (String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) === reminder.annual
      }
      if (hit) return at(d)
    }
    return null
  }

  if (Number.isFinite(reminder.monthly)) {
    for (let i = 0; i < 62; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      if (d.getDate() === Math.min(reminder.monthly, lastDay)) return at(d)
    }
    return null
  }

  const days = Array.isArray(reminder.weekdays) ? reminder.weekdays : []
  if (days.length) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (days.includes(d.getDay())) return at(d)
    }
    return null
  }
  return at(now)
}

const backedUp = new Set()

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
    this.data = this.loadData()
  }

  loadData() {
    const base = {
      version: 1,
      notes: [],
      reminders: [],
      links: [],
      alerts: [],
      settings: { tickSeconds: 20, muted: false, sound: true },
    }
    const raw = readJson(this.dataFile, null)
    if (!raw || typeof raw !== 'object') return base
    const notes = Array.isArray(raw.notes) ? raw.notes : []
    // 老数据迁移:没有 shelf 的按同一条规则补上(只跑一次,补完回写)
    let migrated = 0
    for (const n of notes) {
      if (n && typeof n === 'object' && (n.shelf !== 'daily' && n.shelf !== 'long')) {
        n.shelf = DeskStore.inferShelf(n, String(n.text || ''))
        migrated++
      }
    }
    if (migrated > 0) {
      try { writeJson(this.dataFile, { ...raw, notes }) } catch { /* 写不进去下次再补 */ }
    }
    return {
      ...base,
      ...raw,
      notes,
      reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
      links: Array.isArray(raw.links) ? raw.links : [],
      alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
      settings: { ...base.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
    }
  }

  save() {
    writeJson(this.dataFile, this.data)
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
    if (!text) throw new Error('便签内容不能为空')
    const now = Date.now()
    // 同一句话 10 分钟内又存一次:不新增重复条目,只把它顶上来
    const dup = this.data.notes.find((n) => !n.deletedAt && !n.completedAt && n.text === text
      && now - (n.updatedAt || n.createdAt || 0) < 10 * 60000)
    if (dup) {
      // 重复提交时如果带了新标签,并进去(别让标签白白丢掉)
      const extra = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : []
      if (extra.length) dup.tags = [...new Set([...(dup.tags || []), ...extra])].slice(0, 12)
      if (input.pinned) dup.pinned = true
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
      shelf: DeskStore.inferShelf(input, text),  // 'daily' 进行中 | 'long' 长期资料
      completedAt: 0,   // >0 = 已完成
      deletedAt: 0,     // >0 = 在垃圾箱里
      createdAt: now,
      updatedAt: now,
    }
    this.data.notes.unshift(note)
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
    if (typeof patch.text === 'string') {
      const text = patch.text.trim()
      if (!text) throw new Error('便签内容不能为空')
      note.text = text.slice(0, 20000)
    }
    if (Array.isArray(patch.tags)) note.tags = patch.tags.map(String).filter(Boolean).slice(0, 12)
    if (typeof patch.pinned === 'boolean') note.pinned = patch.pinned
    if (typeof patch.archived === 'boolean') note.archived = patch.archived
    if (patch.shelf === 'long' || patch.shelf === 'daily') note.shelf = patch.shelf
    if (typeof patch.color === 'string') note.color = patch.color.slice(0, 20)
    note.updatedAt = Date.now()
    this.save()
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

  /** 彻底删除(不可恢复)。 */
  purgeNote(id) {
    const before = this.data.notes.length
    this.data.notes = this.data.notes.filter((n) => n.id !== id)
    if (this.data.notes.length === before) throw new Error('找不到便签 ' + id)
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
      .filter((n) => !q || n.text.toLowerCase().includes(q) || (n.tags || []).join(' ').toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
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
      leadMin: Number.isFinite(input.leadMin) ? Math.max(0, Math.min(10080, input.leadMin)) : 30,
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
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id)
    if (this.data.reminders.length === before) throw new Error('找不到提醒 ' + id)
    this.data.alerts = this.data.alerts.filter((a) => a.refId !== id)
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
        else if (occ && localYmd(occ) === today && (r.silencedDates || []).includes(today)) status = 'silenced'
        else if (!occ) status = r.date && r.date < today ? 'expired' : 'no-next'
        else if (now.getTime() >= occ.getTime() - (r.leadMin || 0) * 60000) status = 'pending'
        else status = 'upcoming'
        return {
          ...r,
          today,
          dueDate,
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
    if (created || mutated) this.save()
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

    let item
    if (target === 'link') {
      if (!url) throw new Error('这条里没有网址,存不成网页')
      item = this.addLink({ title, url, note: note.slice(0, 300), group: '' })
      // 撞上已有条目时把说明补进去,别让备注白丢
      if (item.deduped && note && !item.note) item = this.updateLink(item.id, { note: note.slice(0, 300) })
    } else if (target === 'note') {
      item = this.addNote({ text: text || title || '' })
    } else if (target === 'secret') {
      // 正文走 note(和「内容」一样加密),带网址时也不会被 addSecret 丢掉
      item = this.addSecret({ title: title || '未命名条目', username, password, url, note: text || note || title })
    } else {
      item = this.addReminder({
        title: title || '提醒',
        time: '09:00',
        leadMin: 0,
        note: [note, url].filter(Boolean).join(' ').slice(0, 500),
        url,
      })
    }

    if (from === 'note') this.deleteNote(id)
    else if (from === 'link') this.deleteLink(id)
    else if (from === 'reminder') this.deleteReminder(id)
    else this.deleteSecret(id)

    return { item, from, to: target, merged: !!item.deduped }
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
    const sort = (a, b) => (Number(b.pinned) - Number(a.pinned))
      || ((b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
      || ((b.createdAt || 0) - (a.createdAt || 0))
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
    return scryptSync(secret, Buffer.from(vault.kdf.salt, 'base64'), 32)
  }

  encryptPayload(payload) {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  decryptPayload(entry) {
    const key = this.masterKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'))
    const out = Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()])
    return JSON.parse(out.toString('utf8'))
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
    if (!Object.keys(fields).length) throw new Error('至少要有一点内容')
    const vault = this.vaultRaw()
    const now = Date.now()
    const blob = this.encryptPayload({ fields, note: String(input.note || '').slice(0, 4000) })
    const entry = {
      id: uid('s-'),
      title: title.slice(0, 120),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 12) : [],
      createdAt: now,
      updatedAt: now,
      ...blob,
    }
    vault.entries.unshift(entry)
    writeJson(this.vaultFile, vault)
    return { id: entry.id, title: entry.title, tags: entry.tags, createdAt: now }
  }

  listSecrets() {
    return this.vaultRaw().entries.map((e) => ({
      id: e.id, title: e.title, tags: e.tags || [], createdAt: e.createdAt, updatedAt: e.updatedAt,
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
      id: entry.id, title: entry.title, tags: entry.tags || [], createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      fields: payload.fields || {}, note: payload.note || '',
    }
  }

  deleteSecret(query) {
    const entry = this.findSecret(query)
    if (!entry) throw new Error('找不到条目 ' + query)
    const vault = this.vaultRaw()
    vault.entries = vault.entries.filter((e) => e.id !== entry.id)
    writeJson(this.vaultFile, vault)
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
    const note = typeof patch.note === 'string' ? patch.note.slice(0, 4000) : current.note || ''
    Object.assign(entry, this.encryptPayload({ fields, note }))
    entry.updatedAt = Date.now()
    writeJson(this.vaultFile, vault)
    return { id: entry.id, title: entry.title }
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
      note: 'vault.json 是密文,要还原保险库还需要 ~/.dsh/desk-kit/vault.key',
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
      secrets: this.listSecrets(),
      settings: this.data.settings,
      root: this.root,
    }
  }
}
