/**
 * dsh-desk-kit · 附件域
 *
 * 附件原件落 blobs/(保险库名下的存成 .enc,与条目同一把钥匙)。
 * 靠 mixin 挂到 DeskStore.prototype 上;加密原语 encryptBuffer / decryptBuffer 也在这里。
 */
import {
  readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, statSync, mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  isBlobId, imageSize, uid, readJson, MAX_FILE_BYTES, MAX_FILES,
} from '../store.js'

/** 挂到原型上的附件方法。 */
export const files = {

  /** 只留真实存在、且不属于保险库的附件 id —— 垃圾 id 悄悄丢掉,不留悬空引用。 */
  pickFileIds(list) {
    if (!Array.isArray(list)) return []
    const out = []
    for (const raw of list) {
      const id = String(raw || '').trim()
      if (!id || out.includes(id)) continue
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      out.push(id)
      if (out.length >= 12) break
    }
    return out
  },

  blobFile(id, enc) {
    return join(this.blobDir, id + (enc ? '.enc' : '.bin'))
  },

  /** 保险库名下的附件:整块二进制用同一把钥匙 AES-256-GCM,格式 iv|tag|data。 */
  encryptBuffer(buf) {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(buf), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), data])
  },

  decryptBuffer(buf) {
    if (buf.length < 28) throw new Error('附件文件损坏')
    const key = this.masterKey()
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
  },

  /**
   * 收一个附件。buffer 是原始字节,name/mime 只用于显示。
   * secret=true(保险库条目)时落盘前加密,并把 mark 记在记录里。
   */
  addFile(input = {}) {
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || '')
    if (!buffer.length) throw new Error('空文件')
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error('文件太大(' + Math.round(buffer.length / 1048576) + 'MB),上限 ' + Math.round(MAX_FILE_BYTES / 1048576) + 'MB')
    }
    if ((this.data.files || []).length >= MAX_FILES) {
      throw new Error('附件已有 ' + MAX_FILES + ' 个,先清掉一些再存')
    }
    const name = String(input.name || '').trim().slice(0, 160) || '未命名文件'
    const mime = String(input.mime || '').split(';')[0].trim().toLowerCase().slice(0, 120) || 'application/octet-stream'
    const secret = !!input.secret
    const id = uid('f-')
    mkdirSync(this.blobDir, { recursive: true })
    const { w, h } = imageSize(buffer)
    writeFileSync(this.blobFile(id, secret), secret ? this.encryptBuffer(buffer) : buffer, { mode: 0o600 })
    const rec = {
      id, name, mime,
      size: buffer.length,
      w: w || 0,
      h: h || 0,
      secret,
      kind: '',
      ownerId: '',
      createdAt: Date.now(),
    }
    this.data.files.unshift(rec)
    this.save()
    return { ...rec }
  },

  /** 给浏览器/工具读原件。保险库名下的会在这里解密。 */
  readFileBytes(id) {
    const rec = (this.data.files || []).find((f) => f.id === id)
    if (!rec) throw new Error('找不到附件 ' + id)
    if (!isBlobId(rec.id)) throw new Error('附件 id 不合法')
    let buf
    try {
      buf = readFileSync(this.blobFile(rec.id, rec.secret))
    } catch {
      throw new Error('附件原件丢了(可能被手动删过)')
    }
    return { rec, bytes: rec.secret ? this.decryptBuffer(buf) : buf }
  },

  /**
   * 把附件挪进/挪出保险库:整个文件重新加解密一遍,再换掉原件。
   * 先写新文件、成功了才删旧的 —— 中途出错不会只剩半截。
   */
  setFileSecret(id, flag) {
    const rec = (this.data.files || []).find((f) => f.id === id)
    if (!rec || !isBlobId(rec.id)) return null
    const want = !!flag
    if (!!rec.secret === want) return { ...rec }
    let raw
    try { raw = readFileSync(this.blobFile(rec.id, rec.secret)) } catch { throw new Error('附件原件丢了,没法搬') }
    const plain = rec.secret ? this.decryptBuffer(raw) : raw
    const target = this.blobFile(rec.id, want)
    writeFileSync(target, want ? this.encryptBuffer(plain) : plain, { mode: 0o600 })
    try { unlinkSync(this.blobFile(rec.id, rec.secret)) } catch { }
    rec.secret = want
    this.save()
    return { ...rec }
  },

  /** 把一批附件整体设成 secret / 明文(转存时用)。 */
  setFilesSecret(ids, flag) {
    for (const id of Array.isArray(ids) ? ids : []) this.setFileSecret(String(id), flag)
  },

  /** 真删:记录 + 原件。ids 里找不到的直接跳过,别让调用方为一个空 id 报错。 */
  dropFiles(ids) {
    const list = Array.isArray(ids) ? ids.map(String) : []
    if (!list.length) return 0
    let n = 0
    for (const id of list) {
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      // id 不合法时只删记录,不按它去 unlink(否则可能删到 blobs/ 之外的同名 .bin/.enc)
      if (isBlobId(rec.id)) {
        try { unlinkSync(this.blobFile(rec.id, rec.secret)) } catch { /* 原件本来就不在了 */ }
      }
      this.data.files = this.data.files.filter((f) => f.id !== id)
      n++
    }
    if (n) this.save()
    return n
  },

  /** 把上传好的附件挂到某条便签/提醒/网页名下(先存字节、再挂,失败不会丢原件)。 */
  attachFiles(kind, ownerId, ids) {
    const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
    for (const id of list) {
      const rec = (this.data.files || []).find((f) => f.id === id)
      if (!rec) continue
      rec.kind = String(kind || '').slice(0, 20)
      rec.ownerId = String(ownerId || '')
    }
    if (list.length) this.save()
    return this.filesFor(kind, ownerId)
  },

  /** 某条记录名下的附件(按加入顺序)。 */
  filesFor(kind, ownerId) {
    return (this.data.files || []).filter((f) => f.kind === kind && f.ownerId === ownerId).map((f) => ({ ...f }))
  },

  /**
   * 清孤儿:宿主已经不在了的附件、以及上传完就没人认领的(超过 1 天)。
   * 在 apply 时和每次 tick 里跑一次,成本 O(附件数)。
   */
  sweepFiles(nowMs = Date.now()) {
    const alive = {
      note: new Set(this.data.notes.map((n) => n.id)),
      reminder: new Set(this.data.reminders.map((r) => r.id)),
      link: new Set(this.data.links.map((l) => l.id)),
      secret: new Set(this.data.files.filter((f) => f.secret).map((f) => f.ownerId)),
    }
    const dead = []
    for (const f of this.data.files || []) {
      if (!f.kind) {
        // 传上来还没挂上的临时文件:给一天时间
        if (nowMs - (f.createdAt || 0) > 24 * 3600 * 1000) dead.push(f.id)
        continue
      }
      const set = alive[f.kind]
      if (!set) { dead.push(f.id); continue }
      if (!set.has(f.ownerId)) dead.push(f.id)
    }
    if (dead.length) this.dropFiles(dead)
    // blobs/ 里没有记录的散件(上次崩在写记录之前)
    try {
      mkdirSync(this.blobDir, { recursive: true })
      const known = new Set((this.data.files || []).map((f) => f.id))
      for (const name of readdirSync(this.blobDir)) {
        const id = name.replace(/\.(bin|enc)$/, '')
        if (!known.has(id)) { try { unlinkSync(join(this.blobDir, name)) } catch { } }
      }
    } catch { /* 目录读不到就算了 */ }
    return dead.length
  },

  /** 附件总览:给「文件」视图和工具用。 */
  listFiles({ query = '', kind = '' } = {}) {
    const q = String(query || '').trim().toLowerCase()
    return (this.data.files || [])
      .filter((f) => (kind ? f.kind === kind : true))
      .filter((f) => !q || String(f.name || '').toLowerCase().includes(q))
      .map((f) => ({ ...f }))
  },
}
