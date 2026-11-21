/**
 * dsh-desk-kit · 全库搜索
 *
 * 一次搜便签、提醒、网页、附件、保险库标题,只回**定位**(kind + id + 命中字段),
 * 不把内容拼第二份 —— 搜到的东西永远指向磁盘上那一份。
 *
 * 中英别名(脸书/Facebook 等)也在这里:只影响搜索,不落库;
 * 与客户端 src/client/30-core.js 的 SEARCH_ALIASES 保持同一组。
 */
import { DeskStore } from './store.js'

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

export const search = {
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
}
