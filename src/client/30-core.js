
   function injectCss() {
     if (typeof document === 'undefined') return
     const id = 'dsh-desk-kit/main.css'
     if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
     const tag = document.createElement('style')
     tag.dataset.plugin = 'dsh-desk-kit'
     tag.dataset.pluginCss = id
     tag.textContent = CSS
     document.head.appendChild(tag)
   }

   // 服务端要求这个头:跨源页面想带就得先发预检,而我们从不应答 CORS,于是拿不到。
   const HEAD = { 'x-desk-kit': '1' }

   // 上一次快照的 ETag:内容没变时服务端回 304(不传那 1MB 的 JSON)
   let lastEtag = ''
   let lastState = null

   /**
    * 读快照。命中 304 返回 null —— 调用方必须「保持原样」,不能当成空数据。
    * 顺手记住上一份 state:同一面板里多处并发调用(浮标角标 + 当前页)时,
    * 拿到 304 的那一处能直接用上一份,不必再发一次请求。
    */
   async function apiGet() {
     const headers = lastEtag ? { ...HEAD, 'if-none-match': lastEtag } : HEAD
     const res = await fetch(API, { cache: 'no-store', headers })
     if (res.status === 304) return null
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     const tag = res.headers && res.headers.get ? res.headers.get('etag') : ''
     if (tag) lastEtag = tag
     lastState = body.state
     return body.state
   }

   /** 给「必须有数据」的地方用:304 就回上一份。 */
   async function apiGetOrLast() {
     const st = await apiGet()
     return st || lastState
   }
   async function apiPost(action, payload) {
     const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...HEAD }, body: JSON.stringify({ action, payload: payload || {} }) })
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     return body
   }

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

   const fmtClock = (ts) => { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
   const fmtWhen = (ts) => { const d = new Date(ts); const n = new Date(); return d.toDateString() === n.toDateString() ? '今天 ' + fmtClock(ts) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(ts) }
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
         ? h('img', { key: 'i', className: '__dk_lightimg', src: fileUrl(file.id), alt: file.name, onClick: (e) => e.stopPropagation() })
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

