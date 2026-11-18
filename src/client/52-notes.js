   // ---------------------------------------------------------------- 便签页
   function NotesPage({ state, run, notify }) {
     const [q, setQ] = useState('')
     const [kw, setKw] = useState('')                 // 防抖后的关键词(真正用来过滤的)
     const [draft, setDraft] = useState('')
     const [tags, setTags] = useState('')
     const [openAdd, setOpenAdd] = useState(false)
     const [editing, setEditing] = useState('')
     const [editText, setEditText] = useState('')
     const [expanded, setExpanded] = useState('')
     const [showDone, setShowDone] = useState(false)
     const [showArchived, setShowArchived] = useState(false)
     const [limit, setLimit] = useState(8)
     const [view, setView] = useState('main')      // main | trash
     const [moveId, setMoveId] = useState('')      // 哪一条正在挑分类
     const [draftFiles, setDraftFiles] = useState([])   // 还没保存的附件(已上传,拿到 id)
     const [busyFile, setBusyFile] = useState(false)
     const [viewing, setViewing] = useState(null)  // 正在看的大图
     const filePicker = useRef(null)
     const PAGE = 8
     const say = (text, undo) => { if (notify) notify(text, undo) }

     // 打字时每敲一下就重算整个列表没必要;停手 150ms 再过滤,输入才不卡。
     useEffect(() => {
       const t = setTimeout(() => setKw(q.trim().toLowerCase()), 150)
       return () => clearTimeout(t)
     }, [q])

     const counts = state.noteCounts || { active: 0, long: 0, done: 0, trash: 0, archived: 0 }
     const buckets = { active: [], long: [], done: [], trash: [], archived: [] }
     for (const n of (state.notes || [])) {
       const b = (n.deletedAt || 0) > 0 ? 'trash'
         : (n.completedAt || 0) > 0 ? 'done'
           : n.archived ? 'archived'
             : n.shelf === 'long' ? 'long'
               : 'active'
       buckets[b].push(n)
     }
     const fileMap = new Map((state.files || []).map((f) => [f.id, f]))
     const filesOf = (n) => (n.files || []).map((id) => fileMap.get(id)).filter(Boolean)
     const hit = (n) => !kw || (n.text + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(kw)
     // 搜索时跨「进行中 + 长期」一起搜,平铺显示;不搜索时分成两段
     const searched = kw ? buckets.active.concat(buckets.long, buckets.archived).filter(hit) : []
     // 便签页的搜索框也顺手当全局搜:提醒和保险库的标题一起找
     const remHits = kw ? (state.reminders || []).filter((r) => !((r.deletedAt || 0) > 0) && String(r.title || '').toLowerCase().includes(kw)) : []
     const secHits = kw ? (state.secrets || []).filter((x) => String(x.title || '').toLowerCase().includes(kw)) : []
     const linkHits = kw ? (state.links || []).filter((l) => (String(l.title || '') + ' ' + String(l.url || '')).toLowerCase().includes(kw)) : []
     // 附件也能按文件名搜到(「那张截图叫什么来着」)
     const fileHits = kw ? (state.files || []).filter((f) => String(f.name || '').toLowerCase().includes(kw)) : []

     /** 收文件:上传后先挂在草稿上,保存时随便签一起落库。 */
     const addFiles = async (list, nameOf) => {
       const picked = Array.from(list || []).slice(0, 8)
       if (!picked.length) return
       setBusyFile(true)
       try {
         const metas = []
         for (const f of picked) metas.push(await uploadFile(f, nameOf ? nameOf(f) : shotName(f)))
         setDraftFiles((cur) => [...cur, ...metas].slice(0, 12))
         setOpenAdd(true)
         if (metas.length) say('附件已就位,写点什么一起存')
       } catch (e) {
         say('没存上:' + String((e && e.message) || e))
       } finally { setBusyFile(false) }
     }

     /** 只留图片的文件草稿:保存时如果被删掉,顺手把原件也从库里清掉。 */
     const dropDraftFile = async (file) => {
       setDraftFiles((cur) => cur.filter((x) => x.id !== file.id))
       try { await run('file.delete', { id: file.id }) } catch { /* 清不掉也不影响 */ }
     }

     const add = async () => {
       const text = draft.trim()
       if (!text && !draftFiles.length) return
       await run('note.add', { text, tags: tags.split(/[\s,，]+/).filter(Boolean), files: draftFiles.map((f) => f.id) })
       setDraft(''); setTags(''); setDraftFiles([]); setOpenAdd(false)
       say(draftFiles.length ? '已存进便签(带 ' + draftFiles.length + ' 个附件)' : '已存进便签')
     }

     /** 读系统剪贴板:有图就贴成附件,只有文字就填进草稿。 */
     const readClipboard = async () => {
       try {
         if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('这个环境读不了剪贴板')
         const items = await navigator.clipboard.read()
         const imgs = []
         let text = ''
         for (const it of items) {
           const imgType = (it.types || []).find((t) => String(t).startsWith('image/'))
           if (imgType) {
             const blob = await it.getType(imgType)
             imgs.push(new File([blob], shotName({ type: imgType }), { type: imgType }))
             continue
           }
           if ((it.types || []).includes('text/plain')) {
             const t = await (await it.getType('text/plain')).text()
             if (t.trim()) text = t
           }
         }
         if (imgs.length) await addFiles(imgs)
         else if (text) { setDraft((cur) => (cur ? cur + '\n' + text : text)); setOpenAdd(true); say('已从剪贴板取到文字') } else say('剪贴板里没有图片或文字')
       } catch (e) {
         say('读不到剪贴板:' + String((e && e.message) || e) + '(也可以直接 Ctrl+V)')
       }
     }

     /** 一条便签。mode: daily | long | done | trash */
     const row = (n, mode) => {
       const isLong = mode === 'long'
       const open = expanded === n.id
       const firstLine = n.text.split('\n')[0]
       const actions = []
       if (mode === 'trash') {
         actions.push(h('button', { key: 'rs', className: '__dk_mini', title: '恢复', 'aria-label': '恢复', onClick: () => run('note.restore', { id: n.id }) }, h(Ico, { name: 'undo', size: 14 })))
         actions.push(h('button', { key: 'pg', className: '__dk_mini', title: '彻底删除', 'aria-label': '彻底删除', onClick: () => { if (window.confirm('彻底删除?不可恢复')) run('note.purge', { id: n.id }) } }, h(Ico, { name: 'x', size: 14 })))
       } else {
         actions.push(h('button', { key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑', onClick: () => { setEditing(n.id); setEditText(n.text) } }, h(Ico, { name: 'edit', size: 14 })))
         actions.push(h('button', {
           key: 'ck', className: '__dk_mini', title: n.completedAt ? '取消完成' : '标记完成', 'aria-label': n.completedAt ? '取消完成' : '标记完成',
           onClick: async () => {
             await run('note.complete', { id: n.id, done: !n.completedAt })
             // 手滑点错也要能一键回去
             if (!n.completedAt) say('已标记完成', { action: 'note.complete', payload: { id: n.id, done: false } })
           },
         }, h(Ico, { name: 'check', size: 14 })))
         actions.push(h('button', { key: 'mv', className: '__dk_mini', title: '转存到别的分类', 'aria-label': '转存到别的分类', onClick: () => setMoveId(moveId === n.id ? '' : n.id) }, h(Ico, { name: 'swap', size: 14 })))
         if (isLong) actions.push(h('button', { key: 'sh', className: '__dk_mini', title: '移回进行中', 'aria-label': '移回进行中', onClick: () => run('note.update', { id: n.id, shelf: 'daily' }) }, h(Ico, { name: 'undo', size: 14 })))
         actions.push(h('button', { key: 'p', className: '__dk_mini', title: n.pinned ? '取消置顶' : '置顶', 'aria-label': n.pinned ? '取消置顶' : '置顶', onClick: () => run('note.update', { id: n.id, pinned: !n.pinned }) }, h(Ico, { name: 'pin', size: 14 })))
         actions.push(h('button', {
           key: 'x', className: '__dk_mini', title: '移入垃圾箱', 'aria-label': '移入垃圾箱',
           onClick: async () => {
             await run('note.delete', { id: n.id })
             say('已移入垃圾箱', { action: 'note.restore', payload: { id: n.id } })
           },
         }, h(Ico, { name: 'trash', size: 14 })))
       }
       return h('div', { key: n.id, className: '__dk_item' + (isLong ? ' __dk_item--ref' : '') }, [
         editing === n.id
           ? h('div', { key: 'edit', className: '__dk_form' }, [
             h('textarea', { key: 't', className: '__dk_input __dk_area', rows: 6, value: editText, onChange: (e) => setEditText(e.target.value) }),
             h('div', { key: 'r', className: '__dk_frow' }, [
               h('button', { key: 's', className: '__dk_btn p', onClick: async () => { await run('note.update', { id: n.id, text: editText }); setEditing(''); say('已保存') } }, '保存'),
               h('button', { key: 'c', className: '__dk_btn', onClick: () => setEditing('') }, '取消'),
             ]),
           ])
           : h(React.Fragment, { key: 'v' }, [
             h('div', {
               key: 't',
               className: '__dk_itext' + (isLong && !open ? ' __dk_clamp2' : ''),
               onClick: isLong ? () => setExpanded(open ? '' : n.id) : null,
               style: isLong ? { cursor: 'pointer' } : null,
               title: isLong && !open ? '点一下展开全文' : null,
             }, isLong && !open ? (n.pinned ? '📌 ' : '') + (firstLine || '（图片）') : (n.text || (filesOf(n).length ? '（图片）' : '（空）'))),
             filesOf(n).length
               ? h(FileGrid, { key: 'fg', files: filesOf(n), onOpen: (f) => setViewing(f) })
               : null,
             h('div', { key: 'm', className: '__dk_imeta' }, [
               h('span', { key: 'd' }, fmtWhen(n.updatedAt)),
               filesOf(n).length ? h('span', { key: 'fc' }, filesOf(n).length + ' 个附件') : null,
               // 在垃圾箱里:说清楚什么时候会被自动清掉
               (state.trash || []).find((t) => t.kind === 'note' && t.id === n.id)
                 ? h('span', { key: 'tl', className: '__dk_expire' }, daysText((state.trash || []).find((t) => t.kind === 'note' && t.id === n.id).daysLeft))
                 : null,
               isLong && !open ? h('span', { key: 'sz' }, n.text.length + ' 字') : null,
               ...(n.tags || []).map((tag) => h('span', { key: tag, className: '__dk_tag' }, tag)),
               h('div', { key: 'act', className: '__dk_iact' }, [
                 h('button', {
                   key: 'cp', className: '__dk_mini', title: '复制', 'aria-label': '复制',
                   onClick: () => { if (copy(n.text)) say('已复制到剪贴板') },
                 }, h(Ico, { name: 'copy', size: 14 })),
                 ...actions,
               ]),
             ]),
             moveId === n.id ? h(MoveChips, { key: 'mv', kind: 'note', id: n.id, run, notify: (t) => { setMoveId(''); say(t) } }) : null,
           ]),
       ])
     }

     // 分段即等级:L2 进行中(常规) / L3 长期资料(灰、可折叠) / 已完成(折叠不占位)
     const seg = (key, title, list) => {
       if (!list.length) return null
       const shown = list.slice(0, limit)
       const rest = list.length - shown.length
       return h('div', { key }, [
         h('div', { key: 'h', className: '__dk_sec' + (key === 'long' ? ' __dk_sec--ref' : '') }, [
           h('span', { key: 'a' }, title), h('span', { key: 'b' }, String(list.length)),
         ]),
         ...shown.map((n) => row(n, key)),
         // 超出就先给一截,点一下接着放 —— 比「自己去搜」符合直觉
         rest > 0
           ? h('div', { key: 'more', className: '__dk_more' }, [
             h('button', { key: 'b', className: '__dk_morebtn', onClick: () => setLimit((v) => v + PAGE) },
               '显示更多(还有 ' + rest + ' 条)'),
           ])
           : null,
       ])
     }

     // ---- 垃圾箱视图 ----
     if (view === 'trash') {
       const list = buckets.trash.filter(hit)
       return h(React.Fragment, null, [
         h('div', { key: 'sq', className: '__dk_search' }, h('div', { className: '__dk_qwrap' }, [
           h('input', { key: 'i', className: '__dk_input', placeholder: '搜索垃圾箱…', value: q, onChange: (e) => setQ(e.target.value) }),
           q ? h('button', { key: 'x', className: '__dk_qclear', title: '清空', onClick: () => setQ('') }, h(Ico, { name: 'x', size: 14 })) : null,
         ])),
         h('div', { key: 'bar', className: '__dk_toolbar' }, [
           h('button', { key: 'b', className: '__dk_btn', onClick: () => { setView('main'); setQ('') } }, [h(Ico, { key: 'i', name: 'chevronLeft', size: 14 }), ' 返回']),
           h('span', { key: 'h', className: '__dk_hint' }, '删掉的都在这里,可恢复'),
         ]),
         list.length
           ? list.map((n) => row(n, 'trash'))
           : h('div', { key: 'e', className: '__dk_empty' }, [
             h('div', { key: 't', className: '__dk_emptytitle' }, '垃圾箱是空的'),
             h('div', { key: 'h', className: '__dk_note' }, '删掉的便签会先放这儿,想找回随时来。'),
           ]),
       ])
     }

     return h(React.Fragment, null, [
       // 搜索在最上面:人找东西第一反应是搜
       h('div', { key: 'sq', className: '__dk_search' }, h('div', { className: '__dk_qwrap' }, [
         h('input', {
           key: 'i', className: '__dk_input', type: 'search',
           placeholder: '搜所有便签…(标题、正文、标签)', value: q,
           onChange: (e) => setQ(e.target.value),
           onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ('') } },
         }),
         q ? h('button', { key: 'x', className: '__dk_qclear', title: '清空搜索', 'aria-label': '清空搜索', onClick: () => setQ('') }, h(Ico, { name: 'x', size: 14 })) : null,
       ])),
       kw ? h('div', { key: 'qh', className: '__dk_qhint' }, '「' + q.trim() + '」· 命中 ' + searched.length + ' 条') : null,
       h(Lightbox, { key: 'light', file: viewing, onClose: () => setViewing(null) }),
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => setOpenAdd((v) => !v) }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), openAdd ? ' 收起' : ' 新便签']),
         h('button', {
           key: 'af', className: '__dk_btn', disabled: busyFile, title: '选图片或任意文件(也可以直接把文件拖到面板里)',
           onClick: () => { setOpenAdd(true); setTimeout(() => filePicker.current && filePicker.current.click(), 30) },
         }, [h(Ico, { key: 'i', name: 'image', size: 13 }), ' 附件']),
         h('button', {
           key: 'ca', className: '__dk_btn', title: '复制当前列表',
           onClick: () => {
             const allText = (kw ? searched : buckets.active.concat(buckets.long)).map((n) => (n.tags && n.tags.length ? '[' + n.tags.join(' ') + '] ' : '') + n.text).join('\n\n')
             if (copy(allText)) say('已复制 ' + (kw ? searched.length : buckets.active.length + buckets.long.length) + ' 条')
           },
         }, [h(Ico, { key: 'i', name: 'copy', size: 13 }), ' 复制']),
       ]),
       openAdd ? h('div', {
         key: 'form', className: '__dk_form',
         // 表单里粘贴/拖文件:先挂在草稿上(你还想写两句),保存时一起落库
         onPaste: (e) => {
           const files = filesFromDataTransfer(e.clipboardData)
           if (!files.length) return
           e.preventDefault(); e.stopPropagation()
           addFiles(files)
         },
         onDragOver: (e) => { e.preventDefault() },
         onDrop: (e) => {
           const files = filesFromDataTransfer(e.dataTransfer)
           if (!files.length) return
           e.preventDefault(); e.stopPropagation()
           addFiles(files)
         },
       }, [
         h('div', { key: 'g', className: '__dk_group' }, [
           h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '新便签'), h('span', { key: 'b' }, '长文自动进「长期资料」')]),
           h('textarea', {
             key: 't', className: '__dk_input __dk_area', rows: 4, autoFocus: true,
             placeholder: '写点什么…(Ctrl/Cmd+Enter 保存)', value: draft,
             onChange: (e) => setDraft(e.target.value),
             onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add() } },
           }),
           h('input', { key: 'g2', className: '__dk_input', placeholder: '标签,空格分隔(可选)', value: tags, onChange: (e) => setTags(e.target.value) }),
         ]),
         h('div', { key: 'ft', className: '__dk_frow' }, [
           h('button', {
             key: 'p', className: '__dk_btn', disabled: busyFile,
             title: '选图片或任意文件', onClick: () => filePicker.current && filePicker.current.click(),
           }, [h(Ico, { key: 'i', name: 'image', size: 13 }), busyFile ? ' 传…' : ' 图片/文件']),
           h('button', { key: 'c2', className: '__dk_btn', disabled: busyFile, title: '读系统剪贴板(截图后不用切窗口)', onClick: readClipboard }, [h(Ico, { key: 'i', name: 'clipboard', size: 13 }), ' 读剪贴板']),
           h('span', { key: 'h', className: '__dk_hint' }, '也可以直接 Ctrl+V 或把文件拖进来'),
         ]),
         h('input', {
           key: 'fi', ref: filePicker, type: 'file', multiple: true, style: { display: 'none' },
           onChange: (e) => { addFiles(e.target.files); e.target.value = '' },
         }),
         draftFiles.length
           ? h('div', { key: 'df', className: '__dk_draftfiles' }, [
             h(FileGrid, { key: 'g', files: draftFiles, onRemove: dropDraftFile, onOpen: (f) => setViewing(f) }),
             h('div', { key: 'h', className: '__dk_hint' }, draftFiles.length + ' 个附件,和便签一起保存'),
           ])
           : null,
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 's', className: '__dk_btn p', disabled: !draft.trim() && !draftFiles.length, onClick: add }, '保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => { setOpenAdd(false); for (const f of draftFiles) dropDraftFile(f) } }, '取消'),
         ]),
       ]) : null,

       // 搜索:平铺结果(便签 + 提醒标题 + 保险库标题)
       kw
         ? (searched.length
           ? searched.map((n) => row(n, n.shelf === 'long' && !n.archived ? 'long' : 'daily'))
           : (remHits.length || secHits.length || linkHits.length || fileHits.length
             ? null
             : h('div', { key: 'e', className: '__dk_empty' }, [
               h('div', { key: 't', className: '__dk_emptytitle' }, '没搜到「' + q.trim() + '」'),
               h('div', { key: 'h', className: '__dk_note' }, '换个词试试,或者把搜索清空看全部。'),
             ])))
         : null,
       kw && remHits.length
         ? h('div', { key: 'sr' }, [
           h('div', { key: 'h', className: '__dk_sec' }, [h('span', { key: 'a' }, '提醒里命中'), h('span', { key: 'b' }, String(remHits.length))]),
           ...remHits.slice(0, 5).map((r) => h('div', { key: r.id, className: '__dk_row' }, [
             h('div', { key: 'm', className: '__dk_rowmain' }, [
               h('div', { key: 't', className: '__dk_rt' }, r.title),
               h('div', { key: 's', className: '__dk_rm' }, reminderMeta(r)),
             ]),
           ])),
         ])
         : null,
       kw && linkHits.length
         ? h('div', { key: 'sl' }, [
           h('div', { key: 'h', className: '__dk_sec' }, [h('span', { key: 'a' }, '网页里命中'), h('span', { key: 'b' }, String(linkHits.length))]),
           ...linkHits.slice(0, 5).map((l) => h('div', { key: l.id, className: '__dk_row' }, [
             h('div', { key: 'm', className: '__dk_rowmain' }, [
               h('div', { key: 't', className: '__dk_rt' }, l.title),
               h('div', { key: 's', className: '__dk_rm' }, linkHost(l.url) + (l.group ? ' · ' + l.group : '')),
             ]),
           ])),
         ])
         : null,
       kw && fileHits.length
         ? h('div', { key: 'sf' }, [
           h('div', { key: 'h', className: '__dk_sec' }, [h('span', { key: 'a' }, '附件里命中'), h('span', { key: 'b' }, String(fileHits.length))]),
           h(FileGrid, { key: 'g', files: fileHits.slice(0, 12), onOpen: (f) => setViewing(f) }),
         ])
         : null,
       kw && secHits.length
         ? h('div', { key: 'ss' }, [
           h('div', { key: 'h', className: '__dk_sec __dk_sec--ref' }, [h('span', { key: 'a' }, '保险库里命中'), h('span', { key: 'b' }, String(secHits.length))]),
           ...secHits.slice(0, 5).map((x) => h('div', { key: x.id, className: '__dk_row' }, [
             h('div', { key: 'm', className: '__dk_rowmain' }, [
               h('div', { key: 't', className: '__dk_rt' }, x.title),
               h('div', { key: 's', className: '__dk_rm' }, '点「保险库」查看明文'),
             ]),
           ])),
         ])
         : null,
       // 不搜索:两段
       kw ? null : seg('active', '进行中', buckets.active),
       kw ? null : seg('long', '长期资料', buckets.long),
       kw ? null : (buckets.active.length === 0 && buckets.long.length === 0
         ? h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, '还没有便签'),
           h('div', { key: 'h', className: '__dk_note' }, '点「新便签」写一条;或者在首页说一句「把这段存起来」。'),
         ])
         : null),

       // 已完成折叠 + 垃圾箱入口
       h('div', { key: 'foot', className: '__dk_foot' }, [
         buckets.done.length
           ? h('button', { key: 'd', className: '__dk_chip', onClick: () => setShowDone((v) => !v) },
             (showDone ? '收起已完成' : '显示已完成') + ' (' + (counts.done || 0) + ')')
           : null,
         buckets.archived.length
           ? h('button', { key: 'ar', className: '__dk_chip', onClick: () => setShowArchived((v) => !v) },
             (showArchived ? '收起归档' : '已归档') + ' (' + buckets.archived.length + ')')
           : null,
         h('span', { key: 'sp', className: '__dk_spacer' }),
         h('button', { key: 't', className: '__dk_chip', onClick: () => { setView('trash'); setQ('') } },
           '垃圾箱 (' + (counts.trash || 0) + ')'),
       ]),
       showDone && !kw ? buckets.done.map((n) => row(n, 'done')) : null,
       showArchived && !kw ? buckets.archived.map((n) => row(n, 'daily')) : null,
     ])
   }

