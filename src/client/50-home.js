   // ---------------------------------------------------------------- 快搜
   /**
    * 首页的一句话查找入口。
    *
    * 真实场景:只记得「脸书」,忘了账号存在保险库还是便签。
    * 这里一次搜五类(便签正文/提醒/网页/附件名/保险库标题),
    * 中英别名互通;点结果直接跳到对应页面,保险库那条会自动展开。
    */
   function QuickFind({ state, run, onGo }) {
     const [q, setQ] = useState('')
     const [deep, setDeep] = useState({ q: '', hits: [], done: false })
     const [busy, setBusy] = useState(false)
     // 「显示全部 N 条」:搜索结果默认只给 5 条,以前只剩一句「再输入一个字缩小范围」
     const [allFor, setAllFor] = useState('')
     const found = q.trim() ? searchSnapshot(state, q) : null
     const showAll = !!q.trim() && allFor === q.trim()
     const hits = found ? found.hits.slice(0, showAll ? 100 : 5) : []
     const deepHits = found && deep.q === q.trim() ? deep.hits : []
     const deepDone = found && deep.q === q.trim() && deep.done
     const known = new Set((found ? found.hits : []).map((h) => h.kind + ':' + h.id))
     const extra = deepHits.filter((h) => !known.has(h.kind + ':' + h.id)).slice(0, showAll ? 100 : 3)
     const rows = hits.concat(extra)
     const hasSecretHit = found ? found.hits.some((h) => h.kind === 'secret') : false
     const KIND = { note: '便签', secret: '保险库', reminder: '提醒', link: '网页', file: '附件' }
     const deepFind = async () => {
       const query = q.trim()
       if (!query || busy) return
       setBusy(true)
       try {
         const body = await run('search.all', { query, deepVault: true })
         if (!body) return
         const list = body && body.result && Array.isArray(body.result.hits) ? body.result.hits : []
         setDeep({ q: query, hits: list.filter((h) => h.kind === 'secret'), done: true })
       } finally { setBusy(false) }
     }
     const openHit = (hit) => {
       if (!onGo) return
       if (hit.kind === 'secret') onGo('vault', { secretId: hit.id })
       else if (hit.kind === 'note' || hit.kind === 'file') onGo('notes', { query: q.trim() })
       else if (hit.kind === 'reminder') onGo('reminders', { query: q.trim() })
       else onGo('links', { query: q.trim() })
     }
     return h('div', { className: '__dk_qf' }, [
       h('div', { key: 'bar', className: '__dk_qfbar' }, [
         h(Ico, { key: 'i', name: 'search', size: 15, className: '__dk_qfico' }),
         h('input', {
           key: 'q', className: '__dk_qfinput', type: 'search', value: q,
           placeholder: '找账号、便签、网页…',
           'aria-label': '全库快速查找',
           onChange: (e) => { setQ(e.target.value); setAllFor('') },
           onKeyDown: (e) => {
             if (e.key === 'Escape') { e.stopPropagation(); setQ('') }
             if (e.key === 'Enter' && rows.length) { e.preventDefault(); openHit(rows[0]) }
           },
         }),
         q ? h('button', { key: 'x', type: 'button', className: '__dk_qfclear', title: '清空', 'aria-label': '清空查找', onClick: () => setQ('') }, h(Ico, { name: 'x', size: 13 })) : null,
       ]),
       found ? h('div', { key: 'res', className: '__dk_qfres' }, [
         rows.length ? rows.map((hit) => h('button', {
           key: hit.kind + ':' + hit.id, type: 'button', className: '__dk_qfrow',
           title: hit.title, onClick: () => openHit(hit),
         }, [
           h('span', { key: 'k', className: '__dk_qfkind' }, KIND[hit.kind] || hit.kind),
           h('span', { key: 'm', className: '__dk_qfmain' }, [
             h('span', { key: 't', className: '__dk_qft' }, hit.kind === 'note' && hit.snippet ? hit.snippet : hit.title),
             h('span', { key: 'w', className: '__dk_qfm' }, KIND[hit.kind] + ' · ' + hit.where),
           ]),
           h('span', { key: 'go', className: '__dk_qfgo' }, hit.kind === 'secret' ? '确认' : '打开'),
         ])) : h('div', { key: 'e', className: '__dk_qfempty' }, '没找到「' + q.trim() + '」。换个叫法试试,比如「脸书 / Facebook」。'),
         !hasSecretHit && !deepHits.length && !deepDone
           ? h('button', { key: 'deep', type: 'button', className: '__dk_qfdeep', disabled: busy, onClick: deepFind },
             busy ? '正在解密比对…' : '保险库标题没命中?在内容里再找一次')
           : null,
         deepDone && !extra.length
           ? h('div', { key: 'dh', className: '__dk_qfempty' }, '保险库内容里也没有匹配的条目')
           : null,
         found.total > rows.length
           ? h('button', {
             key: 'more', type: 'button', className: '__dk_qfdeep',
             onClick: () => setAllFor(q.trim()),
           }, '显示全部 ' + found.total + ' 条')
           : null,
       ]) : null,
     ])
   }

   // ---------------------------------------------------------------- 首页
   function Home({ state, run, onLink, onGo, notify }) {
     const list = (state.reminders || []).filter((r) => r.active !== false && r.status !== 'paused')
     const rank = (r) => (r.done ? 3 : r.status === 'pending' ? 0 : r.status === 'upcoming' ? 1 : 2)
     const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || (a.occurrenceAt || 0) - (b.occurrenceAt || 0))
     // 「今天」只放真的落在今天/已过点的;以后的事进「接下来」—— 标题得跟内容对得上。
     // 刚登记时今天这个点已经过去的重复提醒(startTomorrow)放「接下来」,别在「今天」里占一行。
     const todays = sorted.filter((r) => r.status === 'pending' || r.status === 'done'
       || (r.status === 'silenced' && !r.startTomorrow))
     const expired = sorted.filter((r) => r.status === 'expired')
     const upcoming = sorted.filter((r) => r.status === 'upcoming' || r.status === 'not-today'
       || (r.status === 'silenced' && !!r.startTomorrow))
     const doneCount = todays.filter((r) => r.done).length
     const activeNotes = (state.notes || []).filter((n) => !n.archived
       && !((n.deletedAt || 0) > 0) && !((n.completedAt || 0) > 0) && n.shelf !== 'long')
     const latest = activeNotes.slice(0, 3)
     // 常去:置顶优先,其余按最近打开 —— 首页直接点,不用先进「网页」页
     const quick = (state.links || []).slice(0, 8)

     const row = (r, withCheck) => h('div', { key: r.id, className: '__dk_row' + (r.done ? ' __dk_done' : '') + (r.status === 'pending' && !r.done ? ' __dk_row--act' : '') }, [
       withCheck
         ? h('button', {
           key: 'c', className: '__dk_check' + (r.done ? ' on' : ''),
           onClick: () => run(r.done ? 'reminder.uncheckin' : 'reminder.checkin', { id: r.id }),
           title: r.done ? '取消完成' : '标记完成',
         }, r.done ? h(Ico, { name: 'check', size: 12 }) : null)
         : h('span', { key: 'c', className: '__dk_dotsep' }),
       h('div', { key: 'm', className: '__dk_rowmain' }, [
         h('div', { key: 't', className: '__dk_rt' }, r.title),
         h('div', { key: 's', className: '__dk_rm' }, reminderMeta(r)),
       ]),
       r.url ? h('a', { key: 'go', className: '__dk_go', href: r.url, target: '_blank', rel: 'noreferrer' }, '打开') : null,
       withCheck
         ? h('div', { key: 'act', className: '__dk_iact' }, [
           h('button', { key: 'k', className: '__dk_mini', title: '设置网址', 'aria-label': '设置打开网址', onClick: () => onLink(r) }, h(Ico, { name: 'link', size: 15 })),
         ])
         : null,
     ])

     return h(React.Fragment, null, [
       h(QuickFind, { key: 'qf', state, run, onGo }),
       // L1:今天要动手的。标题后面直接给完成度,不用点进去数
       h('div', { key: 's1', className: '__dk_sec __dk_sec--act' }, [
         h('span', { key: 'a' }, '今天'),
         h('span', { key: 'b' }, todays.length ? doneCount + '/' + todays.length + ' 已完成' : ''),
       ]),
       todays.length
         ? todays.slice(0, 6).map((r) => row(r, true))
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, '今天没有要处理的'),
           h('div', { key: 'h', className: '__dk_note' }, '在上面的输入框说一句「10分钟后提醒我关火」,或者点下方「提醒」手动加一条。'),
         ]),

       quick.length
         ? h('div', { key: 's5', className: '__dk_sec' }, [
           h('span', { key: 'a' }, '常去'),
           onGo ? h('button', { key: 'b', className: '__dk_linkbtn', onClick: () => onGo('links') }, '全部 ' + (state.links || []).length + ' 个') : null,
         ])
         : null,
       quick.length
         ? h('div', { key: 'qg', className: '__dk_grid __dk_grid--home' }, quick.map((l) => h(LinkTile, {
           key: l.id, l, run, notify, favicons: !!(state.settings && state.settings.linkFavicons),
           onEdit: () => onGo && onGo('links'),
         })))
         : null,

       upcoming.length
         ? h('div', { key: 's2', className: '__dk_sec' }, [h('span', { key: 'a' }, '接下来'), h('span', { key: 'b' }, String(upcoming.length))])
         : null,
       upcoming.length ? upcoming.slice(0, 3).map((r) => row(r, false)) : null,

       expired.length
         ? h('div', { key: 's4', className: '__dk_sec __dk_sec--ref' }, [h('span', { key: 'a' }, '已过期'), h('span', { key: 'b' }, String(expired.length))])
         : null,
       expired.slice(0, 2).map((r) => h('div', { key: r.id, className: '__dk_row __dk_row--dim' }, [
         h('span', { key: 'c', className: '__dk_dotsep' }),
         h('div', { key: 'm', className: '__dk_rowmain' }, [
           h('div', { key: 't', className: '__dk_rt' }, r.title),
           h('div', { key: 's', className: '__dk_rm' }, reminderMeta(r)),
         ]),
       ])),
       expired.length
         ? h('div', { key: 'exp', className: '__dk_hint', style: { padding: '2px 4px 0' } },
           '一次性提醒过了那天就不再响;要清理点「查看全部」进列表删。')
         : null,

       // 超过一屏就别把首页撑长,给个明确出口
       list.length > Math.min(todays.length, 6) && onGo
         ? h('div', { key: 'more', className: '__dk_more' }, [
           h('button', { key: 'b', className: '__dk_morebtn', onClick: () => onGo('reminders') }, '查看全部 ' + list.length + ' 项'),
         ])
         : null,

       latest.length ? h('div', { key: 's3', className: '__dk_sec' }, [h('span', { key: 'a' }, '最近记的'), h('span', { key: 'b' }, String(activeNotes.length))]) : null,
       latest.map((n) => h('div', { key: n.id, className: '__dk_row' }, [
         h('div', { key: 'm', className: '__dk_rowmain' }, [
           h('div', { key: 't', className: '__dk_rt' }, n.text.replace(/\s+/g, ' ').slice(0, 60)),
           h('div', { key: 's', className: '__dk_rm' }, fmtWhen(n.updatedAt) + (n.tags && n.tags.length ? ' · ' + n.tags.join(' ') : '')),
         ]),
         h('div', { key: 'act', className: '__dk_iact' }, [
           h('button', {
             key: 'c', className: '__dk_mini', title: '复制', 'aria-label': '复制这条',
             onClick: () => { if (copy(n.text) && notify) notify('已复制到剪贴板') },
           }, h(Ico, { name: 'copy', size: 15 })),
         ]),
       ])),
     ])
   }

