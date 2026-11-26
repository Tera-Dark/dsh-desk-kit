   // ---------------------------------------------------------------- 提醒页
   const CYCLE = [
     ['daily', '每天'],
     ['weekly', '每周'],
     ['monthly', '每月'],
     ['once', '一次性'],
     ['solar', '公历每年'],
     ['lunar', '农历每年'],
   ]

   /** 本地「今天」的 YYYY-MM-DD(不能用 toISOString:那是 UTC,晚上会差一天)。 */
   function todayISO(now = new Date()) {
     const p = (n) => String(n).padStart(2, '0')
     return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
   }

   /**
    * 今天还没打开过的签到页:按时间排,同一个网址只算一次。
    * 只认今天真有一个点的状态(pending / upcoming / silenced):
    * paused(暂停)、expired(过期)、明天的提前提醒都不算。
    * 点过「知道了」只是今天不再提醒,不等于签过了,所以 silenced 还留在里面。
    */
   function checkinLinks(state) {
     const today = (state && state.today) || todayISO()
     const list = ((state && state.reminders) || [])
       .filter((r) => r && r.url && r.active !== false && !r.done
         && (r.status === 'pending' || r.status === 'upcoming' || r.status === 'silenced')
         && (!r.dueDate || r.dueDate <= today))
       .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
     const seen = Object.create(null)
     const out = []
     for (const r of list) {
       const url = String(r.url)
       if (seen[url]) continue
       seen[url] = true
       out.push({ id: r.id, title: r.title, time: r.time, url })
     }
     return out
   }

   /** 常用提前量:让人点一下,而不是算「4320 分钟是几天」。 */
   const LEAD_PRESETS = [
     [0, '准时'],
     [10, '10 分钟'],
     [30, '30 分钟'],
     [60, '1 小时'],
     [1440, '1 天'],
     [4320, '3 天'],
   ]

   function ReminderForm({ initial, onSave, onCancel, title }) {
     const mode = initial.lunar ? 'lunar'
       : initial.annual ? 'solar'
         : Number.isFinite(initial.monthly) ? 'monthly'
           : initial.date ? 'once'
             : (initial.weekdays && initial.weekdays.length) ? 'weekly' : 'daily'
     const [t, setT] = useState(initial.title || '')
     const [time, setTime] = useState(initial.time || '21:00')
     const [cycle, setCycle] = useState(mode)
     const [days, setDays] = useState(initial.weekdays || [])
     const [mday, setMday] = useState(Number.isFinite(initial.monthly) ? initial.monthly : 1)
     const [date, setDate] = useState(initial.date || todayISO())
     const [url, setUrl] = useState(initial.url || '')
     const [lead, setLead] = useState(initial.leadMin == null ? 0 : initial.leadMin)
     const [mm, setMm] = useState(initial.lunar ? initial.lunar.month : Number((initial.annual || '01-01').split('-')[0]) || 1)

     const [dd, setDd] = useState(initial.lunar ? initial.lunar.day : Number((initial.annual || '01-01').split('-')[1]) || 1)
     const [busy, setBusy] = useState(false)   // 保存中:按钮换字并挡住连点,不然会加出两条一样的提醒

     const save = async () => {
       if (busy) return
       const payload = { title: t.trim(), time, leadMin: Number(lead) || 0, url: url.trim() }
       if (cycle === 'weekly') payload.weekdays = days
       else if (cycle === 'monthly') { payload.monthly = Math.max(1, Math.min(31, Number(mday) || 1)); payload.weekdays = [] }
       else if (cycle === 'once') { payload.date = date || todayISO(); payload.weekdays = [] }
       else if (cycle === 'solar') { payload.annual = String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0'); payload.weekdays = []; payload.yearly = true }
       else if (cycle === 'lunar') { payload.lunar = { month: Number(mm), day: Number(dd) }; payload.weekdays = []; payload.yearly = true }
       else payload.weekdays = []
       if (initial.id) payload.id = initial.id
       setBusy(true)
       try { await onSave(payload) } finally { setBusy(false) }
     }

     const annual = cycle === 'solar' || cycle === 'lunar'
     const leadNum = Number(lead) || 0

     // 表单分三块:什么时候 → 什么时候提醒我 → 链接。一块一问,不用在一堆输入框里找。
     return h('div', { className: '__dk_form', onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }, }, [
       h('div', { key: 'g1', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [
           h('span', { key: 'a' }, title || '新提醒'),
           h('span', { key: 'b' }, annual ? '每年一次'
             : cycle === 'weekly' ? '按周'
               : cycle === 'monthly' ? '每月' + (Number(mday) || 1) + ' 号'
                 : cycle === 'once' ? '只提醒一次' : '每天'),
         ]),
         h('input', {
           key: 'a', className: '__dk_input', autoFocus: true,
           placeholder: '提醒什么,如「交电费」/「吃药」/「朋友生日」',
           value: t, onChange: (e) => setT(e.target.value),
           // 标题是主输入框:按 Enter 直接保存(类名/时间用当前默认值),不逼人去够按钮
           onKeyDown: (e) => {
             if (e.key !== 'Enter') return
             if (e.nativeEvent && e.nativeEvent.isComposing) return
             if (!t.trim() || (cycle === 'once' && !date)) return
             e.preventDefault()
             save()
           },
         }),
         h('div', { key: 'cyc', className: '__dk_chips' }, CYCLE.map(([k, label]) =>
           h('button', { key: k, className: '__dk_chip' + (cycle === k ? ' on' : ''), onClick: () => setCycle(k) }, label))),
         cycle === 'weekly'
           ? h('div', { key: 'c', className: '__dk_days' }, WEEK.map((w, i) => h('button', {
             key: i, className: '__dk_day' + (days.includes(i) ? ' on' : ''),
             onClick: () => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i))),
             title: '周' + w,
           }, w)))
           : null,
         cycle === 'weekly' && !days.length ? h('div', { key: 'd', className: '__dk_gtip' }, '都不选 = 每天') : null,
         cycle === 'monthly'
           ? h('div', { key: 'mo', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, '每月'),
             h('input', {
               key: 'd', type: 'number', min: 1, max: 31, className: '__dk_input __dk_num',
               value: mday, onChange: (e) => setMday(e.target.value),
             }),
             h('span', { key: 'u', className: '__dk_gtip' }, '号'),
           ])
           : null,
         cycle === 'monthly'
           ? h('div', { key: 'mt', className: '__dk_gtip' }, '小月没有 31 号时,按当月最后一天提醒')
           : null,
         cycle === 'once'
           ? h('div', { key: 'once', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, '在哪天'),
             h('input', {
               key: 'd', type: 'date', className: '__dk_input', value: date,
               onChange: (e) => setDate(e.target.value),
             }),
           ])
           : null,
         cycle === 'once'
           ? h('div', { key: 'ot', className: '__dk_gtip' }, '过了这天就不再提醒,也不会自动排下一次')
           : null,
         annual
           ? h('div', { key: 'md', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, cycle === 'lunar' ? '农历' : '公历'),
             h('input', { key: 'mm', type: 'number', min: 1, max: 12, className: '__dk_input __dk_num', value: mm, onChange: (e) => setMm(e.target.value) }),
             h('span', { key: 'u', className: '__dk_gtip' }, '月'),
             h('input', { key: 'dd', type: 'number', min: 1, max: 31, className: '__dk_input __dk_num', value: dd, onChange: (e) => setDd(e.target.value) }),
             h('span', { key: 'v', className: '__dk_gtip' }, '日'),
           ])
           : null,
         h('div', { key: 'b', className: '__dk_frow' }, [
           h('span', { key: 'l', className: '__dk_gtip' }, '几点'),
           h('input', { key: 'tm', type: 'time', className: '__dk_input __dk_num __dk_num--wide', value: time, onChange: (e) => setTime(e.target.value) }),
         ]),
       ]),

       h('div', { key: 'g2', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '提前多久提醒')]),
         h('div', { key: 'p', className: '__dk_chips' }, LEAD_PRESETS.map(([v, label]) =>
           h('button', {
             key: v, className: '__dk_chip' + (leadNum === v ? ' on' : ''),
             onClick: () => setLead(v),
           }, label))),
         h('div', { key: 'b', className: '__dk_frow' }, [
           h('input', { key: 'ld', type: 'number', min: 0, max: 10080, className: '__dk_input __dk_num', value: lead, onChange: (e) => setLead(e.target.value) }),
           h('span', { key: 'm', className: '__dk_gtip' }, '分钟' + (leadNum >= 1440 ? '(≈ ' + (leadNum / 1440).toFixed(1).replace(/\.0$/, '') + ' 天前)' : '')),
         ]),
         annual ? h('div', { key: 'tip', className: '__dk_gtip' }, '生日/纪念日:选好月日后每年自动提醒;常用提前 3 天(4320 分钟),可自己改') : null,
       ]),

       h('div', { key: 'g3', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '打开链接'), h('span', { key: 'b' }, '可选')]),
         h('input', { key: 'e', className: '__dk_input', placeholder: 'https://…', value: url, onChange: (e) => setUrl(e.target.value) }),
         h('div', { key: 't', className: '__dk_gtip' }, '填了会在提醒行右侧给一个「打开」按钮'),
       ]),

       h('div', { key: 'f', className: '__dk_frow' }, [
         h('button', { key: 's', className: '__dk_btn p', disabled: busy || !t.trim() || (cycle === 'once' && !date), onClick: save }, busy ? '保存中…' : '保存'),
         h('button', { key: 'c', className: '__dk_btn', onClick: onCancel }, '取消'),
       ]),
     ])
   }

   function RemindersPage({ state, run, notify }) {
     const [editing, setEditing] = useState('')
     const [adding, setAdding] = useState(false)
     const [view, setView] = useState('active')          // active | trash
     const [moveId, setMoveId] = useState('')            // 哪一条正在挑分类
     const all = state.reminders || []
     const trashed = state.trashedReminders || []
     const rc = state.reminderCounts || { active: all.length, trash: trashed.length }
     const say = (text, undo) => { if (notify) notify(text, undo) }

     // 暂停的沉到最下面:列表顺序也应该跟着「现在要不要管它」走
     const sorted = all.slice().sort((a, b) => (a.status === 'paused' ? 1 : 0) - (b.status === 'paused' ? 1 : 0))

     // 今天还没打卡的签到页:够两条才出「全部打开」,一条时行内「打开」就够了
     const links = checkinLinks(state)
     const openAll = async () => {
       const { opened, blocked } = openMany(links.map((l) => l.url))
       if (!blocked.length) { say('已打开 ' + opened.length + ' 个签到页'); return }
       // 被拦下的别假装打开了:捞进剪贴板,回执里把数量说清楚
       let copied = false
       try { await navigator.clipboard.writeText(blocked.join('\n')); copied = true } catch { copied = false }
       const tail = copied ? ',链接已复制,粘到地址栏就行' : ',手动打开:' + blocked.join(' ')
       say(opened.length
         ? '打开了 ' + opened.length + ' 个,' + blocked.length + ' 个被浏览器拦下' + tail
         : '一个也没打开,浏览器拦了 ' + blocked.length + ' 个' + tail)
     }

     // ---- 垃圾箱视图 ----
     if (view === 'trash') {
       return h(React.Fragment, null, [
         h('div', { key: 'bar', className: '__dk_toolbar' }, [
           h('button', { key: 'b', className: '__dk_btn', onClick: () => setView('active') }, [
             h(Ico, { key: 'i', name: 'chevronLeft', size: 14 }), ' 返回',
           ]),
           h('span', { key: 'h', className: '__dk_hint' }, '删掉的提醒都在这里,可恢复'),
         ]),
         trashed.length
           ? trashed.map((r) => h('div', { key: r.id, className: '__dk_item' }, [
             h('div', { key: 't', className: '__dk_itop' }, [
               h('div', { key: 'x', className: '__dk_itext' }, r.title),
               h('div', { key: 'act', className: '__dk_iact' }, [
                 h('button', { key: 'rs', className: '__dk_mini', title: '恢复', 'aria-label': '恢复', onClick: () => run('reminder.restore', { id: r.id }) }, h(Ico, { name: 'undo', size: 15 })),
                 h('button', { key: 'pg', className: '__dk_mini', title: '彻底删除', 'aria-label': '彻底删除', onClick: () => { if (window.confirm('彻底删除「' + r.title + '」?不可恢复')) run('reminder.purge', { id: r.id }) } }, h(Ico, { name: 'x', size: 15 })),
               ]),
             ]),
             h('div', { key: 'm', className: '__dk_imeta' }, [
               h('span', { key: 'd' }, '删除于 ' + fmtWhen(r.deletedAt)),
               r.annual ? h('span', { key: 'a' }, '每年 ' + r.annual) : null,
               r.lunar ? h('span', { key: 'l' }, '农历' + r.lunar.month + '/' + r.lunar.day) : null,
             ]),
           ]))
           : h('div', { key: 'e', className: '__dk_empty' }, [
             h('div', { key: 't', className: '__dk_emptytitle' }, '垃圾箱是空的'),
             h('div', { key: 'h', className: '__dk_note' }, '删掉的提醒会先在这里放一阵子,想恢复随时来拿。'),
           ]),
       ])
     }
     const save = async (r, patch) => {
       const body = r
         ? await run('reminder.update', { id: r.id, ...patch })
         : await run('reminder.add', patch)
       // 没存上就留着表单:关掉它,用户填的时间和周期全没了
       if (!writeOk(body)) { say('没存上,表单还在,再点一次保存'); return }
       setEditing(''); setAdding(false)
       say(r ? '已保存修改' : '已加一条提醒')
     }
     return h(React.Fragment, null, [
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => { setAdding(true); setEditing('') } }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), ' 新提醒']),
         h('span', { key: 'h', className: '__dk_hint' }, '全部 ' + all.length + ' 条'),
       ]),
       links.length >= 2
         ? h('div', { key: 'allin', className: '__dk_toolbar' }, [
           h('button', {
             key: 'b', className: '__dk_btn',
             title: '按时间顺序打开今天还没打卡的 ' + links.length + ' 个签到页',
             onClick: openAll,
           }, '全部打开'),
           h('span', { key: 'h', className: '__dk_hint' }, '今天还有 ' + links.length + ' 个签到没打开'),
         ])
         : null,
       adding ? h(ReminderForm, { key: 'new', title: '新提醒', initial: {}, onSave: (v) => save(null, v), onCancel: () => setAdding(false) }) : null,
       sorted.length
         ? sorted.map((r) => h('div', { key: r.id, className: '__dk_item' + (r.status === 'expired' || r.status === 'paused' ? ' __dk_item--dim' : '') }, [
           editing === r.id
             ? h(ReminderForm, { key: 'f', title: '编辑', initial: r, onSave: (v) => save(r, v), onCancel: () => setEditing('') })
             : h(React.Fragment, { key: 'v' }, [
               h('div', { key: 't', className: '__dk_itop' }, [
                 h('button', { key: 'c', className: '__dk_check' + (r.done ? ' on' : ''), title: r.done ? '取消完成' : '标记完成', onClick: () => run(r.done ? 'reminder.uncheckin' : 'reminder.checkin', { id: r.id }) }, r.done ? h(Ico, { name: 'check', size: 12 }) : null),
                 h('div', { key: 'm', className: '__dk_itext' }, [
                   h('div', { key: 'a' }, r.title),
                   h('div', { key: 'b', className: '__dk_imeta' }, reminderMeta(r)),
                 ]),
                 r.url ? h('a', { key: 'go', className: '__dk_go', href: r.url, target: '_blank', rel: 'noreferrer' }, '打开') : null,
                 h('div', { key: 'act', className: '__dk_iact' }, [
                   // 暂停 = 暂时不想收到提醒,但记录留着。以前只有改时间或者删掉这两条路。
                   h('button', {
                     key: 'p', className: '__dk_mini',
                     title: r.active === false ? '继续提醒' : '暂停提醒',
                     'aria-label': r.active === false ? '继续提醒' : '暂停提醒',
                     onClick: async () => {
                       const body = await run('reminder.update', { id: r.id, active: r.active === false })
                       // 状态没变就别报「已暂停」:一句空话比没有回执更让人迷惑
                       if (!writeOk(body)) { say('没成功,再点一次'); return }
                       say(r.active === false ? '已继续提醒' : '已暂停,不再弹提醒')
                     },
                   }, h(Ico, { name: r.active === false ? 'play' : 'pause', size: 15 })),
                   h('button', { key: 'mv', className: '__dk_mini', title: '转存到别的分类', 'aria-label': '转存到别的分类', onClick: () => setMoveId(moveId === r.id ? '' : r.id) }, h(Ico, { name: 'swap', size: 15 })),
                   h('button', { key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑', onClick: () => { setEditing(r.id); setAdding(false) } }, h(Ico, { name: 'edit', size: 15 })),
                   h('button', {
                     key: 'x', className: '__dk_mini', title: '移入垃圾箱', 'aria-label': '移入垃圾箱',
                     onClick: async () => {
                       // 软删,所以不用弹确认框 —— 直接给「撤销」更好用
                       const body = await run('reminder.delete', { id: r.id })
                       if (!writeOk(body)) { say('没删掉,这条还在,再试一次'); return }
                       say('已移入垃圾箱', { action: 'reminder.restore', payload: { id: r.id } })
                     },
                   }, h(Ico, { name: 'trash', size: 15 })),
                 ]),
               ]),
               moveId === r.id ? h(MoveChips, { key: 'mv', kind: 'reminder', id: r.id, run, notify: (t) => { setMoveId(''); say(t) } }) : null,
             ]),
         ]))
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, '还没有提醒'),
           h('div', { key: 'h', className: '__dk_note' }, '点上面「新提醒」手动加;或者在首页说一句「每天 9 点提醒我吃药」。'),
         ]),
       h('div', { key: 'foot', className: '__dk_foot' }, [
         h('span', { key: 'sp', className: '__dk_spacer' }),
         h('button', { key: 't', className: '__dk_chip', onClick: () => setView('trash') },
           '垃圾箱 (' + (rc.trash || 0) + ')'),
       ]),
     ])
   }

