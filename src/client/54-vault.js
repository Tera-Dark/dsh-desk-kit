   // ---------------------------------------------------------------- 保险库页
   /** 明文在屏幕上停留多久自动收起。人看一眼就够,不该一直亮着。 */
   const VAULT_HIDE_MS = 30000

   /** 把解密后的条目摊平成一整段文本,给编辑用。 */
   function secretText(entry) {
     const fields = (entry && entry.fields) || {}
     if (fields['内容'] && Object.keys(fields).length === 1) return fields['内容']
     const lines = Object.entries(fields).map(([k, v]) => k + ': ' + v)
     if (entry && entry.note) lines.push(entry.note)
     return lines.join('\n')
   }

   /** 保险库里有哪些合集、各多少条;空合集不单独留记录。 */
   function secretCollections(secrets) {
     const counts = new Map()
     let ungrouped = 0
     for (const s of secrets || []) {
       const name = String(s.collection || '').trim()
       if (!name) { ungrouped++; continue }
       counts.set(name, (counts.get(name) || 0) + 1)
     }
     return {
       list: [...counts.entries()]
         .map(([name, count]) => ({ name, count }))
         .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
       ungrouped,
     }
   }

   function VaultPage({ state, run, notify, focus }) {
     const [moving, setMoving] = useState('')
     const [openAdd, setOpenAdd] = useState(false)
     const [title, setTitle] = useState('')
     const [body, setBody] = useState('')
     const [addCollection, setAddCollection] = useState('')
     const [q, setQ] = useState('')
     const [collection, setCollection] = useState('')   // '' = 全部, '\u0000' = 未分类
     const [limit, setLimit] = useState(30)
     const [dragging, setDragging] = useState('')
     const [dragOver, setDragOver] = useState('')
     const [revealed, setRevealed] = useState({})
     const [editing, setEditing] = useState(null)   // { id, title, body, collection }
     const [draftFiles, setDraftFiles] = useState([])
     const [viewing, setViewing] = useState(null)
     const filePicker = useRef(null)
     const timers = useRef({})
     const secrets = state.secrets || []
     const say = (text, undo) => { if (notify) notify(text, undo) }
     const groups = secretCollections(secrets)
     const collParam = collection === '\u0000' ? '' : collection
     const dragEnabled = !q.trim() && collection !== ''

     // 页面关掉/切走时把计时器全清掉,别在卸载之后还去 setState
     useEffect(() => () => {
       for (const t of Object.values(timers.current)) clearTimeout(t)
       timers.current = {}
     }, [])

     // 切换合集/搜索时回到第一页,别让人看见「显示更多」后面接着旧列表
     useEffect(() => { setLimit(30) }, [collection, q])

     // 不逼用户拆字段:想怎么记就怎么记,整段加密
     const add = async () => {
       if (!title.trim() && !draftFiles.length) return
       await run('secret.add', {
         title: title.trim() || '未命名条目', body,
         collection: addCollection.trim(),
         files: draftFiles.map((f) => f.id),
       })
       setTitle(''); setBody(''); setAddCollection(''); setDraftFiles([]); setOpenAdd(false)
       say('已加密保存')
     }
     /** 保险库的附件:落盘前整块加密,点「显示」之后才列出来。 */
     const addFiles = async (list) => {
       const picked = Array.from(list || []).slice(0, 8)
       if (!picked.length) return
       try {
         const metas = []
         for (const f of picked) metas.push(await uploadFile(f, shotName(f)))
         setDraftFiles((cur) => [...cur, ...metas].slice(0, 12))
         setOpenAdd(true)
         setAddCollection(collection && collection !== '\u0000' ? collection : '')
       } catch (e) { say('没存上:' + String((e && e.message) || e)) }
     }
     const startAdd = () => {
       const next = !openAdd
       setOpenAdd(next)
       if (next) setAddCollection(collection && collection !== '\u0000' ? collection : '')
     }
     const hide = (id) => {
       if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id] }
       setRevealed((cur) => ({ ...cur, [id]: null }))
     }
     const reveal = async (id) => {
       if (revealed[id]) { hide(id); return }
       const body = await run('secret.get', { query: id })
       if (!body || !body.result) return
       setRevealed((cur) => ({ ...cur, [id]: body.result }))
       // 30 秒没用就自动收起来(再点一下「显示」可以继续看)
       if (timers.current[id]) clearTimeout(timers.current[id])
       timers.current[id] = setTimeout(() => { delete timers.current[id]; setRevealed((cur) => ({ ...cur, [id]: null })) }, VAULT_HIDE_MS)
     }

     const ql = q.trim()
     const variants = ql ? searchVariants(ql) : []
     const filtered = secrets.filter((s) => !collection || (collection === '\u0000' ? !s.collection : s.collection === collection))
     const ordered = filtered.slice().sort((a, b) =>
       (Number(a.order) || 0) - (Number(b.order) || 0)
       || (b.updatedAt || 0) - (a.updatedAt || 0))
     const matched = ql
       ? ordered.filter((s) => searchMatch(s.title, variants) || searchMatch(s.collection, variants))
       : ordered
     const shown = matched.slice(0, limit)
     const indexOf = new Map(ordered.map((s, i) => [s.id, i]))

     const reorder = async (ids) => {
       if (!ids || ids.length < 2) return
       const r = await run('secret.reorder', { collection: collParam, ids })
       if (r) say('顺序已保存')
     }
     const moveOne = (id, dir) => {
       if (!dragEnabled) return
       const ids = ordered.map((s) => s.id)
       const i = ids.indexOf(id)
       const j = i + dir
       if (i < 0 || j < 0 || j >= ids.length) return
       const [x] = ids.splice(i, 1)
       ids.splice(j, 0, x)
       reorder(ids)
     }
     const dropOn = (targetId, fromId) => {
       const source = fromId || dragging
       if (!dragEnabled || !source || source === targetId) return
       const ids = ordered.map((s) => s.id)
       const from = ids.indexOf(source)
       const to = ids.indexOf(targetId)
       if (from < 0 || to < 0) return
       const [x] = ids.splice(from, 1)
       ids.splice(to, 0, x)
       setDragging(''); setDragOver('')
       reorder(ids)
     }

     // 从快搜点「确认」进来:滚到那条并展开,看完 30 秒自动收起。
     useEffect(() => {
       const id = focus && focus.secretId
       if (!id) return undefined
       const t = setTimeout(() => {
         const el = Array.from(document.querySelectorAll('[data-dk-secret]')).find((x) => x.getAttribute('data-dk-secret') === id)
         if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
         reveal(id)
       }, 80)
       return () => clearTimeout(t)
     }, [focus && focus.secretId])

     const collectionOptions = groups.list.map((g) => h('option', { key: g.name, value: g.name }))

     return h(React.Fragment, null, [
       h(Lightbox, { key: 'light', file: viewing, onClose: () => setViewing(null) }),
       h('div', { key: 'sq', className: '__dk_search' }, h('div', { className: '__dk_qwrap' }, [
         h('input', {
           key: 'i', className: '__dk_input', placeholder: '搜保险库标题或合集…', value: q,
           onChange: (e) => setQ(e.target.value),
         }),
         q ? h('button', { key: 'x', className: '__dk_qclear', title: '清空', onClick: () => setQ('') }, h(Ico, { name: 'x', size: 14 })) : null,
       ])),
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: startAdd }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), openAdd ? ' 收起' : ' 新条目']),
         h('button', {
           key: 'af', className: '__dk_btn', title: '给新条目加附件(截图/文件,和正文一起加密)',
           onClick: () => {
             setOpenAdd(true)
             setAddCollection(collection && collection !== '\u0000' ? collection : '')
             setTimeout(() => filePicker.current && filePicker.current.click(), 30)
           },
         }, [h(Ico, { key: 'i', name: 'image', size: 13 }), ' 附件']),
         h('span', { key: 'h', className: '__dk_hint' }, '共 ' + secrets.length + ' 条 · ' + groups.list.length + ' 个合集 · AES-256-GCM'),
       ]),
       h('div', { key: 'chips', className: '__dk_groupchips' }, [
         h('button', { key: 'all', className: '__dk_chip' + (collection === '' ? ' on' : ''), onClick: () => setCollection('') }, '全部 ' + secrets.length),
         ...groups.list.map((g) => h('button', {
           key: g.name, className: '__dk_chip' + (collection === g.name ? ' on' : ''), onClick: () => setCollection(g.name),
         }, g.name + ' ' + g.count)),
         groups.ungrouped ? h('button', { key: 'none', className: '__dk_chip' + (collection === '\u0000' ? ' on' : ''), onClick: () => setCollection('\u0000') }, '未分类 ' + groups.ungrouped) : null,
       ]),
       h('div', { key: 'hint', className: '__dk_hint __dk_vaultsort' }, dragEnabled
         ? '拖动手柄上下排序;手机上可用 ↑↓ 按钮'
         : collection ? '清空搜索后可拖拽排序' : '选一个合集后可拖拽排序'),
       editing ? h('div', { key: 'edit', className: '__dk_form' }, [
         h('div', { key: 'g', className: '__dk_group' }, [
           h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '编辑条目'), h('span', { key: 'b' }, '保存后重新加密')]),
           h('input', {
             key: 't', className: '__dk_input', autoFocus: true,
             value: editing.title,
             onChange: (e) => setEditing((cur) => ({ ...cur, title: e.target.value })),
           }),
           h('input', {
             key: 'c', className: '__dk_input', placeholder: '合集(可选,如「梯子订阅」)',
             list: '__dk_secret_collections', value: editing.collection || '',
             onChange: (e) => setEditing((cur) => ({ ...cur, collection: e.target.value })),
           }),
           h('textarea', {
             key: 'b', className: '__dk_input', rows: 7,
             style: { resize: 'vertical', fontFamily: 'inherit' },
             value: editing.body,
             onChange: (e) => setEditing((cur) => ({ ...cur, body: e.target.value })),
           }),
           h('div', { key: 'tip', className: '__dk_gtip' }, '整段替换原内容(字段会合并成一段文本),标题可以单独改。'),
         ]),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', {
             key: 's', className: '__dk_btn p', disabled: !editing.title.trim() || !String(editing.body || '').trim(),
             onClick: async () => {
               await run('secret.update', {
                 query: editing.id, title: editing.title.trim(), body: editing.body,
                 collection: String(editing.collection || '').trim(),
               })
               setEditing(null)
               say('已更新并重新加密')
             },
           }, '保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => setEditing(null) }, '取消'),
         ]),
       ]) : null,
       openAdd ? h('div', {
         key: 'form', className: '__dk_form',
         // 保险库里也能直接粘贴截图:截完图 Ctrl+V 就挂在新条目上
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
           h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '新条目'), h('span', { key: 'b' }, '整段加密')]),
           h('input', {
             key: 't', className: '__dk_input', autoFocus: true,
             placeholder: '叫什么(如「家里 WiFi」「备用码」)',
             value: title, onChange: (e) => setTitle(e.target.value),
           }),
           h('input', {
             key: 'c', className: '__dk_input', placeholder: '合集(可选,如「梯子订阅」)',
             list: '__dk_secret_collections', value: addCollection,
             onChange: (e) => setAddCollection(e.target.value),
           }),
           h('textarea', {
             key: 'b', className: '__dk_input', rows: 6,
             style: { resize: 'vertical', fontFamily: 'inherit' },
             placeholder: '想记什么就写什么:\n账号 demo_user 密码 abc123\n或者整段说明、备用码、恢复邮箱…\n不用拆字段,整段加密',
             value: body, onChange: (e) => setBody(e.target.value),
           }),
           h('div', { key: 'tip', className: '__dk_gtip' }, '提交后本地加密落盘,列表里只看到标题;要看内容点「显示」。'),
         ]),
         h('input', {
           key: 'fi', ref: filePicker, type: 'file', multiple: true, style: { display: 'none' },
           onChange: (e) => { addFiles(e.target.files); e.target.value = '' },
         }),
         draftFiles.length
           ? h('div', { key: 'df', className: '__dk_draftfiles' }, [
             h(FileGrid, {
               key: 'g', files: draftFiles,
               onRemove: (f) => setDraftFiles((cur) => cur.filter((x) => x.id !== f.id)),
               onOpen: (f) => setViewing(f),
             }),
             h('div', { key: 'h', className: '__dk_hint' }, draftFiles.length + ' 个附件,和正文一起加密'),
           ])
           : null,
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 's', className: '__dk_btn p', disabled: !title.trim() && !draftFiles.length, onClick: add }, '加密保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => setOpenAdd(false) }, '取消'),
         ]),
       ]) : null,
       h('datalist', { key: 'dl', id: '__dk_secret_collections' }, collectionOptions),
       shown.length
         ? shown.map((s) => {
           const at = indexOf.get(s.id)
           const last = ordered.length - 1
           return h('div', {
             key: s.id,
             className: '__dk_item'
               + (dragging === s.id ? ' __dk_item--drag' : '')
               + (dragOver === s.id ? ' __dk_item--over' : ''),
             'data-dk-secret': s.id,
             draggable: dragEnabled,
             onDragStart: dragEnabled ? (e) => {
               setDragging(s.id)
               try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id) } catch { /* 老浏览器 */ }
             } : undefined,
             onDragOver: dragEnabled ? (e) => {
               e.preventDefault()
               if (dragOver !== s.id) setDragOver(s.id)
             } : undefined,
             onDragLeave: dragEnabled ? () => { if (dragOver === s.id) setDragOver('') } : undefined,
             onDrop: dragEnabled ? (e) => {
               e.preventDefault()
               dropOn(s.id, (() => { try { return e.dataTransfer.getData('text/plain') } catch { return '' } })())
             } : undefined,
             onDragEnd: dragEnabled ? () => { setDragging(''); setDragOver('') } : undefined,
           }, [
             h('div', { key: 't', className: '__dk_itop' }, [
               dragEnabled ? h('span', { key: 'g', className: '__dk_drag', title: '拖动排序', 'aria-hidden': 'true' }, h(Ico, { name: 'menu', size: 13 })) : null,
               h('div', { key: 'x', className: '__dk_itext __dk_lockrow' }, [h(Ico, { key: 'i', name: 'lock', size: 14 }), s.title]),
               h('button', {
                 key: 'v', className: '__dk_mini', title: revealed[s.id] ? '收起' : '显示内容',
                 style: { width: 'auto', padding: '0 8px' },
                 onClick: () => reveal(s.id),
               }, revealed[s.id] ? '收起' : '显示'),
               h('div', { key: 'act', className: '__dk_iact' }, [
                 dragEnabled ? h('button', {
                   key: 'up', className: '__dk_mini __dk_move', title: '上移', 'aria-label': '上移',
                   disabled: at <= 0, onClick: () => moveOne(s.id, -1),
                 }, h(Ico, { name: 'chevronUp', size: 13 })) : null,
                 dragEnabled ? h('button', {
                   key: 'dn', className: '__dk_mini __dk_move', title: '下移', 'aria-label': '下移',
                   disabled: at >= last, onClick: () => moveOne(s.id, 1),
                 }, h(Ico, { name: 'chevronDown', size: 13 })) : null,
                 h('button', { key: 'mv', className: '__dk_mini', title: '转存到别的分类', 'aria-label': '转存到别的分类', onClick: () => setMoving(moving === s.id ? '' : s.id) }, h(Ico, { name: 'swap', size: 14 })),
                 h('button', {
                   key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑',
                   onClick: async () => {
                     const full = await run('secret.get', { query: s.id })
                     if (!full || !full.result) return
                     hide(s.id)
                     setEditing({ id: s.id, title: s.title, body: secretText(full.result), collection: s.collection || '' })
                   },
                 }, h(Ico, { name: 'edit', size: 14 })),
                 h('button', {
                   key: 'd', className: '__dk_mini', title: '删除', 'aria-label': '删除',
                   onClick: async () => {
                     // 保险库不进垃圾箱,所以这里必须确认
                     if (!window.confirm('删除「' + s.title + '」?加密内容一起删,不可恢复')) return
                     await run('secret.delete', { query: s.id })
                   },
                 }, h(Ico, { name: 'x', size: 14 })),
               ]),
             ]),
             revealed[s.id] ? h('div', { key: 'f', className: '__dk_fields' }, Object.entries(revealed[s.id].fields || {}).map(([k, v]) =>
               h('div', { key: k, className: '__dk_field' }, [
                 h('span', { key: 'k', className: 'k' }, k),
                 h('span', { key: 'v', className: 'v' }, String(v)),
                 h('button', { key: 'c', className: '__dk_mini', title: '复制(30 秒后自动清空剪贴板)', onClick: () => { if (copySecret(v)) say('已复制,30 秒后自动清空剪贴板') } }, h(Ico, { name: 'copy', size: 13 })),
               ]))) : null,
             revealed[s.id] && revealed[s.id].note
               ? h('div', { key: 'n', className: '__dk_note', style: { whiteSpace: 'pre-wrap', padding: '2px 4px 0' } }, revealed[s.id].note)
               : null,
             revealed[s.id] && (revealed[s.id].files || []).length
               ? h(FileGrid, { key: 'fg', files: revealed[s.id].files, onOpen: (f) => setViewing(f) })
               : null,
             h('div', { key: 'm', className: '__dk_imeta' }, [
               h('span', { key: 'd' }, fmtWhen(s.updatedAt || s.createdAt)),
               s.collection && collection !== s.collection ? h('span', { key: 'c', className: '__dk_tag' }, s.collection) : null,
               revealed[s.id] ? h('span', { key: 't' }, '30 秒后自动收起') : null,
             ]),
             moving === s.id ? h(MoveChips, { key: 'mv', kind: 'secret', id: s.id, run, notify: (t) => { setMoving(''); say(t) } }) : null,
           ])
         })
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, secrets.length ? '这个合集还是空的' : '保险库是空的'),
           h('div', { key: 'h', className: '__dk_note' }, secrets.length
             ? '点「新条目」加一个,或者在上面切回全部。'
             : '点「新条目」把账号密码、备用码整段贴进去,本地加密,不联网。'),
         ]),
       shown.length < matched.length
         ? h('div', { key: 'more', className: '__dk_more' }, h('button', {
           className: '__dk_morebtn', onClick: () => setLimit((v) => v + 30),
         }, '显示更多(还有 ' + (matched.length - shown.length) + ' 条)'))
         : null,
     ])
   }

