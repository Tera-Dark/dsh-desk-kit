   // ---------------------------------------------------------------- 网页页
   /**
    * 网页收藏 = 手机桌面那种格子:一个图标 + 名字,点一下在新标签页打开。
    * 图标优先用用户填的(emoji 或图片地址),否则用「首字 + 按域名算出来的底色」,
    * 这样同一个站点永远是同一个颜色,不联网也能一眼认出来。
    */
   function linkHost(url) {
     return String(url || '').replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '')
   }

   function linkHue(url) {
     const host = linkHost(url)
     let h = 0
     for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) % 360
     return h
   }

   function linkInitial(l) {
     const t = String((l && l.title) || '').trim() || linkHost(l && l.url)
     if (!t) return '?'
     // 中文取第一个字,英文取首字母(「GitHub」→ G,别搞成 GI)
     return t.slice(0, 1).toUpperCase()
   }

   function isImageIcon(icon) {
     return /^(https?:\/\/|data:image\/)/i.test(String(icon || ''))
   }

   /** 打开一次:记一笔(用于「最近用的排前面」),然后交给系统浏览器。 */
   function openLink(run, l, notify) {
     run('link.touch', { id: l.id })
     let opened = null
     try { opened = window.open(l.url, '_blank', 'noopener,noreferrer') } catch { opened = null }
     // 弹窗被拦时绝不能 location.href:那会把 DSH 整个页面换成目标网站。
     if (!opened) {
       try { navigator.clipboard.writeText(l.url) } catch {}
       if (notify) notify('浏览器拦了新窗口,链接已复制')
     }
   }

   /**
    * 复制链接:一键到手,自己去别处粘。
    * 非 https / 文档没焦点时 navigator.clipboard 会拒绝,所以留一条选中复制的退路。
    */
   async function copyLinkUrl(l, notify) {
     const text = String(l.url || '')
     const said = (ok) => {
       if (notify) notify(ok ? '链接已复制:' + linkHost(text) : '复制被拦了,手动选一下:' + text)
     }
     try {
       await navigator.clipboard.writeText(text)
       said(true)
       return
     } catch { /* 落到下面的兜底 */ }
     try {
       const ta = document.createElement('textarea')
       ta.value = text
       ta.setAttribute('readonly', '')
       ta.style.position = 'fixed'
       ta.style.top = '-1000px'
       ta.style.opacity = '0'
       document.body.appendChild(ta)
       ta.select()
       const ok = document.execCommand('copy')
       document.body.removeChild(ta)
       said(!!ok)
     } catch {
       said(false)
     }
   }

   /** 卡片右上角的小按钮组:复制 / 编辑 / 删除。 */
   function linkActions(l, run, onEdit, notify, size) {
     return h('div', { key: 'act', className: '__dk_appact' }, [
       h('button', {
         key: 'c', className: '__dk_mini', title: '复制链接', 'aria-label': '复制链接',
         onClick: () => copyLinkUrl(l, notify),
       }, h(Ico, { name: 'copy', size })),
       h('button', {
         key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑',
         onClick: () => onEdit(l),
       }, h(Ico, { name: 'edit', size })),
       h('button', {
         key: 'x', className: '__dk_mini', title: '移入垃圾箱', 'aria-label': '移入垃圾箱',
         onClick: async () => {
           const body = await run('link.delete', { id: l.id })
           if (!writeOk(body)) { if (notify) notify('没删掉,这个网页还在'); return }
           if (notify) notify('已移入垃圾箱', { action: 'link.restore', payload: { id: l.id } })
         },
       }, h(Ico, { name: 'x', size })),
     ])
   }

   /**
    * 一个网页。
    * compact(首页「常去」):一个图标 + 名字,占地方小。
    * card(网页页):图标 / 标题 / 域名一行,底下固定留三行简介的版面 ——
    *   收藏网页是为了记住「它是干嘛的」,简介不够看就等于没存。
    */
   function LinkTile({ l, run, onEdit, notify, favicons, card }) {
     const custom = String(l.icon || '').trim()
     const img = isImageIcon(custom) ? custom : ''
     const emoji = custom && !img ? custom : ''
     const showFav = !custom && favicons
     // 图标要么是图,要么是首字 —— 之前两者同时渲染,字母就压在 favicon 下面。
     const [iconFailed, setIconFailed] = useState(false)
     const src = iconFailed ? '' : (img || (showFav ? 'https://icons.duckduckgo.com/ip3/' + linkHost(l.url) + '.ico' : ''))
     const icon = h('button', {
       key: 'b', className: '__dk_app',
       // 单色:不再按域名取色,格子一律纸底墨字,靠描边和名字区分
       style: null,
       onClick: () => openLink(run, l, notify),
       title: '打开 ' + l.url,
       'aria-label': '打开 ' + l.title,
     }, [
       src
         ? h('img', {
           key: 'f', className: '__dk_appimg', src, alt: '',
           loading: 'lazy', decoding: 'async',
           onError: () => setIconFailed(true),
         })
         : h('span', { key: 'c', className: '__dk_appchar', style: (custom || emoji) ? { fontSize: '22px' } : null }, emoji || linkInitial(l)),
       l.pinned ? h('span', { key: 'p', className: '__dk_apppin' }, '★') : null,
     ])

     if (!card) {
       return h('div', { className: '__dk_tile', title: l.url },
         h('div', { key: 'w', className: '__dk_appbtn' }, [icon, linkActions(l, run, onEdit, notify, 11)]),
         h('div', { key: 'n', className: '__dk_appname' }, l.title),
         l.note ? h('div', { key: 'nt', className: '__dk_appnote', title: l.note }, l.note) : null,
       )
     }

     const note = String(l.note || '').trim()
     return h('div', { key: l.id, className: '__dk_tile __dk_tile--card', title: l.url },
       h('div', { key: 'top', className: '__dk_cardtop' }, [
         icon,
         h('div', { key: 'tx', className: '__dk_cardtext' }, [
           h('div', { key: 'n', className: '__dk_appname', title: '打开 ' + l.url, onClick: () => openLink(run, l, notify) }, l.title),
           h('div', { key: 'u', className: '__dk_cardhost', title: l.url }, linkHost(l.url)),
         ]),
       ]),
       h('div', {
         key: 'nt',
         className: '__dk_appnote' + (note ? '' : ' __dk_appnote--empty'),
         title: note || '',
       }, note || '还没写简介 —— 点编辑补一句,以后一眼就知道这站干嘛用'),
       linkActions(l, run, onEdit, notify, 12),
     )
   }

   function LinksPage({ state, run, notify }) {
     const links = state.links || []
     const trashed = state.trashedLinks || []
     const groups = (state.linkGroups && state.linkGroups.groups) || []
     const ungrouped = (state.linkGroups && state.linkGroups.ungrouped) || 0
     const [group, setGroup] = useState('')          // '' = 全部
     const [view, setView] = useState('all')         // all | trash
     const [busySave, setBusySave] = useState(false)  // 保存中:按钮换字,挡住连点两个「新网页」
     const [form, setForm] = useState(null)          // { id?, title, url, group, icon }
     const say = (text, undo) => { if (notify) notify(text, undo) }
     const favicons = !!(state.settings && state.settings.linkFavicons)

     const shown = links.filter((l) => !group || (group === '\u0000' ? !l.group : l.group === group))

     const startAdd = () => setForm({ title: '', url: '', group: group && group !== '\u0000' ? group : '', icon: '', note: '', pinned: false })
     const startEdit = (l) => setForm({ id: l.id, title: l.title, url: l.url, group: l.group, icon: l.icon || '', note: l.note || '', pinned: !!l.pinned })
     const save = async () => {
       const f = form || {}
       const title = String(f.title || '').trim()
       const url = String(f.url || '').trim()
       if (!url) { say('先填个网址'); return }
       const payload = { title, url, group: f.group || '', icon: f.icon || '', note: f.note || '', pinned: !!f.pinned }
       setBusySave(true)
       let body = null
       try {
         body = f.id
           ? await run('link.update', { id: f.id, ...payload })
           : await run('link.add', payload)
       } finally { setBusySave(false) }
       // 没存上就把表单留着:关掉等于让用户重填一遍网址和简介
       if (!writeOk(body)) { say('没存上,表单还留着,再点一次保存'); return }
       const deduped = body.result && body.result.deduped
       setForm(null)
       if (f.id) say('已保存')
       else say(deduped ? '这个网址已经收过了,已顶到前面' : '已收藏网页')
     }

     // ---- 垃圾箱 ----
     if (view === 'trash') {
       return h(React.Fragment, null, [
         h('div', { key: 'bar', className: '__dk_toolbar' }, [
           h('button', { key: 'b', className: '__dk_btn', onClick: () => setView('all') }, [h(Ico, { key: 'i', name: 'chevronLeft', size: 14 }), ' 返回']),
           h('span', { key: 'h', className: '__dk_hint' }, '删掉的网页都在这里,可恢复'),
         ]),
         trashed.length
           ? trashed.map((l) => h('div', { key: l.id, className: '__dk_item' }, [
             h('div', { key: 't', className: '__dk_itop' }, [
               h('div', { key: 'x', className: '__dk_itext' }, l.title),
               h('div', { key: 'act', className: '__dk_iact' }, [
                 h('button', { key: 'rs', className: '__dk_mini', title: '恢复', onClick: () => run('link.restore', { id: l.id }) }, h(Ico, { name: 'undo', size: 15 })),
                 h('button', {
                   key: 'pg', className: '__dk_mini', title: '彻底删除',
                   onClick: () => { if (window.confirm('彻底删除「' + l.title + '」?不可恢复')) run('link.purge', { id: l.id }) },
                 }, h(Ico, { name: 'x', size: 15 })),
               ]),
             ]),
             h('div', { key: 'm', className: '__dk_imeta' }, [h('span', { key: 'u' }, linkHost(l.url)), h('span', { key: 'd' }, '删除于 ' + fmtWhen(l.deletedAt))]),
           ]))
           : h('div', { key: 'e', className: '__dk_empty' }, [
             h('div', { key: 't', className: '__dk_emptytitle' }, '垃圾箱是空的'),
             h('div', { key: 'h', className: '__dk_note' }, '删掉的网页会先放这儿,想找回随时来。'),
           ]),
       ])
     }

     return h(React.Fragment, null, [
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: startAdd }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), ' 新网页']),
         h('span', { key: 'h', className: '__dk_hint' }, links.length + ' 个 · ' + groups.length + ' 个分类'),
       ]),

       form ? h('div', { key: 'form', className: '__dk_form', onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); setForm(null) } }, }, [
         h('div', { key: 'g', className: '__dk_group' }, [
           h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, form.id ? '编辑网页' : '收藏一个网页'), h('span', { key: 'b' }, '点一下就能跳')]),
           h('input', {
             key: 'u', className: '__dk_input', autoFocus: true, placeholder: '网址(example.com 也行)',
             value: form.url, onChange: (e) => setForm((f) => ({ ...f, url: e.target.value })),
             onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } },
           }),
           h('input', {
             key: 't', className: '__dk_input', placeholder: '叫什么(不填就用域名)',
             value: form.title, onChange: (e) => setForm((f) => ({ ...f, title: e.target.value })),
             onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } },
           }),
           h('input', {
             key: 'g2', className: '__dk_input', placeholder: '分类(可选,如「工作」「工具」)', list: '__dk_groups',
             value: form.group, onChange: (e) => setForm((f) => ({ ...f, group: e.target.value })),
             onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } },
           }),
           h('datalist', { key: 'dl', id: '__dk_groups' }, groups.map((g) => h('option', { key: g.name, value: g.name }))),
           h('input', {
             key: 'i', className: '__dk_input', placeholder: '图标(可选:一个 emoji,或图片地址)',
             value: form.icon, onChange: (e) => setForm((f) => ({ ...f, icon: e.target.value })),
           }),
           h('textarea', {
             key: 'nt', className: '__dk_input __dk_textarea', rows: 3,
             placeholder: '简介(可选,两三行:这站用来干什么、什么时候会想起它)。卡片上留三行位置',
             value: form.note || '', onChange: (e) => setForm((f) => ({ ...f, note: e.target.value })),
           }),
           h('div', { key: 'pin', className: '__dk_groupchips', style: { padding: '2px 0 0' } }, [
             h('button', {
               key: 'p', className: '__dk_chip' + (form.pinned ? ' on' : ''),
               onClick: () => setForm((f) => ({ ...f, pinned: !f.pinned })),
             }, (form.pinned ? '★ ' : '☆ ') + '置顶'),
           ]),
           form.id ? h(MoveChips, { key: 'mv', kind: 'link', id: form.id, run, notify: (t) => { setForm(null); say(t) } }) : null,
         ]),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 's', className: '__dk_btn p', disabled: busySave || !String(form.url || '').trim(), onClick: save }, busySave ? '保存中…' : '保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => setForm(null) }, '取消'),
         ]),
       ]) : null,

       // 分类 chips:全部 / 各分类 / 未分类
       h('div', { key: 'chips', className: '__dk_groupchips' }, [
         h('button', { key: 'all', className: '__dk_chip' + (group === '' ? ' on' : ''), onClick: () => setGroup('') }, '全部 ' + links.length),
         ...groups.map((g) => h('button', {
           key: g.name, className: '__dk_chip' + (group === g.name ? ' on' : ''), onClick: () => setGroup(g.name),
         }, g.name + ' ' + g.count)),
         ungrouped ? h('button', { key: 'none', className: '__dk_chip' + (group === '\u0000' ? ' on' : ''), onClick: () => setGroup('\u0000') }, '未分类 ' + ungrouped) : null,
       ]),

       shown.length
         ? h('div', { key: 'grid', className: '__dk_grid __dk_grid--links' }, shown.map((l) => h(LinkTile, {
           key: l.id, l, run, notify, favicons, onEdit: startEdit, card: true,
         })))
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, links.length ? '这个分类还是空的' : '还没有收藏网页'),
           h('div', { key: 'h', className: '__dk_note' }, links.length
             ? '点「新网页」加一个,或者在上面把这条的分类改掉。'
             : '点「新网页」手动加;也可以在首页说一句「收藏 https://example.com 分类:工具」。'),
         ]),

       h('div', { key: 'foot', className: '__dk_foot' }, [
         h('span', { key: 'sp', className: '__dk_spacer' }),
         h('button', { key: 't', className: '__dk_chip', onClick: () => setView('trash') }, '垃圾箱 (' + (state.linkCounts ? state.linkCounts.trash : trashed.length) + ')'),
       ]),
     ])
   }

