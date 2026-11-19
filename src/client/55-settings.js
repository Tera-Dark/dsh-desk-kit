   // ---------------------------------------------------------------- 设置

   /**
    * 识图模型选择。
    * 必须对宿主返回做类型守卫:老宿主没有 /models 路由时会回 {ok:true,state:…},
    * 此时 providers 是 undefined —— 直接 .map() 会让整个 overlay 抛错卸载,
    * 表现就是「点开设置插件消失」(踩过)。
    */
   function ModelPicker({ label, hint, providerKey, modelKey, settings, onUpdate, initialProviders }) {
     const [providers, setProviders] = useState(function () {
       return Array.isArray(initialProviders) ? initialProviders : [];
     });
     const [loading, setLoading] = useState(initialProviders === undefined);
     const [failed, setFailed] = useState('');

     useEffect(function () {
       if (initialProviders !== undefined) return; // 测试注入时不再请求
       fetch('/desk-kit-api/models', { headers: HEAD })
         .then(function (r) { return r.json() })
         .then(function (data) {
           setProviders(data && Array.isArray(data.providers) ? data.providers : []);
           setLoading(false);
         })
         .catch(function (e) {
           setFailed(String((e && e.message) || e));
           setProviders([]);
           setLoading(false);
         });
     }, []);

     if (loading) return h('div', { className: '__dk_hint' }, '正在加载模型目录…');

     const list = Array.isArray(providers) ? providers : [];
     const s = settings || {};
     const p = typeof s[providerKey] === 'string' ? s[providerKey] : '';
     const m = typeof s[modelKey] === 'string' ? s[modelKey] : '';
     const current = list.find(function (x) { return x && x.id === p });
     const models = current && Array.isArray(current.models) ? current.models : [];

     return h('div', { className: '__dk_form' }, [
       h('div', { key: 't', className: '__dk_hint' }, label),
       hint ? h('div', { key: 'hh', className: '__dk_hint' }, hint) : null,
       h('select', {
         key: 'selP',
         className: '__dk_input',
         value: p,
         onChange: function (e) { var patch = {}; patch[providerKey] = e.target.value; patch[modelKey] = ''; onUpdate(patch) },
       }, [
         h('option', { key: '__auto', value: '' }, '跟随默认模型'),
         ...list.map(function (prov) {
           return h('option', { key: prov.id, value: prov.id }, prov.name || prov.id)
         }),
       ]),
       p ? h('select', {
         key: 'selM',
         className: '__dk_input',
         value: m,
         onChange: function (e) { var patch = {}; patch[providerKey] = p; patch[modelKey] = e.target.value; onUpdate(patch) },
       }, [
         h('option', { key: '__none', value: '' }, '请选择模型'),
         ...models.map(function (mod) {
           const label = (mod.name || mod.id) + (mod.image === true ? ' ✓识图' : mod.image === false ? ' (不支持图片)' : '')
           return h('option', { key: mod.id, value: mod.id }, label)
         }),
       ]) : null,
       failed ? h('div', { key: 'e', className: '__dk_hint' }, '模型目录读取失败:' + failed) : null,
       list.length === 0 && !failed
         ? h('div', { key: 'n', className: '__dk_hint' }, '宿主没返回任何模型')
         : null,
     ]);
   }

   /**
    * 真正的 React 错误边界(必须用 class:getDerivedStateFromError 只有 class 有)。
    * 单个页面崩了只显示一行错误,不能把整个浮层卸载掉 ——
    * 之前「点开设置插件消失」就是渲染抛错把 overlay 带走。
    */
   class SafePage extends React.Component {
     constructor(props) {
       super(props)
       this.state = { err: '' }
     }
     static getDerivedStateFromError(error) {
       return { err: String((error && error.message) || error) }
     }
     render() {
       if (this.state.err) {
         return h('div', { className: '__dk_err' }, '这个页面出错了:' + this.state.err + '(其它页还能用)')
       }
       return this.props.children
     }
   }

   /** 「N 天」这种人话:0 天就是到期,别显示「还有 0 天」 */
   function daysText(daysLeft) {
     if (daysLeft === null || daysLeft === undefined) return '不会自动清'
     if (daysLeft <= 0) return '下次清理就清掉'
     if (daysLeft === 1) return '还有 1 天'
     return '还有 ' + daysLeft + ' 天'
   }

   /**
    * 存储与清理。
    *
    * 两件事必须说清楚,否则用户不敢用自动清理:
    *   1. 现在占多少(按数据/保险库/附件分开);
    *   2. 垃圾箱里每条**具体**还有几天被清 —— 不是一个笼统的「30 天后清理」。
    * 清理本身是先算后删(store.sweepTrash),保险库不参与(删了不可恢复,不能替用户决定)。
    */
   function CleanupCard({ state, run }) {
     const [info, setInfo] = useState(null)
     const [busy, setBusy] = useState(false)
     const [msg, setMsg] = useState('')
     const load = useCallback(async () => {
       try {
         const body = await apiPost('storage.get', {})
         if (body && body.result) setInfo(body.result)
       } catch (e) { setMsg('读不到用量:' + String((e && e.message) || e)) }
     }, [])
     useEffect(() => { load() }, [load, state.lastSweepAt])

     const keep = info ? info.trashKeepDays : (state.trashKeepDays || 0)
     const trash = (state.trash || [])
     const setKeep = async (days) => {
       await run('settings.update', { trashKeepDays: days })
       setMsg(days > 0 ? '垃圾箱保留 ' + days + ' 天' : '不再自动清垃圾箱')
       load()
     }
     const sweep = async () => {
       setBusy(true)
       try {
         const body = await apiPost('cleanup.run', {})
         const d = (body && body.result) || {}
         const parts = []
         if (d.notes) parts.push(d.notes + ' 条便签')
         if (d.links) parts.push(d.links + ' 个网页')
         if (d.reminders) parts.push(d.reminders + ' 条提醒')
         if (d.files) parts.push(d.files + ' 个附件')
         setMsg(parts.length ? '清掉了 ' + parts.join('、') + ',释放 ' + (d.human || '0B') : '没有需要清的东西')
         load()
       } catch (e) { setMsg('清理失败:' + String((e && e.message) || e)) } finally { setBusy(false) }
     }
     const bytes = (info && info.bytes) || {}
     const counts = (info && info.counts) || {}
     const bar = (label, n, total) => {
       const pct = total > 0 ? Math.max(2, Math.round((n / total) * 100)) : 0
       return h('div', { key: label, className: '__dk_use' }, [
         h('span', { key: 'l', className: '__dk_uselabel' }, label),
         h('span', { key: 'b', className: '__dk_usebar' }, h('i', { key: 'i', style: { width: pct + '%' } })),
         h('span', { key: 'n', className: '__dk_usenum' }, fmtSize(n)),
       ])
     }
     return h('div', { className: '__dk_card' }, [
       h('div', { key: 'h', className: '__dk_cardtop' }, [
         h('span', { key: 't', className: '__dk_cardtitle' }, '存储与清理'),
         h('span', { key: 'b', className: '__dk_hint' }, '共 ' + fmtSize(bytes.total || 0)),
       ]),
       info
         ? h('div', { key: 'u', className: '__dk_usewrap' }, [
           bar('附件', bytes.blobs || 0, bytes.total || 1),
           bar('便签/提醒', bytes.data || 0, bytes.total || 1),
           bar('保险库', bytes.vault || 0, bytes.total || 1),
         ])
         : h('div', { key: 'u', className: '__dk_hint' }, '算一下…'),
       h('div', { key: 'c', className: '__dk_cardrows' }, [
         h('div', { key: 'c1', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '垃圾箱'),
           h('span', { key: 'r', className: '__dk_hint' }, trash.length + ' 条待清' + (counts.strayFiles ? ' · ' + counts.strayFiles + ' 个临时附件' : '')),
         ]),
         h('div', { key: 'c2', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '保留'),
           h('div', { key: 'r', className: '__dk_frow' }, [7, 30, 90, 0].map((d) =>
             h('button', {
               key: d, className: '__dk_chip' + (Number(keep) === d ? ' on' : ''),
               title: d === 0 ? '不自动清(要自己删)' : '删除后 ' + d + ' 天自动清',
               onClick: () => setKeep(d),
             }, d === 0 ? '不清' : d + ' 天'))),
         ]),
         h('div', { key: 'c3', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '上次自动清理'),
           h('span', { key: 'r', className: '__dk_hint' }, state.lastSweepAt ? fmtWhen(state.lastSweepAt) : '还没清过'),
         ]),
       ]),
       trash.length
         ? h('div', { key: 'tl', className: '__dk_trashtop' }, [
           h('div', { key: 'h', className: '__dk_hint' }, '这些会被自动清掉(想留就先恢复):'),
           ...trash.slice(0, 6).map((t) => h('div', { key: t.kind + t.id, className: '__dk_trashrow' }, [
             h('span', { key: 'k', className: '__dk_trashkind' }, { note: '便签', reminder: '提醒', link: '网页' }[t.kind] || t.kind),
             h('span', { key: 't', className: '__dk_trashtitle', title: t.title }, t.title || '（无标题）'),
             h('span', { key: 'd', className: '__dk_hint' }, daysText(t.daysLeft)),
           ])),
           trash.length > 6 ? h('div', { key: 'm', className: '__dk_hint' }, '…还有 ' + (trash.length - 6) + ' 条') : null,
         ])
         : h('div', { key: 'te', className: '__dk_hint' }, '垃圾箱是空的,没有东西等着被清。'),
       h('div', { key: 'a', className: '__dk_frow' }, [
         h('button', { key: 'go', className: '__dk_btn p', disabled: busy, onClick: sweep }, busy ? '清理中…' : '现在清理'),
         h('button', { key: 'rf', className: '__dk_btn', onClick: load }, '刷新用量'),
       ]),
       h('div', { key: 'n', className: '__dk_hint __dk_cardkbd' }, '自动清理每 6 小时最多跑一次(DSH 开着的时候);保险库不参与,删了就是删了。附件原件不在导出的 JSON 里,备份要连数据目录一起拷。'),
       msg ? h('div', { key: 'm', className: '__dk_hint __dk_okmsg' }, msg) : null,
     ])
   }

   /**
    * 从 JSON 还原。默认「合并」(按 id 去重,本地优先),
    * 「整体替换」必须二次确认 —— 服务端会先把现有 data.json 另存一份再动手。
    */
   function ImportRow({ run }) {
     const [msg, setMsg] = useState('')
     const [busy, setBusy] = useState(false)
     const picker = useRef(null)
     const start = () => { if (picker.current) picker.current.click() }
     const onFile = async (e) => {
       const file = e.target.files && e.target.files[0]
       e.target.value = ''
       if (!file) return
       setBusy(true)
       setMsg('读文件…')
       try {
         const text = await file.text()
         let backup = null
         try { backup = JSON.parse(text) } catch { throw new Error('这个文件不是 JSON') }
         const mode = window.confirm('点「确定」= 合并(不覆盖现有数据)\n点「取消」= 整体替换(会先自动备份当前数据)') ? 'merge' : 'replace'
         if (mode === 'replace' && !window.confirm('整体替换:现在的便签/提醒/网页/附件记录会被清掉,只保留备份里的。继续?')) {
           setMsg('已取消'); setBusy(false); return
         }
         setMsg(mode === 'replace' ? '替换中…' : '合并中…')
         const res = await fetch(API + '/import', {
           method: 'POST',
           headers: { 'content-type': 'application/json', ...HEAD },
           body: JSON.stringify({ backup, mode, confirm: true }),
         })
         const body = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }))
         if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status))
         const r = body.report || {}
         const parts = []
         const NAMES = { notes: '便签', reminders: '提醒', links: '网页', files: '附件', secrets: '保险库', alerts: '告警' }
         for (const [k, v] of Object.entries(r.added || {})) if (v) parts.push(v + ' 条' + (NAMES[k] || k))
         let line = parts.length ? '已导入 ' + parts.join('、') : '没有新数据(都已在库里)'
         if (r.skipped) line += ';跳过 ' + r.skipped + ' 条重复/无效'
         if (r.locked) line += ';' + r.locked + ' 条保险库解不开(换过 vault.key)'
         if (r.missingBlobs) line += ';' + r.missingBlobs + ' 个附件缺原件(备份不含原件)'
         if (r.backupFile) line += ';原数据已另存'
         setMsg(line)
         if (run) await run('settings.update', {})   // 顺手拉一次新快照
       } catch (err) {
         setMsg('导入失败:' + String((err && err.message) || err))
       } finally { setBusy(false) }
     }
     return h('div', { className: '__dk_setrow __dk_setrow--col' }, [
       h('span', { key: 'l' }, '从 JSON 还原'),
       h('div', { key: 'r', className: '__dk_frow' }, [
         h('button', { key: 'b', className: '__dk_btn', disabled: busy, onClick: start }, [h(Ico, { key: 'i', name: 'undo', size: 14 }), busy ? ' 处理中…' : ' 选择备份文件']),
         h('span', { key: 'h', className: '__dk_hint' }, '合并:按 id 去重;替换:先自动备份'),
       ]),
       h('input', {
         key: 'f', ref: picker, type: 'file', accept: '.json,application/json', style: { display: 'none' },
         onChange: onFile,
       }),
       msg ? h('span', { key: 'm', className: '__dk_hint __dk_okmsg' }, msg) : null,
     ])
   }

   function Settings({ state, run, sidebarReady }) {
     const s = state.settings || {};
     const update = (newS) => run('settings.update', newS);
     return h(React.Fragment, null, [
       h('div', { key: 's1', className: '__dk_sec' }, [h('span', { key: 'a' }, '入口'), h('span', { key: 'b' })]),
       h('div', { key: 'v', className: '__dk_setrow' }, [h('span', { key: 'l' }, '版本'), h('span', { key: 'r', className: '__dk_hint' }, VERSION)]),
       h('div', { key: 'fab', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '浮标快捷入口'),
         h('button', {
           key: 'b', className: '__dk_switch' + (floatEnabled(state, sidebarReady) ? ' on' : ''),
           onClick: () => run('settings.update', { floatFab: !floatEnabled(state, sidebarReady) }),
         }),
       ]),
       h('div', { key: 'entry', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '入口在哪'),
         h('span', { key: 'r', className: '__dk_hint' }, '主入口是侧边栏的「随手台」标签页(要装 dsh-better-sidebar);另外有会话顶栏图标和 Ctrl/Cmd+Shift+K。浮标默认让位,没装侧栏插件时自动兜底。'),
       ]),
       h('div', { key: 'd', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '数据目录'),
         h('span', { key: 'r', className: '__dk_hint' }, state.root || ''),
       ]),
       h('div', { key: 'snd', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '提示音'),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 'try', className: '__dk_chip', title: '试听一下', onClick: () => playChime() }, '试听'),
           h('button', {
             key: 'b', className: '__dk_switch' + (s.sound !== false ? ' on' : ''),
             title: s.sound === false ? '打开提示音' : '关闭提示音',
             onClick: () => update({ sound: s.sound === false }),
           }),
         ]),
       ]),
       h('div', { key: 'fav', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '网页用网站图标'),
         h('button', {
           key: 'b', className: '__dk_switch' + (s.linkFavicons ? ' on' : ''),
           title: s.linkFavicons ? '改回首字色块(不联网)' : '去取网站图标(会联网)',
           onClick: () => update({ linkFavicons: !s.linkFavicons }),
         }),
       ]),
       h('div', { key: 'favh', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'r', className: '__dk_hint' },
           s.linkFavicons
             ? '现在会去 icons.duckduckgo.com 取图标 —— 等于把域名告诉它。不想联网就关掉,改用「首字 + 按域名算的底色」。'
             : '关着:用「首字 + 按域名算出来的底色」,不联网也能一眼认。打开才会去第三方取图标。'),
       ]),
       h('div', { key: 'm', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '静音提醒'),
         h('button', {
           key: 'b', className: '__dk_switch' + (state.settings && state.settings.muted ? ' on' : ''),
           onClick: () => run('settings.update', { muted: !(state.settings && state.settings.muted) }),
         }),
       ]),
       h('div', { key: 'h', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '怎么用'),
         h('span', { key: 'r', className: '__dk_hint' }, '首页说一句话自动分类;要精确控制就点下方对应的分类页手动加。'),
       ]),
       h('div', { key: 's2', className: '__dk_sec' }, [h('span', { key: 'a' }, '模型'), h('span', { key: 'b' })]),
       h(ModelPicker, {
         key: 'mp-classify',
         label: '分类模型(首页说一句话时用)',
         hint: '选一个纯文字模型即可;它只负责把你的话判成 提醒/便签/保险库。不选就走本地规则。',
         providerKey: 'classifyProvider',
         modelKey: 'classifyModel',
         settings: s, onUpdate: update,
       }),
       h('div', { key: 's3', className: '__dk_sec' }, [h('span', { key: 'a' }, '数据'), h('span', { key: 'b' })]),
       h('div', { key: 'cnt', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '现在存了'),
         h('span', { key: 'r', className: '__dk_hint' },
           (state.reminderCounts ? state.reminderCounts.active : (state.reminders || []).length) + ' 条提醒 · '
           + (state.notes || []).filter((n) => !((n.deletedAt || 0) > 0)).length + ' 条便签 · '
           + (state.links || []).length + ' 个网页 · '
           + (state.secrets || []).length + ' 条保险库'),
       ]),
       h(CleanupCard, { key: 'cleanup', state, run }),
       h(ImportRow, { key: 'import', run }),
       h('div', { key: 'bk', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '导出备份'),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', {
             key: 'b', className: '__dk_btn',
             onClick: async () => {
               try {
                 const r = await fetch(API + '/export', { headers: HEAD })
                 const body = await r.json()
                 if (!body || !body.ok) throw new Error((body && body.error) || '导出失败')
                 const text = JSON.stringify(body.backup, null, 2)
                 const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
                 const a = document.createElement('a')
                 a.href = url
                 a.download = 'desk-kit-' + new Date().toISOString().slice(0, 10) + '.json'
                 document.body.appendChild(a)
                 a.click()
                 setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 0)
               } catch (e) {
                 if (window.alert) window.alert('导出没成功:' + (e && e.message ? e.message : e))
               }
             },
           }, [h(Ico, { key: 'i', name: 'download', size: 14 }), ' 导出为 JSON']),
         ]),
         h('span', { key: 'h', className: '__dk_hint' }, '提醒和便签是明文;保险库导出的是密文,要连 vault.key 一起拷才解得开;附件原件不在 JSON 里,还得拷数据目录的 blobs/。'),
       ]),
     ])
   }

