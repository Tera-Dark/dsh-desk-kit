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

   /** 一个格子。 */
   function LinkTile({ l, run, onEdit, notify, favicons }) {
     const custom = String(l.icon || '').trim()
     const img = isImageIcon(custom) ? custom : ''
     const emoji = custom && !img ? custom : ''
     const showFav = !custom && favicons
     return h('div', { className: '__dk_tile', title: l.url },
       h('div', { key: 'w', className: '__dk_appbtn' }, [
         h('button', {
           key: 'b', className: '__dk_app',
           // 单色:不再按域名取色,格子一律纸底墨字,靠描边和名字区分
           style: null,
           onClick: () => openLink(run, l, notify),
           title: l.title + ' · ' + l.url,
         }, [
           h('span', { key: 'c', className: '__dk_appchar', style: custom ? { fontSize: '22px' } : null }, emoji || linkInitial(l)),
           showFav ? h('img', {
             key: 'f', className: '__dk_appimg', src: 'https://icons.duckduckgo.com/ip3/' + linkHost(l.url) + '.ico', alt: '',
             onError: (e) => { e.currentTarget.style.display = 'none' },
           }) : null,
           img ? h('img', { key: 'i', className: '__dk_appimg', src: img, alt: '' }) : null,
           l.pinned ? h('span', { key: 'p', className: '__dk_apppin' }, '★') : null,
         ]),
         h('div', { key: 'act', className: '__dk_appact' }, [
           h('button', {
             key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑',
             onClick: () => onEdit(l),
           }, h(Ico, { name: 'edit', size: 11 })),
           h('button', {
             key: 'x', className: '__dk_mini', title: '移入垃圾箱', 'aria-label': '移入垃圾箱',
             onClick: async () => {
               await run('link.delete', { id: l.id })
               if (notify) notify('已移入垃圾箱', { action: 'link.restore', payload: { id: l.id } })
             },
           }, h(Ico, { name: 'x', size: 11 })),
         ]),
       ]),
       h('div', { key: 'n', className: '__dk_appname' }, l.title),
       // 一句备注:「查资料用」「公司后台」—— 比标题更能提醒自己为什么收它
       l.note ? h('div', { key: 'nt', className: '__dk_appnote', title: l.note }, l.note) : null,
     )
   }

   function LinksPage({ state, run, notify }) {
     const links = state.links || []
     const trashed = state.trashedLinks || []
     const groups = (state.linkGroups && state.linkGroups.groups) || []
     const ungrouped = (state.linkGroups && state.linkGroups.ungrouped) || 0
     const [group, setGroup] = useState('')          // '' = 全部
     const [view, setView] = useState('all')         // all | trash
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
       const body = f.id
         ? await run('link.update', { id: f.id, ...payload })
         : await run('link.add', payload)
       if (!body || body.ok === false) return
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

       form ? h('div', { key: 'form', className: '__dk_form' }, [
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
           h('input', {
             key: 'nt', className: '__dk_input', placeholder: '备注(可选:这站用来干什么)',
             value: form.note || '', onChange: (e) => setForm((f) => ({ ...f, note: e.target.value })),
             onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } },
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
           h('button', { key: 's', className: '__dk_btn p', disabled: !String(form.url || '').trim(), onClick: save }, '保存'),
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
         ? h('div', { key: 'grid', className: '__dk_grid' }, shown.map((l) => h(LinkTile, {
           key: l.id, l, run, notify, favicons, onEdit: startEdit,
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

