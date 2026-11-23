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
import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { notes, inferShelf } from './domains/notes.js'
import { reminders } from './domains/reminders.js'
import { links, normalizeUrl, normalizeGroup, normalizeCollection } from './domains/links.js'
import { vault } from './domains/vault.js'
import { files } from './domains/files.js'
import { backup } from './backup.js'
import { search } from './search.js'
import { maintenance, humanBytes } from './maintenance.js'
import { snapshot as snapshotDomain } from './snapshot.js'

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
      // 转存台账:同一条记录重复点击转存时复用上一次的结果,不再重复创建
      moves: {},
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
      moves: raw.moves && typeof raw.moves === 'object' && !Array.isArray(raw.moves) ? raw.moves : {},
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

}

// ---------------- 域方法挂载 ----------------
// 用 mixin 而不是重写:方法还是那些方法,this.data / this.save() 一个字没变,
// 只是搬家到 domains/ 与各功能模块。store.js 只剩装配、持久化和数据模型。
Object.assign(DeskStore.prototype, notes, reminders, links, vault, files, backup, search, maintenance, snapshotDomain)
// 静态方法的搬家:字节格式化给 index.js 的回执用;分拣规则保持 DeskStore.inferShelf。
DeskStore.humanBytes = humanBytes
DeskStore.inferShelf = inferShelf
notes.inferShelf = inferShelf
// 静态规则:名字集合与拆分前一致(normalizeUrl / normalizeGroup / normalizeCollection)
Object.assign(DeskStore, { normalizeUrl, normalizeGroup, normalizeCollection })
