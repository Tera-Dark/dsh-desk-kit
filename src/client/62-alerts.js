   // ---------------------------------------------------------------- 到点提醒
   /**
    * 提醒坞:右下角,一屏最多 3 条,超过 3 条按页轮转。
    * 轮转 = 旧的一批渐隐 + 新的一批渐显(不是硬切),每条都带缓动入场。
    */
   const DOCK_MAX = 3
   const DOCK_ROTATE_MS = 6500

   /** 一屏取哪几条:page 从 0 开始,越界夹回,尾页也要填满 3 格。纯函数,好测。 */
   function dockSlice(alerts, page) {
     const total = alerts.length
     if (!total) return { shown: [], rest: 0, pages: 1, page: 0 }
     const pages = Math.max(1, Math.ceil(total / DOCK_MAX))
     const p = Math.min(Math.max(0, page | 0), pages - 1)
     const start = Math.min(p * DOCK_MAX, Math.max(0, total - DOCK_MAX))
     const shown = alerts.slice(start, start + DOCK_MAX)
     return { shown: shown, rest: total - shown.length, pages: pages, page: p }
   }

   function alertMeta(a) {
     return a.text || ('计划 ' + fmtClock(a.dueAt))
   }

   /** 卡片上半句:错过的 / 到点了 / 快到点了。 */
   function alertHead(a) {
     if (a.late) return '错过的提醒 · '
     return a.over ? '到点了 · ' : '快到点了 · '
   }

   const SNOOZE_CHOICES = [[10, '10 分钟'], [30, '30 分钟'], [60, '1 小时']]

   function AlertCard({ a, run, onOpen, quiet }) {
     const over = !!a.over
     const [menu, setMenu] = useState(false)
     const [err, setErr] = useState('')   // 卡片自己的错:处理失败时卡片不会消失,得就近说一句
     // 先 ack 再 snooze:ack 会把当天记成静音,snooze 要把静音解除 —— 顺序反了就永远不响
     const snooze = async (minutes) => {
       setErr('')
       await run('alert.ack', { id: a.id })
       const body = await run('reminder.snooze', { id: a.refId, minutes })
       // ack 已经把今天静音了;稍后要是没设上,这条今天就再也不会响 —— 必须说清楚
       if (!writeOk(body)) setErr('稍后没设上,今天这条已被静音,到「提醒」里改时间')
       setMenu(false)
     }
     return h('div', { className: '__dk_alert' + (over ? '' : ' __dk_alert--calm') }, [
       h('div', { key: 'hd', className: '__dk_ahead' }, [
         h('span', { key: 'i', className: '__dk_aicon' }, h(Ico, { name: over ? 'bell' : 'clock', size: 13 })),
         h('div', { key: 'm', className: '__dk_amain' }, [
           h('div', { key: 't', className: '__dk_atitle', title: a.title }, a.title),
           h('div', { key: 's', className: '__dk_ameta' }, alertHead(a) + alertMeta(a)),
         ]),
         h('button', {
           key: 'x', className: '__dk_ax', title: '知道了(不再提醒)',
           onClick: () => run('alert.ack', { id: a.id }),
         }, h(Ico, { name: 'x', size: 13 })),
       ]),
       h('div', { key: 'r', className: '__dk_trow' }, [
         h('button', {
           key: 'c', className: '__dk_tbtn p', title: '标记今天已完成',
           onClick: async () => {
             setErr('')
             const done = await run('reminder.checkin', { id: a.refId, date: a.dueDate })
             // 打卡没成功就别 ack:否则提醒没完成、卡片也没了,等于把这件事吞掉
             if (!writeOk(done)) { setErr('没打卡成功,再点一次'); return }
             await run('alert.ack', { id: a.id })
           },
         }, '完成'),
         h('button', {
           key: 's', className: '__dk_tbtn', title: '晚点再提醒', onClick: () => setMenu((v) => !v),
         }, menu ? '稍后 ▴' : '稍后 ▾'),
         onOpen ? h('button', { key: 'o', className: '__dk_tbtn', title: '打开随手台', onClick: onOpen }, '打开') : null,
       ]),
       menu
         ? h('div', { key: 'menu', className: '__dk_chips' }, SNOOZE_CHOICES.map(([m, label]) =>
           h('button', { key: m, className: '__dk_chip', onClick: () => snooze(m) }, label)))
         : null,
       err ? h('div', { key: 'err', className: '__dk_aerr', role: 'alert' }, err) : null,
     ])
   }

   /**
    * 右下角提醒坞:多条时按页轮转。
    * model 是纯函数式的:page 由 effect 每 DOCK_ROTATE_MS 推一格,切换前先 fade 300ms。
    */
   function AlertDock({ alerts, run, onOpen, offsetBottom, onAllAck }) {
     const [page, setPage] = useState(0)
     const [fading, setFading] = useState(false)
     // 人正在读的时候不能把卡片换掉。鼠标移上去 / 键盘聚焦 / 指头按着,都算「正在看」。
     const [paused, setPaused] = useState(false)
     const total = alerts.length
     const pages = Math.max(1, Math.ceil(total / DOCK_MAX))

     // 条数变少时把页码夹回合法范围
     useEffect(() => { setPage((p) => Math.min(p, Math.max(0, pages - 1))) }, [pages])

     useEffect(() => {
       if (pages < 2 || paused) { setFading(false); return }
       let outTimer = null
       const tick = setInterval(() => {
         setFading(true)
         outTimer = setTimeout(() => { setPage((p) => (p + 1) % pages); setFading(false) }, 300)
       }, DOCK_ROTATE_MS)
       return () => { clearInterval(tick); if (outTimer) clearTimeout(outTimer) }
     }, [pages, paused])

     if (!total) return null
     const { shown, rest } = dockSlice(alerts, page)

     const off = Number.isFinite(offsetBottom) && offsetBottom > 0 ? offsetBottom : 0
     return h('div', {
       className: '__dk_dock' + (paused ? ' __dk_dock--paused' : ''),
       title: pages > 1 ? (paused ? '已暂停轮播' : '多条提醒在轮播:鼠标移上去可以停下来慢慢看') : null,
       onMouseEnter: () => setPaused(true),
       onMouseLeave: () => setPaused(false),
       onPointerDown: () => setPaused(true),
       onFocusCapture: () => setPaused(true),
       onBlurCapture: () => setPaused(false),
       style: Object.assign(
         { opacity: fading ? 0 : 1, transition: 'opacity .3s ease' },
         off ? { bottom: (22 + off) + 'px' } : null,
       ),
     }, [
       rest > 0 || pages > 1
         ? h('button', {
           key: 'more', className: '__dk_dockmore', title: '把所有提醒标为已读',
           onClick: async () => {
             const body = await run('alert.ackAll')
             // 没标成功就别弹「全部标为已读」:回执说了假话,人就不会再看第二眼
             if (!writeOk(body)) return
             if (onAllAck) onAllAck()
           },
         }, rest > 0 ? '还有 ' + rest + ' 条 · 全部知道了' : '全部知道了')
         : null,
       ...shown.map((a) => h(AlertCard, { key: a.id, a, run, onOpen })),
     ])
   }

   /** 侧栏页里的同款提醒,横排一条一条铺开(不是浮层)。 */
   function AlertInline({ alerts, run }) {
     if (!alerts || !alerts.length) return null
     return h('div', { className: '__dk_inline' }, [
       h('span', { key: 'i', className: '__dk_aicon' }, h(Ico, { name: 'bell', size: 13 })),
       h('div', { key: 'm', className: '__dk_amain' }, [
         h('div', { key: 't', className: '__dk_atitle' }, alerts.length === 1 ? alerts[0].title : (alerts[0].title + ' 等 ' + alerts.length + ' 项')),
         h('div', { key: 's', className: '__dk_ameta' }, alerts.length === 1 ? alertMeta(alerts[0]) : '点下面的按钮处理,或切到「提醒」页'),
       ]),
       h('button', {
         key: 'go', className: '__dk_chip',
         onClick: () => { run('alert.ackAll') },
       }, '全部知道了'),
     ])
   }

   function HeaderButton() {
     const [due, setDue] = useState(0)
     useEffect(() => {
       let alive = true
       const tick = async () => {
         try { const s = await apiGetOrLast(); if (alive && s) setDue(dueCount(s)) } catch { /* 拉不到就保持原样 */ }
       }
       tick()
       const t = setInterval(tick, 60000)
       return () => { alive = false; clearInterval(t) }
     }, [])
     return h('button', {
       type: 'button', className: '__dk_hbtn', title: '随手台' + (due ? '(' + due + ' 项待办)' : ''), onClick: requestOpen,
     }, [
       h(Ico, { key: 'i', name: 'clipboard', size: 16 }),
       due ? h('span', { key: 'd', className: '__dk_hdot' }, String(due)) : null,
     ])
   }
   const TABS = [
     ['reminders', 'bell', '提醒'],
     ['notes', 'note', '便签'],
     ['links', 'grid', '网页'],
     ['vault', 'lock', '保险库'],
   ]

   /** 底部导航:左右各两格,中间是首页圆键。 */
   function TabBar({ page, go, due }) {
     const half = (items) => items.map(([id, icon, label]) => h('button', {
       key: id, className: '__dk_tab' + (page === id ? ' on' : ''), onClick: () => go(id),
     }, [h(Ico, { key: 'i', name: icon, size: 20 }), h('span', { key: 'l' }, label)]))
     return h('div', { className: '__dk_tabbar' }, [
       ...half(TABS.slice(0, 2)),
       h('button', { key: 'home', className: '__dk_tabhome', title: '首页', onClick: () => go('home') },
         [h(Ico, { key: 'i', name: 'home', size: 21 }), due ? h('span', { key: 'd', className: '__dk_dot' }, String(due)) : null]),
       ...half(TABS.slice(2)),
     ])
   }

   function Root({ bridge }) {
     const sidebar = useSidebarBridge(bridge)
     const [open, setOpen] = useState(false)
     const [fab, setFab] = useState(defaultFab)
     const [dragging, setDragging] = useState(false)
     const [fabRect, setFabRect] = useState(null)
     const [panelShift, setPanelShift] = useState({ dx: 0, dy: 0 })
     const shiftTries = useRef(0)
     const drag = useRef(null)
     const fabEl = useRef(null)
     const panelEl = useRef(null)
     const [page, setPage] = useState('home')
     const [dir, setDir] = useState('left')
     const [seq, setSeq] = useState(0)
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [reply, setReply] = useState(null)
     // 从快搜点进来时要定位的条目(保险库会自动展开)
     const [focus, setFocus] = useState(null)
     // 撤销后回填到输入框的原话
     const [seed, setSeed] = useState('')
     const touch = useRef({ x: 0, y: 0, t: 0 })
     const timer = useRef(null)
     const timerOut = useRef(null)
     const capToken = useRef('')

     const load = useCallback(async () => {
       try {
         const st = await apiGet()
         if (st) setState(st)     // null = 304:内容没变,保持原样
         setErr('')
       } catch (e) { setErr(String((e && e.message) || e)) }
     }, [])
     usePoll(load)
     useAlertSound(state && state.settings, state && state.alerts)

     // 位置:首屏读存档,改窗口大小时别把它挤到屏幕外
     useEffect(() => {
       const v = viewport()
       const saved = loadFab(v.w, v.h)
       if (saved) setFab((cur) => ({ ...cur, ...saved, side: saved.x + FAB_SIZE / 2 < v.w / 2 ? 'left' : 'right' }))
       const onResize = () => {
         const v2 = viewport()
         setFab((cur) => { const c = clampFab(cur.x, cur.y, v2.w, v2.h); return { ...cur, ...c } })
       }
       window.addEventListener('resize', onResize)
       return () => window.removeEventListener('resize', onResize)
     }, [])

     // 侧门(顶栏图标 / 快捷键)统一走这条事件。
     // 有侧栏标签页就交给它;浮标只在「没装侧栏」或「用户显式打开浮标」时才弹。
     const floatRef = useRef(false)
     useEffect(() => { floatRef.current = floatEnabled(state, sidebar.ready) }, [state, sidebar.ready])
     useEffect(() => {
       const onOpen = () => {
         // 有侧栏标签页:apply() 那条监听已经负责打开它,这里别再开一次
         if (sidebar.open) return
         if (state && !floatRef.current) return
         setOpen(true); load(); setPage('home'); setFocus(null); setSeq((s) => s + 1)
       }
       window.addEventListener(OPEN_EVENT, onOpen)
       return () => window.removeEventListener(OPEN_EVENT, onOpen)
     }, [load, state])

     useEffect(() => {
       const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
       window.addEventListener('keydown', onKey)
       return () => window.removeEventListener('keydown', onKey)
     }, [])

     // 点面板外面关掉浮层面板 —— 这是浮层的默认习惯。
     // 点在面板里/浮标上/提醒坞里都不关:提醒坞的「打开」要自己处理。
     useEffect(() => {
       if (!open) return undefined
       const onDown = (e) => {
         const t = e.target
         const inside = (el) => {
           try { return !!(el && t && el.contains(t)) } catch { return false }
         }
         if (inside(panelEl.current) || inside(fabEl.current)) return
         if (t && typeof t.closest === 'function' && t.closest('.__dk_dock')) return
         setOpen(false)
       }
       document.addEventListener('pointerdown', onDown, true)
       return () => document.removeEventListener('pointerdown', onDown, true)
     }, [open])

     const run = useCallback(async (action, payload) => {
       try {
         const body = await apiPost(action, payload)
         if (body.state) setState(body.state)
         setErr('')
         return body
       } catch (e) { setErr(String((e && e.message) || e)); return null }
     }, [])

     // notify(text) 									只报一句
     // notify(text, {action, payload}) 		顺手给一个「撤销」,6 秒内可点
     const showReply = useCallback((text, undo, move, meta) => {
       if (timer.current) clearTimeout(timer.current)
       if (timerOut.current) clearTimeout(timerOut.current)
       if (!text) { setReply(null); return }
       const life = undo ? 6500 : 4200
       setReply({ text: text, undo: undo || null, move: move || null, ...(meta || {}), leaving: false, life })
       // 先淡出,再从 DOM 拿掉;直接消失会像页面闪了一下
       timer.current = setTimeout(() => {
         setReply((cur) => (cur ? { ...cur, leaving: true } : cur))
         timerOut.current = setTimeout(() => setReply(null), 260)
       }, life)
     }, [])

    /** 面板里收到的文件:上传完直接存成一条便签(给 6 秒撤销)。 */
    const saveMetas = useCallback(async (metas) => {
      if (!metas || !metas.length) return
      const r = await run('note.add', { text: '', files: metas.map((m) => m.id) })
      if (r && r.result) showReply('已存下 ' + metas.length + ' 个附件,在便签里', { action: 'note.purge', payload: { id: r.result.id } })
      else showReply('没存上,再试一次')
    }, [run, showReply])

    const intake = useCallback(async (files) => {
      const list = Array.from(files || []).slice(0, 8)
      if (!list.length) return
      try {
        const metas = []
        for (const f of list) metas.push(await uploadFile(f, shotName(f)))
        await saveMetas(metas)
      } catch (err) {
        showReply('没存上:' + String((err && err.message) || err))
      }
    }, [saveMetas, showReply])

    /** 粘贴不一定是文件:网页图片走宿主下载,本地路径只提示,不把路径当文字存。 */
    const intakePaste = useCallback(async (src) => {
      if (!src) return
      if (src.files) return intake(src.files)
      if (src.localPath) { showReply(LOCAL_PASTE_TIP); return }
      try {
        let meta = null
        if (src.dataUrl) {
          const file = await fileFromDataUrl(src.dataUrl)
          meta = await uploadFile(file, shotName(file))
        } else if (src.url) {
          meta = await uploadFromUrl(src.url)
        }
        if (meta) await saveMetas([meta])
      } catch (err) {
        showReply('图片没贴进来:' + String((err && err.message) || err))
      }
    }, [intake, saveMetas, showReply])
     const go = useCallback((next, opts) => {
       setDir(ORDER.indexOf(next) >= ORDER.indexOf(page) ? 'left' : 'right')
       setPage(next)
       setFocus(opts || null)
       setSeq((s) => s + 1)
     }, [page])

     const move = useCallback((step) => {
       const i = ORDER.indexOf(page) + step
       if (i < 0 || i >= ORDER.length) return
       go(ORDER[i])
     }, [page, go])

     // 深链 ?dk=capture:打开面板并落到首页输入框。
     // 有侧栏时让侧栏接(它自己也有同一个监听),浮标不抢。
     useEffect(() => {
       const onCapture = (e) => {
         const d = (e && e.detail) || {}
         if (!d.token || capToken.current === d.token) return
         capToken.current = d.token
         if (sidebar.open) return
         setOpen(true)
         load()
         setSeed(String(d.text || '').slice(0, 2000))
         go('home')
       }
       window.addEventListener(CAPTURE_EVENT, onCapture)
       return () => window.removeEventListener(CAPTURE_EVENT, onCapture)
     }, [sidebar.open, load, go])

     // ------------- 浮标:拖哪停哪,松手吸边
     const toggle = useCallback(() => {
       if (open) { setOpen(false); return }
       setOpen(true); load(); go('home')
     }, [open, load, go])

     const onFabDown = (e) => {
       if (e.pointerType === 'mouse' && e.button !== 0) return
       // 记「起点指针位置 + 起点状态位」,拖动时按**增量**移动:
       // 宿主的浮层容器有缩放时,屏幕上的 1px 不等于状态位里的 1px,增量法才能两面对齐。
       drag.current = { sx: e.clientX, sy: e.clientY, fx: fab.x, fy: fab.y, moved: false }
       setDragging(true)
       try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老浏览器没有指针捕获 */ }
     }
     const onFabMove = (e) => {
       const d = drag.current
       if (!d) return
       const dx = e.clientX - d.sx
       const dy = e.clientY - d.sy
       if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
       // 祖先缩放比例(没有祖先/量不到就是 1)
       const s = (originOf(fabRect, fab).s) || 1
       const v = viewport()
       const c = clampFab(d.fx + dx / s, d.fy + dy / s, v.w, v.h)
       setFab((cur) => ({ ...cur, x: c.x, y: c.y }))
       // 拖动过程中让面板实时跟着走(读真实矩形,不猜)
       try {
         const el = fabEl.current
         if (el && typeof el.getBoundingClientRect === 'function') {
           const r = el.getBoundingClientRect()
           if (r && (r.width || r.height)) setFabRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
         }
       } catch { /* 量不到就等松手再量 */ }
     }
     const onFabUp = () => {
       const d = drag.current
       drag.current = null
       setDragging(false)
       if (!d) return
       if (!d.moved) { toggle(); return }        // 没拖动 = 点击
       const v = viewport()
       setFab((cur) => { const s = snapFab(cur, v.w, v.h); saveFab(s); return s })
     }

     /** 量浮标在视口里的真实位置。用 getBoundingClientRect:宿主的浮层容器有
      *  transform/缩放/滚动都不影响,算出来的是「屏幕上真正在哪」。 */
     const measureFab = useCallback(() => {
       const el = fabEl.current
       if (!el || typeof el.getBoundingClientRect !== 'function') { setFabRect(fabRectOf(fab)); return }
       const r = el.getBoundingClientRect()
       if (!r || (!r.width && !r.height)) { setFabRect(fabRectOf(fab)); return }
       setFabRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
     }, [fab])

     // 打开时、拖动结束后、窗口变化时都要重新量;面板开着时浮标一挪就跟着挪
     useEffect(() => { measureFab() }, [measureFab, open, dragging])
     // 浮标一挪或面板开关一次,微调量归零重算(否则会带着旧位移量越跑越偏)
     useEffect(() => { shiftTries.current = 0; setPanelShift({ dx: 0, dy: 0 }) }, [open, fabRect])
     // 宿主容器一旦有 transform,position:fixed 的参照物会跟着它滚;滚动/缩放都要重新量,
     // 否则面板会在你把聊天区滚上去之后慢慢飘出屏幕。
     useEffect(() => {
       const remeasure = () => measureFab()
       window.addEventListener('resize', remeasure)
       window.addEventListener('scroll', remeasure, true)
       const vv = window.visualViewport
       if (vv) { vv.addEventListener('resize', remeasure); vv.addEventListener('scroll', remeasure) }
       return () => {
         window.removeEventListener('resize', remeasure)
         window.removeEventListener('scroll', remeasure, true)
         if (vv) { vv.removeEventListener('resize', remeasure); vv.removeEventListener('scroll', remeasure) }
       }
     }, [measureFab])

     /**
      * 兜底:P1 算出来之后,再拿面板自己的**真实矩形**对一次视口。
      * 任何祖先有 transform / 缩放 / 滚动,或者宿主改了浮层容器尺寸,都能被这一步拉回屏幕内
      * (translate 反复微调,最多 8 次,必然收敛)。这条是「绝不出屏」的最后保险。
      */
     useEffect(() => {
       if (!open || !state) return
       const el = panelEl.current
       if (!el || typeof el.getBoundingClientRect !== 'function') return
       const v = viewport()
       const r = el.getBoundingClientRect()
       if (!r.width || !r.height) return
       const { dx, dy } = nudgeIntoView(r, v.w, v.h, 8)
       if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
       if (shiftTries.current >= 8) return
       shiftTries.current += 1
       // translate 也在祖先坐标系里,先换算回本地单位,否则缩放后会被放大/缩小
       const s = (originOf(fabRect, fab).s) || 1
       setPanelShift((cur) => ({ dx: cur.dx + dx / s, dy: cur.dy + dy / s }))
     }, [open, state, fabRect, panelShift])

     // 触屏和鼠标拖动都走 pointer 事件
     const onPointerDown = (e) => {
       touch.current = { x: e.clientX, y: e.clientY, t: Date.now() }
     }
     const onPointerUp = (e) => {
       if (!touch.current.t) return
       const dx = e.clientX - touch.current.x
       const dy = e.clientY - touch.current.y
       touch.current = { x: 0, y: 0, t: 0 }
       if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1)
     }

     /**
      * 存完给一条回执,并且允许撤销 —— 存错类别是最常见的一次性失误:
      * 撤销会删掉刚建的那条,把原话塞回输入框,改个说法就能重来。
      */
     const onCaptureDone = useCallback((r) => {
       if (!r) return
       const c = r.created
       const raw = (r.parsed && (r.parsed.raw || r.parsed.text)) || ''
       let undo = null
       // 去重命中时没有「新建」这回事,别给出会删掉旧便签的撤销
       if (c && c.kind === 'link' && c.id && !c.deduped) undo = { action: 'link.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'note' && c.id && !c.deduped) undo = { action: 'note.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'reminder' && c.id && !c.deduped) undo = { action: 'reminder.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'secret' && c.id) undo = { action: 'secret.delete', payload: { query: c.id }, after: () => setSeed(raw) }
       // 刚建出来的这条可以在回执里直接改分类(去重命中时挪的是旧条目,不给)
       const move = c && c.id && !c.deduped ? { kind: c.kind, id: c.id } : null
       showReply(r.reply || '已保存', undo, move, captureToast(r))
       setFocus(null)
       // 存完**不切页**:连记三件事的人不用每存一条就点一次「首页」。
       // 想去那类里看,回执上有「去看看」按钮(goPage)。
     }, [showReply])

     const onCaptureFail = useCallback(() => {
       showReply('没存上,请检查连接后再试', null, null, { label: '保存失败', title: '这次没有存进去', tone: 'err' })
     }, [showReply])

     const onLink = useCallback(async (r) => {
       const v = window.prompt('粘贴要打开的网址(留空可清除)', r.url || '')
       if (v === null) return
       await run('reminder.update', { id: r.id, url: String(v).trim() })
       showReply(String(v).trim() ? '已绑定打开链接' : '已清除链接')
     }, [run, showReply])

     const fabStyle = { left: Math.round(fab.x) + 'px', top: Math.round(fab.y) + 'px' }
     const fabNode = h('button', {
       key: 'fab', ref: fabEl,
       className: '__dk_fab' + (dragging ? ' __dk_dragging' : ''),
       title: '随手台 · 按住可拖动,松手吸边;点一下开合',
       onPointerDown: onFabDown, onPointerMove: onFabMove, onPointerUp: onFabUp, onPointerCancel: onFabUp,
     }, [h(Ico, { key: 'i', name: 'clipboard', size: 21 }), (state ? dueCount(state) : 0) ? h('span', { key: 'b', className: '__dk_badge' }, String(dueCount(state))) : null])

     if (!state) {
       // 装了侧栏标签页时连首屏这一下都不闪浮标(设置里显式开浮标的等状态加载后自然出现)
       if (sidebar.ready) return null
       return h('div', { className: '__dk_root', style: fabStyle }, [
         err ? h(ErrorBar, { key: 'e', text: err, onRetry: load }) : null,
         fabNode,
       ])
     }

     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const due = dueCount(state)
     // 浮标只是兜底入口:侧栏标签页在的时候默认不画,免得挡视线。
     // 但**到点提醒不能跟着消失** —— 只留 toast,不带浮标和面板。
     const showFab = floatEnabled(state, sidebar.ready)
     const goTo = go
     const lv = LEVELS[page] || LEVELS.home
     const body = (() => {
       const notify = showReply
       if (page === 'home') return [h(CaptureBar, { key: 'cap', run, onDone: onCaptureDone, onFail: onCaptureFail, seed, onSeedUsed: () => setSeed('') }), h(Home, { key: 'home', state, run, onLink, onGo: goTo, notify })]
       if (page === 'reminders') return [h(RemindersPage, { key: 'r', state, run, notify })]
       if (page === 'notes') return [h(NotesPage, { key: 'n', state, run, notify, onGo: goTo, focus })]
       if (page === 'links') return [h(LinksPage, { key: 'w', state, run, notify })]
       if (page === 'vault') return [h(VaultPage, { key: 'v', state, run, notify, focus })]
       return [h(Settings, { key: 's', state, run, sidebarReady: sidebar.ready })]
     })()

     return h(React.Fragment, null, [
       // 浮标开着时把坞抬高,别跟它叠在同一个角落
       h(AlertDock, {
         key: 'dock', alerts, run,
         onOpen: () => { if (sidebar.open) { sidebar.open(); return } setOpen(true) },
         offsetBottom: showFab ? 62 : 0,
         onAllAck: () => showReply('全部标为已读', { action: 'alert.unackAll', payload: {} }),
       }),

       showFab ? h('div', { key: 'root', className: '__dk_root', style: fabStyle }, [
         open ? h('div', {
           key: 'panel', ref: panelEl, className: '__dk_panel',
           style: Object.assign(
             (() => {
               const v = viewport()
               const rect = fabRect || fabRectOf(fab)
               const box = layoutPanel(rect, v.w, v.h)
               const local = toLocal(box, originOf(fabRect, fab))
               return {
                 left: Math.round(local.left) + 'px', top: Math.round(local.top) + 'px',
                 width: Math.round(local.width) + 'px', height: Math.round(local.height) + 'px',
               }
             })(),
             panelShift.dx || panelShift.dy ? { transform: 'translate(' + Math.round(panelShift.dx) + 'px,' + Math.round(panelShift.dy) + 'px)' } : null,
           ),
         }, [
           h('div', { key: 'h', className: '__dk_head' }, [
             h('div', { key: 't', className: '__dk_titlewrap' }, [
               h('div', { key: 'tt', className: '__dk_title' }, [
                 TITLES[page] || '随手台',
                 // 只显示中文档位名:「L3 备查」对头一天用的人只是三个字 + 一个数字要他去猜。
                 // 代号留在 tooltip 里,想深究的人一样查得到。
                 h('span', { key: 'l', className: '__dk_lvl', style: { color: lv.color }, title: lv.code + ' · ' + lv.name + ':' + (lv.hint || '') }, [
                   h('i', { key: 'i' }), lv.name,
                 ]),
               ]),
               // 标题下面一条轻量状态:日期 + 待办,不用切到首页也知道今天有没有事
               h('div', { key: 'st', className: '__dk_subtitle' },
                 fmtDay(state.today) + (due ? ' · ' + due + ' 项待办' : ' · 今日无待办')),
             ]),
             h('div', { key: 'act', className: '__dk_headact' }, [
               h('button', {
                 key: 's', className: '__dk_icobtn' + (page === 'settings' ? ' on' : ''), title: '设置',
                 onClick: () => go('settings'),
               }, h(Ico, { name: 'gear', size: 16 })),
               h('button', { key: 'x', className: '__dk_icobtn', title: '关闭 (Esc)', onClick: () => setOpen(false) }, h(Ico, { name: 'x', size: 17 })),
             ]),
           ]),            h('div', {
             key: 'body', className: '__dk_body', onPointerDown, onPointerUp,
             // 截完图直接 Ctrl+V:不用先切到便签页,也不用手动点上传
             onPaste: (e) => {
               const src = clipboardImage(e.clipboardData)
               if (!src) return
               e.preventDefault()
               intakePaste(src)
             },
             onDragOver: (e) => { if (filesFromDataTransfer(e.dataTransfer).length) e.preventDefault() },
             onDrop: (e) => {
               const files = filesFromDataTransfer(e.dataTransfer)
               if (!files.length) return
               e.preventDefault()
               intake(files)
             },
           }, [
             h(ReplyBar, { key: 'reply', reply, run, onClear: () => showReply(''), onSay: showReply, onGo: goTo }),
             err ? h(ErrorBar, { key: 'err', text: err, onRetry: load }) : null,
             // key 带 seq:切页整块重建,滑屏动画才会重放
             h('div', { key: 'page-' + page + '-' + seq, className: '__dk_page __dk_page--' + dir },
               h(SafePage, null, body)),
           ]),
           h(TabBar, { key: 'tabbar', page, go, due }),
         ]) : null,
         fabNode,
       ]) : null,
     ])
   }

