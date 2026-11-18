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

   function VaultPage({ state, run, notify, focus }) {
     const [moving, setMoving] = useState('')
     const [openAdd, setOpenAdd] = useState(false)
     const [title, setTitle] = useState('')
     const [body, setBody] = useState('')
     const [revealed, setRevealed] = useState({})
     const [editing, setEditing] = useState(null)   // { id, title, body }
     const [draftFiles, setDraftFiles] = useState([])
     const [viewing, setViewing] = useState(null)
     const filePicker = useRef(null)
     const timers = useRef({})
     const secrets = state.secrets || []
     const say = (text, undo) => { if (notify) notify(text, undo) }

     // 页面关掉/切走时把计时器全清掉,别在卸载之后还去 setState
     useEffect(() => () => {
       for (const t of Object.values(timers.current)) clearTimeout(t)
       timers.current = {}
     }, [])

     // 不逼用户拆字段:想怎么记就怎么记,整段加密
     const add = async () => {
       if (!title.trim() && !draftFiles.length) return
       await run('secret.add', { title: title.trim() || '未命名条目', body, files: draftFiles.map((f) => f.id) })
       setTitle(''); setBody(''); setDraftFiles([]); setOpenAdd(false)
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
       } catch (e) { say('没存上:' + String((e && e.message) || e)) }
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

     return h(React.Fragment, null, [
       h(Lightbox, { key: 'light', file: viewing, onClose: () => setViewing(null) }),
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => setOpenAdd((v) => !v) }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), openAdd ? ' 收起' : ' 新条目']),
         h('button', {
           key: 'af', className: '__dk_btn', title: '给新条目加附件(截图/文件,和正文一起加密)',
           onClick: () => { setOpenAdd(true); setTimeout(() => filePicker.current && filePicker.current.click(), 30) },
         }, [h(Ico, { key: 'i', name: 'image', size: 13 }), ' 附件']),
         h('span', { key: 'h', className: '__dk_hint' }, '共 ' + secrets.length + ' 条 · AES-256-GCM'),
       ]),
       editing ? h('div', { key: 'edit', className: '__dk_form' }, [
         h('div', { key: 'g', className: '__dk_group' }, [
           h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '编辑条目'), h('span', { key: 'b' }, '保存后重新加密')]),
           h('input', {
             key: 't', className: '__dk_input', autoFocus: true,
             value: editing.title,
             onChange: (e) => setEditing((cur) => ({ ...cur, title: e.target.value })),
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
               await run('secret.update', { query: editing.id, title: editing.title.trim(), body: editing.body })
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
       secrets.length
         ? secrets.map((s) => h('div', { key: s.id, className: '__dk_item', 'data-dk-secret': s.id }, [
           h('div', { key: 't', className: '__dk_itop' }, [
             h('div', { key: 'x', className: '__dk_itext __dk_lockrow' }, [h(Ico, { key: 'i', name: 'lock', size: 14 }), s.title]),
             h('button', {
               key: 'v', className: '__dk_mini', title: revealed[s.id] ? '收起' : '显示内容',
               style: { width: 'auto', padding: '0 8px' },
               onClick: () => reveal(s.id),
             }, revealed[s.id] ? '收起' : '显示'),
             h('div', { key: 'act', className: '__dk_iact' }, [
               h('button', { key: 'mv', className: '__dk_mini', title: '转存到别的分类', 'aria-label': '转存到别的分类', onClick: () => setMoving(moving === s.id ? '' : s.id) }, h(Ico, { name: 'swap', size: 14 })),
               h('button', {
                 key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑',
                 onClick: async () => {
                   const full = await run('secret.get', { query: s.id })
                   if (!full || !full.result) return
                   hide(s.id)
                   setEditing({ id: s.id, title: s.title, body: secretText(full.result) })
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
             revealed[s.id] ? h('span', { key: 't' }, '30 秒后自动收起') : null,
           ]),
           moving === s.id ? h(MoveChips, { key: 'mv', kind: 'secret', id: s.id, run, notify: (t) => { setMoving(''); say(t) } }) : null,
         ]))
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, '保险库是空的'),
           h('div', { key: 'h', className: '__dk_note' }, '点「新条目」把账号密码、备用码整段贴进去,本地加密,不联网。'),
         ]),
     ])
   }

