   // ---------------------------------------------------------------- 首页
   function Home({ state, run, onLink, onGo, notify }) {
     const list = (state.reminders || []).filter((r) => r.active !== false && r.status !== 'paused')
     const rank = (r) => (r.done ? 3 : r.status === 'pending' ? 0 : r.status === 'upcoming' ? 1 : 2)
     const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || (a.occurrenceAt || 0) - (b.occurrenceAt || 0))
     // 「今天」只放真的落在今天/已过点的;以后的事进「接下来」—— 标题得跟内容对得上
     const todays = sorted.filter((r) => r.status === 'pending' || r.status === 'done' || r.status === 'silenced')
     const expired = sorted.filter((r) => r.status === 'expired')
     const upcoming = sorted.filter((r) => r.status === 'upcoming' || r.status === 'not-today')
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

