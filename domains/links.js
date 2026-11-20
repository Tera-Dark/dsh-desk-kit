/**
 * dsh-desk-kit · 网页收藏域
 *
 * 网页的增删改、分组与排序靠 mixin 挂到 DeskStore.prototype 上;
 * normalizeUrl / normalizeGroup / normalizeCollection 是静态规则,
 * 仍以 DeskStore.xxx 的名字对外(导入归一化要用)。
 */
import { hostOf, uid } from '../store.js'

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
}
