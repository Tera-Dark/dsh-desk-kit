/**
 * dsh-desk-kit · 便签域
 *
 * 便签的读写方法,靠 mixin 挂到 DeskStore.prototype 上:
 * this.data / this.save() / 附件方法全部照旧,调用方一行都不用改。
 */
import { byAttention } from '../rank.js'
import { MAX_NOTES, uid } from '../store.js'

/**
 * 自动判 shelf(不逼用户做选择):
 *   打了标签 / 正文 >200 字 / 含非签到网址 → 长期资料
 *   其余 → 进行中
 */
export function inferShelf(input, text) {
  const asked = typeof input.shelf === 'string' ? input.shelf : ''
  if (asked === 'long' || asked === 'daily') return asked
  // 长文、非签到网址、以及"资料类"标签名 → 长期;普通标签(生活/购物)不算
  if (text.length > 200) return 'long'
  if (/https?:\/\//i.test(text) && !/签到|打卡|每日|每天/.test(text)) return 'long'
  const tags = Array.isArray(input.tags) ? input.tags.join(' ') : ''
  if (/资料|合集|参考|词库|池|手册|清单|备忘库/.test(tags)) return 'long'
  return 'daily'
}

/** 挂到原型上的便签方法(不含 inferShelf:那是静态的)。 */
export const notes = {
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
      shelf: inferShelf(input, text),  // 'daily' 进行中 | 'long' 长期资料
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
  },

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
  },

  /** 删除 = 移入垃圾箱(可恢复)。要真删用 purgeNote。 */
  deleteNote(id) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.deletedAt = Date.now()
    note.updatedAt = Date.now()
    this.save()
    return { trashed: id, id }
  },

  /** 从垃圾箱恢复。 */
  restoreNote(id) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.deletedAt = 0
    note.updatedAt = Date.now()
    this.save()
    return note
  },

  /** 彻底删除(不可恢复)。附件原件跟着删。 */
  purgeNote(id) {
    const before = this.data.notes.length
    const target = this.data.notes.find((n) => n.id === id)
    this.data.notes = this.data.notes.filter((n) => n.id !== id)
    if (this.data.notes.length === before) throw new Error('找不到便签 ' + id)
    this.dropFiles(target && target.files)
    this.save()
    return { purged: id, id }
  },

  /** 标记完成 / 取消完成。 */
  completeNote(id, done = true) {
    const note = this.data.notes.find((n) => n.id === id)
    if (!note) throw new Error('找不到便签 ' + id)
    note.completedAt = done ? Date.now() : 0
    note.updatedAt = Date.now()
    this.save()
    return note
  },

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
  },

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
  },

  /**
   * 记一次「看/用了」:只动 views 与 lastViewedAt(排序用),
   * 不动 updatedAt —— 看不是改。
   */
  touchNote(id) {
    const n = this.data.notes.find((x) => x.id === id)
    if (!n) return null
    n.views = (n.views || 0) + 1
    n.lastViewedAt = Date.now()
    this.save()
    return { id: n.id, views: n.views, lastViewedAt: n.lastViewedAt }
  }
}
