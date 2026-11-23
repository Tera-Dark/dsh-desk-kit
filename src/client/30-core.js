
   /**
    * 注入样式,返回「摘掉它」的函数。
    * 以前只在 apply 里注入一次、从不回收:插件重建后旧 <style> 还在,
    * 而 querySelector 命中又让新样式永远不更新。现在交给 ctx.effect 持有,
    * 重建时先移除再按最新 CSS 重新挂。
    */
   function injectCss() {
     if (typeof document === 'undefined') return () => { }
     const id = 'dsh-desk-kit/main.css'
     const selector = 'style[data-plugin-css="' + id + '"]'
     let tag = document.querySelector(selector)
     if (tag) {
       // 热重载/重建:复用同一个节点,内容换成当前源码里的 CSS
       tag.textContent = CSS
     } else {
       tag = document.createElement('style')
       tag.dataset.plugin = 'dsh-desk-kit'
       tag.dataset.pluginCss = id
       tag.textContent = CSS
       document.head.appendChild(tag)
     }
     return () => { if (tag && tag.parentNode) tag.parentNode.removeChild(tag) }
   }

   // 服务端要求这个头:跨源页面想带就得先发预检,而我们从不应答 CORS,于是拿不到。
   const HEAD = { 'x-desk-kit': '1' }

   // 上一次快照的 ETag:内容没变时服务端回 304(不传那 1MB 的 JSON)
   let lastEtag = ''

   /**
    * 上次的快照留在 localStorage 里。
    * 为什么:打开标签页时要等「请求 → 解析 → React 首帧」才有内容,
    * 本地服务再快也是一次往返;先把上次的样子画出来,再在后台对一次,
    * 观感上就是「立刻打开」。只存快照(便签标题/提醒/网页),不存保险库明文。
    */
   const SNAP_KEY = 'dsh-desk-kit/snapshot-v1'
   const SNAP_TTL = 7 * 24 * 3600 * 1000
   const SNAP_MAX = 1500000
   function readSnapCache() {
     try {
       if (typeof localStorage === 'undefined') return null
       const raw = localStorage.getItem(SNAP_KEY)
       if (!raw) return null
       const box = JSON.parse(raw)
       if (!box || !box.at || !box.state) return null
       if (Date.now() - box.at > SNAP_TTL) { localStorage.removeItem(SNAP_KEY); return null }
       return box.state
     } catch { return null }
   }
   function writeSnapCache(state) {
     try {
       if (typeof localStorage === 'undefined' || !state) return
       const raw = JSON.stringify({ at: Date.now(), state })
       if (raw.length > SNAP_MAX) { localStorage.removeItem(SNAP_KEY); return }
       localStorage.setItem(SNAP_KEY, raw)
     } catch { /* 隐私模式/配额满:没有缓存也能用 */ }
   }

   // 有缓存就先当上一份:304 时各处直接用它,不会出现「空一下再回来」
   let lastState = readSnapCache()
   // 同一时刻只发一个 GET:打开页面时侧栏和提醒坞会各要一次,以前就是两份全量快照
   let pendingGet = null

   // fetch 在原生的 "Failed to fetch" 里不会说人话;统一换成能照着做的提示。
   function netError(e) {
     const msg = String((e && e.message) || e || '')
     if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) {
       return new Error('连不上本地服务,请确认 DeepAI Code 还在运行')
     }
     return e instanceof Error ? e : new Error(msg || '请求失败')
   }

   /**
    * 读快照。命中 304 返回 null —— 调用方必须「保持原样」,不能当成空数据。
    * 顺手记住上一份 state:同一面板里多处并发调用(浮标角标 + 当前页)时,
    * 拿到 304 的那一处能直接用上一份,不必再发一次请求。
    */
   function apiGet() {
     if (pendingGet) return pendingGet
     pendingGet = apiGetOnce().finally(() => { pendingGet = null })
     return pendingGet
   }

   async function apiGetOnce() {
     const headers = lastEtag ? { ...HEAD, 'if-none-match': lastEtag } : HEAD
     let res
     try { res = await fetch(API, { cache: 'no-store', headers }) } catch (e) { throw netError(e) }
     if (res.status === 304) return null
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     const tag = res.headers && res.headers.get ? res.headers.get('etag') : ''
     if (tag) lastEtag = tag
     lastState = body.state
     writeSnapCache(body.state)
     return body.state
   }

   /** 给「必须有数据」的地方用:304 就回上一份。 */
   async function apiGetOrLast() {
     const st = await apiGet()
     return st || lastState
   }
   async function apiPost(action, payload) {
     let res
     try {
       res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...HEAD }, body: JSON.stringify({ action, payload: payload || {} }) })
     } catch (e) { throw netError(e) }
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     // 写操作也带 ETag / 新快照:记下来,下一次轮询就能 304,不用再拉一遍刚拿到的数据。
     const tag = res.headers && res.headers.get ? res.headers.get('etag') : ''
     if (tag) lastEtag = tag
     if (body.state) { lastState = body.state; writeSnapCache(body.state) }
     return body
   }

   /**
    * 写操作的统一口径。
    * run() 出错时返回 null(原因由面板顶部的 ErrorBar 报),所以「有没有存上」
    * 必须先问这里 —— 否则连失败也会弹「已保存」、把草稿清掉。
    */
   function writeOk(body) { return !!(body && body.ok !== false) }
   /**
    * 复制敏感内容:30 秒后如果剪贴板里还是它,就清掉。
    * Windows 的剪贴板历史会一直留着复制的密码,这一步至少不让它躺在最上面。
    */
   function copySecret(text, ms = 30000) {
     try { navigator.clipboard.writeText(String(text)) } catch { return false }
     setTimeout(async () => {
       try {
         const now = await navigator.clipboard.readText()
         if (now === String(text)) await navigator.clipboard.writeText('')
       } catch { /* 没给读剪贴板权限:读不到就只留提示,不硬清 */ }
     }, ms)
     return true
   }

   /** 附件:**原件走字节流**,元信息在快照里。传完拿到 id,再挂到便签/条目上。 */
   async function uploadFile(file, name) {
     const res = await fetch(API + '/files', {
       method: 'POST',
       headers: {
         ...HEAD,
         'content-type': (file && file.type) || 'application/octet-stream',
         'x-file-name': encodeURIComponent(name || (file && file.name) || '未命名'),
       },
       body: file,
     })
     const body = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }))
     if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status))
     return body.file
   }

   const fileUrl = (id) => API + '/files/' + encodeURIComponent(id)
   const isImage = (f) => /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(String((f && f.mime) || ''))
   const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : (n || 0) + 'B')
   const extOf = (name) => {
     const parts = String(name || '').split('.')
     return parts.length > 1 ? parts.pop().slice(0, 4).toUpperCase() : 'FILE'
   }

   /** 从剪贴板/拖拽事件里把「文件」挑出来(文本走原来的路子)。 */
   function filesFromDataTransfer(dt) {
     if (!dt) return []
     const out = []
     try {
       for (const item of Array.from(dt.items || [])) {
         if (item.kind !== 'file') continue
         const f = item.getAsFile && item.getAsFile()
         if (f) out.push(f)
       }
     } catch { /* 老浏览器没有 items */ }
     if (!out.length && dt.files) for (const f of Array.from(dt.files)) out.push(f)
     return out.slice(0, 8)
   }

   /** 截图默认名:带时间,省得一堆「image.png」。 */
   function shotName(file) {
     const d = new Date()
     const pad = (n) => String(n).padStart(2, '0')
     const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
     const ext = (String((file && file.type) || '').split('/')[1] || 'png').replace('jpeg', 'jpg')
     return '截图 ' + stamp + '.' + ext
   }

   /**
    * 从剪贴板里判断「这次粘贴的到底是不是图片」。
    * 浏览器不保证复制图片时带文件:从网页/聊天软件复制,常常只给一段
    * text/html 的 <img src>,或直接给一个本地路径。只认文件的话,
    * 文本路径就会被当成普通文字粘进输入框 —— 这正是用户看到「路径」的原因。
    */
   function clipboardImage(dt) {
     const files = filesFromDataTransfer(dt)
     if (files.length) return { files }
     if (!dt) return null
     let html = ''
     let plain = ''
     try { html = String(dt.getData('text/html') || '') } catch { /* 有些环境不给 html */ }
     try { plain = String(dt.getData('text/plain') || '').trim() } catch { /* 同上 */ }
     const m = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
     let src = m ? m[1] : ''
     const fromHtml = !!src
     if (!src) src = plain
     if (!src) return null
     src = src.replace(/&amp;/g, '&').trim().replace(/^["']|[\"']$/g, '').trim()
     const imageExt = /\.(png|jpe?g|gif|webp|bmp|avif)([?#]|$)/i.test(src)
     if (/^data:image\//i.test(src)) return { dataUrl: src }
     // 网页图片的地址经常没有扩展名(签名 URL),来自 <img> 就信它;纯文本则要求像图片
     if (/^https?:\/\//i.test(src) && (fromHtml || imageExt)) return { url: src }
     const localPath = /^file:\/\//i.test(src) || /^[a-zA-Z]:/.test(src) || src.charCodeAt(0) === 92 || (src[0] === '/' && imageExt)
     if (localPath && (imageExt || /^file:\/\//i.test(src))) return { localPath: src }
     return null
   }

   /** data:image/... 转成可上传的 File。 */
   async function fileFromDataUrl(url) {
     const res = await fetch(url)
     if (!res.ok) throw new Error('读不出剪贴板里的图片')
     const blob = await res.blob()
     return new File([blob], shotName({ type: blob.type }), { type: blob.type || 'image/png' })
   }

   /** 网页上的图片:交给宿主下载后落盘,避开浏览器跨域限制。 */
   async function uploadFromUrl(url) {
     const res = await fetch(API + '/files/from-url', {
       method: 'POST',
       headers: { ...HEAD, 'content-type': 'application/json' },
       body: JSON.stringify({ url: String(url || '') }),
     })
     const body = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }))
     if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status))
     return body.file
   }

   /** 剪贴板里只有本地路径时,浏览器读不到文件;给一句能照着做的提示。 */
   const LOCAL_PASTE_TIP = '剪贴板里是本地图片路径,浏览器读不到这个文件。请点「附件」选一下,或直接把图片拖进来。'

   const fmtClock = (ts) => { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
   const fmtWhen = (ts) => { const d = new Date(ts); const n = new Date(); return d.toDateString() === n.toDateString() ? '今天 ' + fmtClock(ts) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(ts) }

   /**
    * 统一错误条:一句人话 + 可选「重试」。
    * 网络/宿主抖动时,人第一反应是再点一下,而不是等 20 秒后的下一次轮询。
    */
   function ErrorBar({ text, onRetry }) {
     return h('div', { className: '__dk_err __dk_errbar', role: 'alert' }, [
       h('span', { key: 't', className: '__dk_errt' }, String(text || '出错了')),
       onRetry ? h('button', { key: 'r', type: 'button', className: '__dk_btn', onClick: onRetry }, '重试') : null,
     ])
   }
   /** 附件格子:图片显示缩略图,其它显示扩展名。点开看大图/下载,可带一个「移掉」。 */
   function FileChip({ file, onOpen, onRemove }) {
     const img = isImage(file)
     return h('div', {
       className: '__dk_fchip' + (img ? ' __dk_fchip--img' : ''),
       title: file.name + ' · ' + fmtSize(file.size) + (file.w ? ' · ' + file.w + '×' + file.h : ''),
       onClick: () => onOpen && onOpen(file),
     }, [
       img
         ? h('img', { key: 'i', src: fileUrl(file.id), alt: file.name, loading: 'lazy', draggable: false })
         : h('div', { key: 'e', className: '__dk_fext' }, extOf(file.name)),
       img ? null : h('div', { key: 'n', className: '__dk_fname' }, file.name),
       onRemove
         ? h('button', {
           key: 'x', className: '__dk_fdel', title: '移掉', 'aria-label': '移掉这个附件',
           onClick: (e) => { e.stopPropagation(); onRemove(file) },
         }, h(Ico, { name: 'x', size: 11 }))
         : null,
     ])
   }

   function FileGrid({ files, onOpen, onRemove }) {
     if (!files || !files.length) return null
     return h('div', { className: '__dk_fgrid' }, files.map((f) =>
       h(FileChip, { key: f.id, file: f, onOpen, onRemove })))
   }

   /** 看大图:点背景或 Esc 关掉。非图片直接走下载。 */
   function Lightbox({ file, onClose }) {
     useEffect(() => {
       if (!file) return undefined
       const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
       window.addEventListener('keydown', onKey, true)
       return () => window.removeEventListener('keydown', onKey, true)
     }, [file, onClose])
     if (!file) return null
     return h('div', { className: '__dk_light', onClick: onClose }, [
       isImage(file)
         ? h('img', { key: 'i', className: '__dk_lightimg', src: fileUrl(file.id), alt: file.name, loading: 'lazy', decoding: 'async', onClick: (e) => e.stopPropagation() })
         : h('div', { key: 't', className: '__dk_lightfile', onClick: (e) => e.stopPropagation() }, [
           h('div', { key: 'e', className: '__dk_fext' }, extOf(file.name)),
           h('div', { key: 'n', className: '__dk_note' }, file.name + ' · ' + fmtSize(file.size)),
         ]),
       h('div', { key: 'b', className: '__dk_lightbar', onClick: (e) => e.stopPropagation() }, [
         h('span', { key: 'h', className: '__dk_lighthint' }, file.name + ' · ' + fmtSize(file.size) + (file.w ? ' · ' + file.w + '×' + file.h : '')),
         h('a', { key: 'd', className: '__dk_btn', href: fileUrl(file.id), download: file.name }, '下载'),
         h('button', { key: 'c', className: '__dk_btn', onClick: onClose }, '关闭'),
       ]),
     ])
   }

   // 同一个服务常有两个名字:中文习惯叫「脸书」,条目里却写着 Facebook。
   // 只做字面匹配会出现「明明存过却搜不到」,所以给常见服务补一组别名。
   // 只用于搜索,不改任何落库内容;别名太短(如 x)不参与包含匹配,避免满屏误中。
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

   /** 关键词 → 匹配词集合(原词 + 去掉空格/符号 + 同组别名)。 */
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

   /** 一段文字是否命中任一匹配词;连空格/符号一起忽略。 */
   function searchMatch(text, variants) {
     const hay = String(text || '').toLowerCase()
     if (!hay) return false
     const flat = hay.replace(/[\s\-_./]+/g, '')
     return variants.some((v) => hay.includes(v) || flat.includes(v))
   }

   /** 命中词附近的一小段,给快搜结果做确认用。 */
   function searchSnippet(text, variants) {
     const src = String(text || '')
     const low = src.toLowerCase()
     let at = -1
     for (const v of variants) {
       const i = low.indexOf(v)
       if (i >= 0 && (at < 0 || i < at)) at = i
     }
     if (at < 0) return src.slice(0, 80)
     return (at > 24 ? '…' : '') + src.slice(Math.max(0, at - 24), at + 56) + '…'
   }

   /**
    * 在内存快照里一次搜五类。只回定位与短摘要,不拼第二份正文;
    * 保险库仍只搜标题(内容加密,快搜不碰)。
    */
   function searchSnapshot(state, query) {
     const variants = searchVariants(query)
     const empty = { query: String(query || '').trim(), variants, hits: [], total: 0 }
     if (!variants.length || !state) return empty
     const hits = []
     const add = (kind, id, title, where, extra) => hits.push({
       kind, id, title: String(title || '').slice(0, 200), where,
       updatedAt: (extra && extra.updatedAt) || 0, ...(extra || {}),
     })
     for (const n of state.notes || []) {
       if ((n.deletedAt || 0) > 0) continue
       const where = []
       if (searchMatch(n.text, variants)) where.push('正文')
       if ((n.tags || []).some((t) => searchMatch(t, variants))) where.push('标签')
       if (where.length) add('note', n.id, n.text || '（图片）', where.join('/'), { updatedAt: n.updatedAt, snippet: searchSnippet(n.text, variants) })
     }
     for (const r of state.reminders || []) {
       if ((r.deletedAt || 0) > 0) continue
       const where = []
       if (searchMatch(r.title, variants)) where.push('标题')
       if (searchMatch(r.note, variants)) where.push('备注')
       if (where.length) add('reminder', r.id, r.title || '提醒', where.join('/'), { updatedAt: r.updatedAt })
     }
     for (const l of state.links || []) {
       if ((l.deletedAt || 0) > 0) continue
       const where = []
       if (searchMatch(l.title, variants)) where.push('标题')
       if (searchMatch(l.url, variants)) where.push('网址')
       if (searchMatch(l.note, variants)) where.push('备注')
       if (searchMatch(l.group, variants)) where.push('分类')
       if (where.length) add('link', l.id, l.title || l.url, where.join('/'), { updatedAt: l.updatedAt })
     }
     for (const f of state.files || []) {
       if (f.secret || !searchMatch(f.name, variants)) continue
       add('file', f.id, f.name, '文件名', { updatedAt: f.createdAt, ownerKind: f.kind, ownerId: f.ownerId })
     }
     for (const s of state.secrets || []) {
       const where = []
       if (searchMatch(s.title, variants)) where.push('标题')
       if (searchMatch(s.collection, variants)) where.push('合集')
       if (where.length) add('secret', s.id, s.title, where.join('/'), { updatedAt: s.updatedAt || s.createdAt })
     }
     const order = { note: 0, secret: 1, reminder: 2, link: 3, file: 4 }
     hits.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || (b.updatedAt || 0) - (a.updatedAt || 0))
     return { query: String(query || '').trim(), variants, hits, total: hits.length }
   }

   const weekText = (days) => (Array.isArray(days) && days.length ? '周' + days.map((d) => WEEK[d]).join('、周') : '每天')
   /** 2026-11-16 → 11月16日 周日(侧栏头部用)。拿不到就返回空串。 */
   const fmtDay = (ymd) => {
     if (typeof ymd !== 'string') return ''
     const parts = ymd.split('-').map(Number)
     if (parts.length !== 3 || !parts[0]) return ''
     const d = new Date(parts[0], parts[1] - 1, parts[2])
     if (isNaN(d.getTime())) return ''
     return (parts[1]) + '月' + parts[2] + '日 周' + WEEK[d.getDay()]
   }

   const copy = (t) => { try { navigator.clipboard.writeText(String(t)); return true } catch { return false } }

