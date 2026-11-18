   // ---------------------------------------------------------------- 侧边栏页面(dsh-better-sidebar)
   /**
    * 侧栏桥:better-sidebar 服务可能比本插件晚就绪,也可能先就绪后卸载。
    * 每次 apply 建一个实例,由槽位闭包与 effect 持有 —— 不再用模块级可变布尔量。
    */
   function createSidebarBridge() {
     const listeners = new Set()
     let state = { ready: false, open: null }
     return {
       read() { return state },
       write(next) {
         state = next
         for (const fn of [...listeners]) {
           try { fn(state) } catch (error) { /* 一个订阅者渲染出错不能连累其他订阅者 */ }
         }
       },
       subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
     }
   }

   /** 订阅侧栏桥:标签页就绪与否会改变浮标是否兜底,渲染必须跟着走 */
   function useSidebarBridge(bridge) {
     const [snapshot, setSnapshot] = useState(() => (bridge ? bridge.read() : { ready: false, open: null }))
     useEffect(() => {
       if (!bridge) return undefined
       setSnapshot(bridge.read())
       return bridge.subscribe(setSnapshot)
     }, [bridge])
     return snapshot
   }

   /** 浮标开不开放:settings.floatFab 显式 true 才开;没设过时只在没有侧栏服务时兜底开 */
   function floatEnabled(state, sidebarReady) {
     const v = state && state.settings ? state.settings.floatFab : undefined
     if (v === true) return true
     if (v === false) return false
     return !sidebarReady
   }

   function SidebarIcon({ size }) {
     return h(Ico, { name: 'clipboard', size: size || 16 })
   }

   function SidebarPage({ visible, bridge }) {
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [page, setPage] = useState('home')
     const [seq, setSeq] = useState(0)
     const [reply, setReply] = useState(null)
     // 撤销后回填到输入框的原话
     const [seed, setSeed] = useState('')
     const timer = useRef(null)

     const load = useCallback(async () => {
       try {
         const st = await apiGet()
         if (st) setState(st)     // null = 304:内容没变,保持原样
         setErr('')
       } catch (e) { setErr(String((e && e.message) || e)) }
     }, [])
     useAlertSound(state && state.settings, state && state.alerts)

     // 侧栏标签页没打开时完全不轮询(以前后台也每 20 秒拉一遍全量)
     useEffect(() => {
       if (!visible) return undefined
       load()
       const t = setInterval(load, 20000)
       return () => clearInterval(t)
     }, [visible, load])

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
     const showReply = useCallback((text, undo, move) => {
       setReply(text ? { text: text, undo: undo || null, move: move || null } : null)
       if (timer.current) clearTimeout(timer.current)
       if (!text) return
       timer.current = setTimeout(() => setReply(null), undo ? 6000 : 3500)
     }, [])

     const go = useCallback((next) => { setPage(next); setSeq((s) => s + 1) }, [])

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
       showReply(r.reply || '已保存', undo, move)
       if (r.parsed && r.parsed.kind === 'link') { setPage('links'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'secret') { setPage('vault'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'note') { setPage('notes'); setSeq((s) => s + 1) }
       else setPage('home')
     }, [showReply])

     const onLink = useCallback(async (r) => {
       const v = window.prompt('粘贴要打开的网址(留空可清除)', r.url || '')
       if (v === null) return
       await run('reminder.update', { id: r.id, url: String(v).trim() })
       showReply(String(v).trim() ? '已绑定打开链接' : '已清除链接')
     }, [run, showReply])

     return h(SidebarView, {
       state, page, seq, reply, err, run, bridge, onRetry: load,
       onGo: go, onCaptureDone, onLink,
       notify: showReply,
       onClearReply: () => showReply(''),
       seed,
       onSeedUsed: () => setSeed(''),
     })
   }

   /** 侧栏页面的纯展示部分:状态由 SidebarPage 喂进来(这样能脱离浏览器直接测)。 */
   function SidebarView({ state, page, seq, reply, err, run, onGo, onCaptureDone, onLink, onClearReply, notify, seed, onSeedUsed, bridge, onRetry }) {
     const sidebar = useSidebarBridge(bridge)
     const goTo = onGo
     if (!state) {
       return h('div', { className: '__dk_sp' }, [
         h('div', { key: 'b', className: '__dk_spbody' }, err ? h(ErrorBar, { text: err, onRetry }) : h('div', { className: '__dk_hint' }, '正在读取…')),
       ])
     }

     const due = dueCount(state)
     const lv = LEVELS[page] || LEVELS.home
     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const body = (() => {
       // notify 由 SidebarPage 注入(这里没有自己的 showReply)
       if (page === 'home') return [h(CaptureBar, { key: 'cap', run, onDone: onCaptureDone, seed, onSeedUsed: () => setSeed('') }), h(Home, { key: 'home', state, run, onLink, onGo: goTo, notify })]
       if (page === 'reminders') return [h(RemindersPage, { key: 'r', state, run, notify })]
       if (page === 'notes') return [h(NotesPage, { key: 'n', state, run, notify })]
       if (page === 'links') return [h(LinksPage, { key: 'w', state, run, notify })]
       if (page === 'vault') return [h(VaultPage, { key: 'v', state, run, notify })]
       return [h(Settings, { key: 's', state, run, sidebarReady: sidebar.ready })]
     })()
     // 顶部横排:首页放第一格(浮标里的底部导航是另一套顺序,各用各的)
     const tabs = SIDEBAR_ORDER.map((id) => h('button', {
       key: id,
       className: '__dk_stab' + (page === id ? ' on' : ''),
       title: PANEL_LABELS[id],
       onClick: () => onGo(id),
     }, [h(Ico, { key: 'i', name: PANEL_ICONS[id], size: 16 }), h('span', { key: 'l' }, PANEL_LABELS[id])]))

     return h('div', { className: '__dk_sp' }, [
       h('div', { key: 'head', className: '__dk_sphead' }, [
         h('div', { key: 't', className: '__dk_sptitle' }, [
           '随手台',
           h('span', { key: 'l', className: '__dk_lvl', style: { color: lv.color }, title: '重要等级:' + lv.name }, [h('i', { key: 'i' }), lv.code + ' ' + lv.name]),
           due ? h('span', { key: 'd', className: '__dk_spdot' }, String(due)) : null,
         ]),
         h('div', { key: 'v', className: '__dk_note', title: 'Ctrl/Cmd+Shift+K 也能直接跳到这里' },
           fmtDay(state.today) + (due ? ' · ' + due + ' 项待办' : ' · 暂无待办')),
       ]),
       h('div', { key: 'nav', className: '__dk_spnav' }, tabs),
       h('div', { key: 'body', className: '__dk_spbody' }, [
         // 提醒主视觉在右下角提醒坞;这里只留一条紧凑状态条,不重复堆卡片
         h(AlertInline, { key: 'alerts', alerts, run }),
         h(ReplyBar, { key: 'reply', reply, run, onClear: onClearReply }),
         h(ReplyMove, { key: 'rmove', reply, run, onSay: onClearReply ? (t) => showReply(t) : null }),
         err ? h(ErrorBar, { key: 'err', text: err, onRetry }) : null,
         h('div', { key: 'page-' + page + '-' + seq, className: '__dk_page' }, h(SafePage, null, body)),
       ]),
     ])
   }

   /**
    * 设置 → 插件 里的入口卡片(plugins.bundle.config / plugins.row.config)。
    * 为什么要有:随手台的主入口是侧栏标签页,不装侧栏插件时是右下角浮标 ——
    * 两种都藏在「界面」里,而人找设置第一反应是「设置 → 插件」。这里放一张真正的
    * 控制面板:版本、当前存量、三个开关、备份,和「打开随手台」。
    */
   function PluginCard({ view }) {
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [busy, setBusy] = useState(false)
     useEffect(() => {
       let alive = true
       apiGet().then((st) => { if (alive && st) setState(st) }).catch((e) => { if (alive) setErr(String((e && e.message) || e)) })
       return () => { alive = false }
     }, [])
     const set = async (patch) => {
       setBusy(true)
       try {
         const body = await apiPost('settings.update', patch)
         if (body && body.state) setState(body.state)
       } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
     }
     const open = () => { try { requestOpen() } catch (e) { setErr('叫不醒面板:' + String((e && e.message) || e)) } }
     const backup = async () => {
       try {
         const r = await fetch(API + '/export', { headers: HEAD })
         const data = await r.json()
         const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' })
         const a = document.createElement('a')
         a.href = URL.createObjectURL(blob)
         a.download = 'desk-kit-backup-' + new Date().toISOString().slice(0, 10) + '.json'
         a.click()
         setTimeout(() => URL.revokeObjectURL(a.href), 5000)
       } catch (e) { setErr('导出失败:' + String((e && e.message) || e)) }
     }
     if (view === 'summary') {
       const c = state
       return h('span', { className: '__dk_hint' }, c
         ? [c.reminderCounts.active + ' 条提醒 · ' + c.noteCounts.active + ' 张便签 · ' + c.linkCounts.active + ' 个网页 · ' + (c.secrets || []).length + ' 条凭据'].join('')
         : '提醒 · 便签 · 网页 · 保险库')
     }
     const s2 = state || {}
     const settings = s2.settings || {}
     const counts = [
       ['提醒', (s2.reminderCounts || {}).active || 0],
       ['便签', (s2.noteCounts || {}).active || 0],
       ['网页', (s2.linkCounts || {}).active || 0],
       ['凭据', (s2.secrets || []).length],
     ]
     return h('div', { className: '__dk_card' }, [
       h('div', { key: 'h', className: '__dk_cardtop' }, [
         h('span', { key: 'v', className: '__dk_cardtitle' }, '随手台'),
         h('span', { key: 'ver', className: '__dk_hint' }, 'v' + VERSION),
       ]),
       h('div', { key: 'c', className: '__dk_cardcounts' }, counts.map(([label, n]) =>
         h('span', { key: label, className: '__dk_cardcount' }, [h('b', { key: 'n' }, String(n)), h('span', { key: 'l' }, label)]))),
       h('div', { key: 'sw', className: '__dk_cardrows' }, [
         h('div', { key: 's1', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '到点提示音'),
           h('button', { key: 'b', className: '__dk_switch' + (settings.sound !== false ? ' on' : ''), disabled: busy, title: '到点了响一声', onClick: () => set({ sound: settings.sound === false }) }),
         ]),
         h('div', { key: 's2', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '网页用网站图标'),
           h('button', { key: 'b', className: '__dk_switch' + (settings.linkFavicons ? ' on' : ''), disabled: busy, title: '会联网去 icons.duckduckgo.com 取', onClick: () => set({ linkFavicons: !settings.linkFavicons }) }),
         ]),
       ]),
       h('div', { key: 'a', className: '__dk_frow' }, [
         h('button', { key: 'o', className: '__dk_btn p', onClick: open }, '打开随手台'),
         h('button', { key: 'b', className: '__dk_btn', onClick: backup }, [h(Ico, { key: 'i', name: 'download', size: 14 }), ' 备份']),
       ]),
       h('div', { key: 'k', className: '__dk_hint __dk_cardkbd' }, '也能用:侧栏「随手台」标签 · 会话顶栏的剪贴板图标 · Ctrl/Cmd+Shift+K · 在输入框敲 /desk-kit'),
       err ? h('div', { key: 'e', className: '__dk_err' }, err) : null,
     ])
   }

   const inject = ['slots']

   /**
    * 挂到 dsh-better-sidebar 的「侧边栏标签页」(软依赖):
    *   装了 —— 标签页是主入口,浮标默认让位;
    *   没装 —— sidebarReady=false,浮标自动兜底,不至于没有入口。
    * 服务可能比本插件晚就绪(装插件顺序 / HMR 都不定),所以监听 internal/service 再对一次。
    */
   function mountSidebarTab(ctx, bridge) {
     let current = null
     const release = () => {
       if (current) { try { current.dispose() } catch (error) { /* 已经卸载过 */ } }
       current = null
       bridge.write({ ready: false, open: null })
     }
     const reconcile = () => {
       const service = ctx.get && ctx.get('betterSidebar')
       if (current && current.service === service) return
       release()
       if (!service || typeof service.registerTab !== 'function') return
       let disposeTab = null
       try {
         disposeTab = service.registerTab({
           id: 'desk-kit:main',
           title: () => '随手台',
           description: () => '定时提醒 · 随手便签 · 加密保险库',
           icon: (size) => h(SidebarIcon, { size: size || 16 }),
           order: 40,
           single: true,
           component: (props) => h(SidebarPage, { visible: !!(props && props.visible), bridge }),
         })
       } catch (error) {
         disposeTab = null
       }
       if (typeof disposeTab !== 'function') return
       current = { service, dispose: disposeTab }
       bridge.write({
         ready: true,
         open: () => {
           try { service.openTab({ type: 'desk-kit:main', title: '随手台', reveal: true }); return true } catch (error) { return false }
         },
       })
     }
     reconcile()
     let off = null
     try {
       if (typeof ctx.on === 'function') off = ctx.on('internal/service', (name) => { if (name === 'betterSidebar') reconcile() })
     } catch (error) { /* 老宿主没有服务事件 */ }
     return () => {
       try { if (typeof off === 'function') off() } catch (error) { /* 取消失败不影响卸载 */ }
       release()
     }
   }

   function apply(ctx) {
     // 样式也归插件生命周期所有:dispose 时摘掉,重建时用最新 CSS 重新挂
     if (!ctx) { injectCss(); return }
     try {
       if (typeof ctx.effect === 'function') ctx.effect(() => injectCss(), 'desk-kit: styles')
       else injectCss()
     } catch (error) { /* 没有 effect 的老宿主:样式照挂,只是不回收 */ }
     // 每次 apply 一个桥:侧栏服务是否就绪、怎么把它叫到前面,都在这里
     const bridge = createSidebarBridge()
     // 先挂侧栏标签页:它决定浮标要不要兜底
     try {
       if (typeof ctx.effect === 'function') ctx.effect(() => mountSidebarTab(ctx, bridge))
       else mountSidebarTab(ctx, bridge)
     } catch (error) { /* 侧栏服务异常不能拖垮插件 */ }
     // 侧门统一走这条事件:优先把侧栏标签页叫到前面,没有侧栏时浮标自己接。
     // 监听归插件所有 —— dispose 时必须摘掉,否则重建插件会叠出多个监听。
     try {
       const onOpen = () => {
         const open = bridge.read().open
         if (typeof open === 'function') open()
       }
       if (typeof ctx.effect === 'function') {
         ctx.effect(() => {
           window.addEventListener(OPEN_EVENT, onOpen)
           return () => window.removeEventListener(OPEN_EVENT, onOpen)
         }, 'desk-kit: side-door listener')
       } else {
         window.addEventListener(OPEN_EVENT, onOpen)
       }
     } catch (error) { /* 没有 window(非浏览器环境)就算了 */ }
     if (!ctx.slots) return
     ctx.slots.inject('shell.overlay', () => ctx.slots.register(
       { name: 'shell.overlay', id: 'desk-kit-panel', order: 90, registrant: 'dsh-desk-kit' },
       () => h(Root, { bridge }),
     ))
     // 侧门 1:会话顶栏。写在流里,永远不会被别的悬浮窗盖住。
     // 老宿主没有这个槽时会 throw —— 顶栏图标没了不影响浮标照常用。
     try {
       ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
         { name: 'conversation.session.header.utilities', id: 'desk-kit-header', order: 20, registrant: 'dsh-desk-kit' },
         () => h(HeaderButton),
       ))
     } catch { /* 宿主没这个槽位:只保留浮标 */ }
     // 侧门 3:设置 → 插件 里的卡片。包页(bundle)和组件行(row)两个座位都占:
     // 宿主版本不同,能渲染出的那个不一样。
     for (const [slot, key] of [['plugins.bundle.config', 'dsh-desk-kit'], ['plugins.row.config', 'dsh-desk-kit#dsh-desk-kit']]) {
       try {
         ctx.slots.inject(slot, () => ctx.slots.register(
           { name: slot, key },   // 不声明 locale:卡片里没有需要翻译的文案
           (props) => h(PluginCard, { view: props && props.view }),
         ))
       } catch (error) { /* 宿主没有这个槽位:少一个入口,不影响主流程 */ }
     }
     // 侧门 4:斜杠命令 /desk-kit。手不用离开输入框。
     try {
       const commandUi = ctx.get && ctx.get('commandUi')
       const register = (command, name) => command.register({
         name,
         description: () => '打开随手台 / Open Desk Kit',
         available: () => true,
         ui: { kind: 'action', run: () => { try { requestOpen() } catch (e) { /* 面板不在也就算了 */ } } },
       })
       if (commandUi && typeof commandUi.register === 'function') {
         const off = register(commandUi, 'desk-kit')
         if (typeof ctx.effect === 'function' && typeof off === 'function') ctx.effect(() => off, 'desk-kit: slash command')
         // 中文命令名不是所有宿主都收,单独试,失败不影响上面的
         try {
           const offZh = register(commandUi, '随手台')
           if (typeof ctx.effect === 'function' && typeof offZh === 'function') ctx.effect(() => offZh, 'desk-kit: 中文命令')
         } catch (error) { /* 只认英文命令名 */ }
       }
     } catch (error) { /* 老宿主没有 commandUi */ }
     // 侧门 2:快捷键 Ctrl/Cmd+Shift+K。没有 shortcuts 服务时静默跳过。
     try {
       const shortcuts = ctx.get && ctx.get('shortcuts')
       if (shortcuts && typeof shortcuts.register === 'function') {
         const binding = { code: 'KeyK', modifiers: ['primary', 'shift'] }
         const defaults = Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux'].map((p) => [p, binding]))
         shortcuts.register({
           id: 'desk-kit.open', label: () => '打开随手台', aliases: [], defaults,
           regions: ['page'], modals: [],
           resolve: () => ({ status: 'handled', run: requestOpen }),
         })
       }
     } catch { /* 键位被占用/不在白名单:不注册 */ }
   }

   exports.apply = apply
   exports.inject = inject
   exports.__test = {
     Root, TabBar, Home, RemindersPage, NotesPage, VaultPage, Settings, ModelPicker, SafePage, CaptureBar, HeaderButton,
     Ico, PATHS, weekText, fmtClock, reminderMeta, CSS, ReplyBar, LEAD_PRESETS, ReminderForm, CYCLE, todayISO, alertHead,
     SidebarPage, SidebarView, SidebarIcon, floatEnabled, PANEL_LABELS, PANEL_ICONS, SIDEBAR_ORDER, ORDER,
     LinksPage, LinkTile, linkInitial, linkHue, linkHost, MoveChips, ReplyMove, MOVE_TARGETS, PluginCard,
     FileChip, FileGrid, Lightbox, isImage, fmtSize, extOf, filesFromDataTransfer, shotName,
     CleanupCard, daysText, ImportRow,
     AlertDock, AlertCard, AlertInline, DOCK_MAX, DOCK_ROTATE_MS, dockSlice, fmtDay, alertMeta,
     clampFab, snapFab, defaultFab, viewport, FAB_SIZE, FAB_PAD, LEVELS, dueCount, requestOpen, OPEN_EVENT,
     layoutPanel, fabRectOf, originOf, toLocal, nudgeIntoView,
     playChime, SOUND, useAlertSound, injectCss, apiGet, apiPost, apiGetOrLast, ErrorBar,
   }
   return module.exports
 },
})