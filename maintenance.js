/**
 * dsh-desk-kit · 查找后的用量与清理
 *
 * 垃圾箱到期表、磁盘用量、清理三层(到期/孤儿/临时附件)都在这里。
 * 方法靠 mixin 挂到 DeskStore.prototype 上,this.data / this.save() 照旧。
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ALERT_KEEP_MS } from './store.js'

/** 空手清理掉的字节数,给回执用一句人话。 */
export function humanBytes(n) {
  const v = Number(n) || 0
  if (v >= 1073741824) return (v / 1073741824).toFixed(2) + 'GB'
  if (v >= 1048576) return (v / 1048576).toFixed(1) + 'MB'
  if (v >= 1024) return Math.round(v / 1024) + 'KB'
  return v + 'B'
}

export const maintenance = {
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
  },

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
  },

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
}
