/**
 * dsh-desk-kit · 网页收藏域
 *
 * 网页的增删改、分组与排序靠 mixin 挂到 DeskStore.prototype 上;
 * normalizeUrl / normalizeGroup / normalizeCollection 是静态规则,
 * 仍以 DeskStore.xxx 的名字对外(导入归一化要用)。
 */
import { byAttention } from '../rank.js'
import { hostOf, titleFromText, uid, urlInText } from '../store.js'

/** 网址归一化:没写协议补 https://,顺手把跟踪参数和末尾斜杠去掉。 */
export function normalizeUrl(input) {
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
export function normalizeGroup(input) {
  return String(input || '').trim().replace(/^[#\s]+/, '').replace(/\s+/g, ' ').slice(0, 24)
}

/** 保险库合集名:只做轻量清洗,不强迫用户拆字段。 */
export function normalizeCollection(input) {
  return String(input || '').trim().replace(/^[#\s]+/, '').replace(/\s+/g, ' ').slice(0, 32)
}

/** 挂到原型上的网页方法。 */
export const links = {
  /** 网页:一条一条存的常用入口(手机桌面那种格子)。 */
  addLink(input = {}) {
    const url = normalizeUrl(input.url)
    const now = Date.now()
    const title = String(input.title || '').trim().slice(0, 80) || hostOf(url)
    const link = {
      id: uid('w-'),
      title,
      url,
      group: normalizeGroup(input.group),
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
  },

  updateLink(id, patch = {}) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) throw new Error('找不到网页 ' + id)
    if (typeof patch.title === 'string' && patch.title.trim()) x.title = patch.title.trim().slice(0, 80)
    if (typeof patch.url === 'string') {
      const url = normalizeUrl(patch.url)
      const clash = this.data.links.find((l) => l.id !== id && !((l.deletedAt || 0) > 0) && l.url === url)
      if (clash) throw new Error('这个网址已经收过了:' + clash.title)
      x.url = url
    }
    if (patch.group !== undefined) x.group = normalizeGroup(patch.group)
    if (typeof patch.icon === 'string') x.icon = patch.icon.trim().slice(0, 400)
    if (typeof patch.note === 'string') x.note = patch.note.slice(0, 2000)
    if (typeof patch.pinned === 'boolean') x.pinned = patch.pinned
    x.updatedAt = Date.now()
    this.save()
    return x
  },

  // ---------------- 转存:分错了自己挪 ----------------

  findAny(kind, id) {
    const list = kind === 'note' ? this.data.notes
      : kind === 'link' ? this.data.links
        : kind === 'reminder' ? this.data.reminders
          : kind === 'secret' ? null : null
    if (kind === 'secret') return this.getSecret(id)
    if (!list) throw new Error('不认识的分类:' + kind)
    return list.find((x) => x.id === id) || null
  },

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

    // 同一条记录只转一次:连点几下转存按钮,第二下开始直接复用上一次的结果。
    // 源条目转走后只是进垃圾箱,不拦的话每点一下都会再建一条,变成重复录入。
    const moveKey = from + ':' + id
    const moves = this.data.moves || (this.data.moves = {})
    const prior = moves[moveKey]
    if (prior) {
      const existing = this.findAny(prior.kind, prior.id)
      if (existing) return { item: existing, from, to: prior.kind, merged: true, duplicate: true, files: 0 }
      // 目标后来被删了:清掉旧账,允许重新转一次。
      delete moves[moveKey]
    }

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

    // 记下「这条转去哪了」,重复点击时据此复用,而不是再建一条。
    if (item && item.id) {
      moves[moveKey] = { kind: target, id: item.id, at: Date.now() }
      this.save()
    }

    if (from === 'note') { this.deleteNote(id); this.attachCarried(id, item, target) }
    else if (from === 'link') { this.deleteLink(id); this.attachCarried(id, item, target) }
    else if (from === 'reminder') { this.deleteReminder(id); this.attachCarried(id, item, target) }
    else this.deleteSecret(id)

    return { item, from, to: target, merged: !!item.deduped, duplicate: false, files: carried.length }
  },

  /**
   * 转存后收尾:原条目只是移进垃圾箱(还在),孤儿清理不会误删已经挂到新家的附件。
   * 这里只处理「原条目彻底没了」的情况 —— 把已经从它名下搬走的附件记录一次,别让 id 悬空。
   */
  attachCarried(fromKind, ownerId, item, toKind) {
    if (!item || !item.id) return
    for (const f of this.data.files || []) {
      if (f.kind === fromKind && f.ownerId === ownerId) { f.kind = toKind; f.ownerId = item.id }
    }
  },

  /** 打开一次:记一笔,方便「最近用的排前面」。 */
  touchLink(id) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) return null
    x.hits = (x.hits || 0) + 1
    x.lastOpenedAt = Date.now()
    this.save()
    return { id: x.id, hits: x.hits, lastOpenedAt: x.lastOpenedAt }
  },

  /** 看过一次便签:只记「看过」,不动 updatedAt —— 看不是改,别把排序时间戳搅乱。 */

  deleteLink(id) {
    const x = this.data.links.find((l) => l.id === id)
    if (!x) throw new Error('找不到网页 ' + id)
    x.deletedAt = Date.now()
    x.pinned = false
    x.updatedAt = Date.now()
    this.save()
    return { trashed: x.id, id: x.id }
  },

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
  },

  purgeLink(id) {
    const before = this.data.links.length
    this.data.links = this.data.links.filter((l) => l.id !== id)
    if (this.data.links.length === before) throw new Error('找不到网页 ' + id)
    this.save()
    return { purged: id }
  },

  /** 活跃网页:置顶 → 最近打开 → 新收的在前。 */
  listLinks(view = 'all') {
    const sort = (a, b) => byAttention(a, b, Date.now())
    if (view === 'trash') {
      return this.data.links.filter((l) => (l.deletedAt || 0) > 0).sort((a, b) => b.deletedAt - a.deletedAt)
    }
    return this.data.links.filter((l) => !((l.deletedAt || 0) > 0)).sort(sort)
  },

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
  },

  linkCounts() {
    const links = this.data.links
    const trash = links.filter((l) => (l.deletedAt || 0) > 0).length
    return { active: links.length - trash, trash }
  }
}
