/**
 * dsh-desk-kit · 快照
 *
 * 浏览器半侧轮询看到的那一份完整视图。只读:不落盘、不改内存,
 * 结构(DOM 契约)一旦变了前端就要跟着改,所以单独一个文件记着。
 */
import { localYmd } from './time.js'

export const snapshot = {
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
