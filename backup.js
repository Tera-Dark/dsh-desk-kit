/**
 * dsh-desk-kit · 备份(导入 / 导出)
 *
 * 整库 JSON 的进出口。方法靠 mixin 挂到 DeskStore.prototype 上,
 * this.data / this.save() 照旧,调用方一行都不用改。
 *
 * 为什么单独一个文件:导入要面对「手改过的 / 旧版本的 / 缺原件的」数据,
 * 归一化与校验都堆在这里;store.js 只留持久化和公共工具。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeskStore, MAX_FILES, MAX_NOTES, hostOf, isBlobId, readJson, writeJson } from './store.js'
import { isRealDate, parseClock } from './time.js'

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

export const backup = {
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
  },

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
