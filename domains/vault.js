/**
 * dsh-desk-kit · 保险库域
 *
 * 账号/密钥条目:每条独立 AES-256-GCM 密文落 vault.json,主密钥在本机 vault.key。
 * 靠 mixin 挂到 DeskStore.prototype 上,加密原语仍走 this.encryptPayload 等内部方法。
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
// DeskStore 只在调用时取静态规则(合集名归一化),那时 store.js 已经装配完毕。
import { DeskStore, readJson, uid, writeJson } from '../store.js'

export const vault = {

  vaultRaw() {
    const v = readJson(this.vaultFile, null)
    if (!v || v.v !== 1) {
      const fresh = { v: 1, kdf: { alg: 'scrypt', salt: randomBytes(16).toString('base64') }, entries: [] }
      writeJson(this.vaultFile, fresh)
      return fresh
    }
    if (!Array.isArray(v.entries)) v.entries = []
    return v
  },

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
    const salt = vault.kdf.salt
    // 缓存:scrypt 一次 ~80ms,贴几张图就卡;但密钥材料换了必须重算(换机/被清掉)
    if (this._mk && this._mkSalt === salt && this._mkSecret === secret) return this._mk
    const key = scryptSync(secret, Buffer.from(salt, 'base64'), 32)
    this._mk = key
    this._mkSalt = salt
    this._mkSecret = secret
    return key
  },

  encryptPayload(payload) {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  },

  decryptPayload(entry, key) {
    const k = key || this.masterKey()
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(entry.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'))
    const out = Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()])
    return JSON.parse(out.toString('utf8'))
  },

  /** 同一合集里下一个排序号;老数据没有 order 时从 1 开始。 */
  nextSecretOrder(collection, exceptId = '') {
    const target = DeskStore.normalizeCollection(collection)
    let max = 0
    for (const e of this.vaultRaw().entries) {
      if (exceptId && e.id === exceptId) continue
      if (DeskStore.normalizeCollection(e.collection) !== target) continue
      const n = Number(e.order)
      if (Number.isFinite(n) && n > max) max = n
    }
    return max + 1
  },

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
    const fileIds = this.pickFileIds(input.files)
    const noteText = String(input.note || '').slice(0, 4000)
    // 只有附件、或只有一段说明,也算一条(一张截图 + 标题就是很多人的记法);
    // 转存进来的条目往往就是「标题 + 说明」,不能在这里被拦下
    if (!Object.keys(fields).length && !fileIds.length && !noteText.trim()) throw new Error('至少要有一点内容')
    const vault = this.vaultRaw()
    const now = Date.now()
    const blob = this.encryptPayload({ fields, note: String(input.note || '').slice(0, 4000), files: fileIds })
    const collection = DeskStore.normalizeCollection(input.collection)
    const entry = {
      id: uid('s-'),
      title: title.slice(0, 120),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 12) : [],
      collection,
      // 同一合集内按 order 升序;新条目先放末尾,用户可拖动重排
      order: this.nextSecretOrder(collection),
      createdAt: now,
      updatedAt: now,
      ...blob,
    }
    vault.entries.unshift(entry)
    writeJson(this.vaultFile, vault)
    // 附件在写密文成功之后才加密搬迁:先建后改,失败也不丢原件
    for (const id of fileIds) {
      try { this.setFileSecret(id, true); this.attachFiles('secret', entry.id, [id]) } catch { /* 搬不动就留在外面,数据还在 */ }
    }
    return { id: entry.id, title: entry.title, tags: entry.tags, collection: entry.collection, createdAt: now }
  },

  listSecrets() {
    return this.vaultRaw().entries.map((e) => ({
      id: e.id, title: e.title, tags: e.tags || [],
      collection: DeskStore.normalizeCollection(e.collection),
      order: Number.isFinite(Number(e.order)) ? Number(e.order) : 0,
      createdAt: e.createdAt, updatedAt: e.updatedAt,
      fieldCount: 0,
    }))
  },

  findSecret(query) {
    const q = String(query || '').trim().toLowerCase()
    const entries = this.vaultRaw().entries
    if (!q) return null
    return entries.find((e) => e.id === query) || entries.find((e) => e.title.toLowerCase() === q) || entries.find((e) => e.title.toLowerCase().includes(q))
  },

  getSecret(query) {
    const entry = this.findSecret(query)
    if (!entry) return null
    const payload = this.decryptPayload(entry)
    return {
      id: entry.id, title: entry.title, tags: entry.tags || [],
      collection: DeskStore.normalizeCollection(entry.collection),
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      fields: payload.fields || {}, note: payload.note || '',
      // 只给元信息;原件走 /desk-kit-api/files/<id>(读的时候才解密)
      files: (Array.isArray(payload.files) ? payload.files : [])
        .map((fid) => (this.data.files || []).find((f) => f.id === fid))
        .filter(Boolean)
        .map((f) => ({ ...f })),
    }
  },

  deleteSecret(query) {
    const entry = this.findSecret(query)
    if (!entry) throw new Error('找不到条目 ' + query)
    let fileIds = []
    try { fileIds = this.decryptPayload(entry).files || [] } catch { /* 解不开就按记录里的归属清 */ }
    const vault = this.vaultRaw()
    vault.entries = vault.entries.filter((e) => e.id !== entry.id)
    writeJson(this.vaultFile, vault)
    // 只删「还挂在这条名下」的附件:转存时已经搬到别处的不算,不能跟着一起清
    const owned = (this.data.files || [])
      .filter((f) => (f.kind === 'secret' && f.ownerId === entry.id) || (!f.kind && fileIds.includes(f.id)))
      .map((f) => f.id)
    this.dropFiles([...new Set(owned)])
    return { deleted: entry.id, title: entry.title }
  },

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
    if (patch.collection !== undefined) {
      const next = DeskStore.normalizeCollection(patch.collection)
      if (next !== DeskStore.normalizeCollection(entry.collection)) {
        entry.collection = next
        entry.order = this.nextSecretOrder(next, entry.id)
      }
    }
    if (patch.order !== undefined && Number.isFinite(Number(patch.order))) entry.order = Number(patch.order)
    const note = typeof patch.note === 'string' ? patch.note.slice(0, 4000) : current.note || ''
    let fileIds = Array.isArray(current.files) ? current.files.slice() : []
    if (patch.files !== undefined) fileIds = this.pickFileIds(patch.files)
    Object.assign(entry, this.encryptPayload({ fields, note, files: fileIds }))
    entry.updatedAt = Date.now()
    writeJson(this.vaultFile, vault)
    // 加进来的加密、被移出去的还回明文;两边都失败也只是留在原状态,不会丢
    const before = new Set(Array.isArray(current.files) ? current.files : [])
    for (const id of fileIds) {
      try { this.setFileSecret(id, true); this.attachFiles('secret', entry.id, [id]) } catch { }
    }
    for (const id of before) if (!fileIds.includes(id)) { try { this.setFileSecret(id, false) } catch { } }
    return { id: entry.id, title: entry.title }
  },

  /**
   * 合集内拖动排序:只接受当前合集里真实存在的 id,按传入顺序重编号。
   * 不跨合集搬家(搬家请走 updateSecret 的 collection),避免拖一下改错归属。
   */
  reorderSecrets(collection, ids) {
    const target = DeskStore.normalizeCollection(collection)
    const vault = this.vaultRaw()
    const wanted = Array.isArray(ids) ? ids.map(String) : []
    const seen = new Set()
    for (const id of wanted) {
      if (!id || seen.has(id)) throw new Error('排序列表里有重复或空 id')
      seen.add(id)
    }
    const byId = new Map(vault.entries.map((e) => [e.id, e]))
    for (const id of wanted) {
      const entry = byId.get(id)
      if (!entry) throw new Error('排序列表里有不存在的条目:' + id)
      if (DeskStore.normalizeCollection(entry.collection) !== target) {
        throw new Error('不能把别的合集拖进来排序:' + entry.title)
      }
    }
    // 传入的 id 先按新顺序占 0..n-1;没传到的同合集条目接在后面,
    // 保持原有相对顺序,避免「只排了一部分」时出现重复 order。
    let next = 0
    for (const id of wanted) byId.get(id).order = next++
    const rest = vault.entries
      .filter((e) => DeskStore.normalizeCollection(e.collection) === target && !seen.has(e.id))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    for (const e of rest) e.order = next++
    writeJson(this.vaultFile, vault)
    return { collection: target, count: wanted.length }
  },

}
