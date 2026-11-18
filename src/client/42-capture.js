   // ---------------------------------------------------------------- 一句话
   const CAPTURE_MAX_H = 168   // 约 7 行,再多就自己滚

   // 存完那条提示要让人一眼看清「进了哪个栏位」,而不只是「已保存」。
   const CAPTURE_LABEL = { note: '便签', reminder: '提醒', link: '网页', secret: '保险库', multi: '提醒' }
   function captureToast(r) {
     const parsed = (r && r.parsed) || {}
     const kind = parsed.kind || 'note'
     const item = r && r.item
     const label = CAPTURE_LABEL[kind] || '随手台'
     let title = ''
     if (Array.isArray(item)) title = item.length + ' 条提醒'
     else if (item) {
       title = kind === 'note'
         ? String(item.text || '').split('\n')[0].trim().slice(0, 44)
         : String(item.title || '').trim()
     }
     if (!title) title = kind === 'note' ? '图片便签' : label
     let detail = String((r && r.reply) || '已保存')
     // 标题已经在上面大字显示了,详情里别原样再抄一遍
     if (title && detail.includes(title)) {
       detail = detail.replace(title, '').replace(/^[^:：]*[:：]\s*/, '').replace(/^[·,，;；\s]+/, '').trim()
     }
     if (!detail) detail = kind === 'note' ? '已收进便签' : '已保存'
     return { label, title, detail, tone: kind === 'multi' ? 'reminder' : kind }
   }

   /** 一句话输入:多行自适应。内容多就长高,到上限后内部滚动。 */
   function CaptureBar({ run, onDone, onFail, seed, onSeedUsed }) {
     const [text, setText] = useState(seed || '')
     const [busy, setBusy] = useState(false)
     const ref = useRef(null)
     // 中文/日文输入法正在选词时按 Enter 只是「确认候选词」,不是「发送」。
     // 不看这两个标记的话,打「明天」会被直接提交成半句话 —— 中文环境下最疼的一个坑。
     const composing = useRef(false)

     // textarea 不会自己长高,每次内容变化按 scrollHeight 重算
     const resize = useCallback(() => {
       const el = ref.current
       if (!el) return
       el.style.height = 'auto'
       const h2 = Math.min(el.scrollHeight, CAPTURE_MAX_H)
       el.style.height = h2 + 'px'
       el.style.overflowY = el.scrollHeight > CAPTURE_MAX_H ? 'auto' : 'hidden'
     }, [])
     useEffect(() => { resize() }, [text, resize])
     // 撤销「存错类别」时把原话塞回输入框,接着改说法重说一遍
     useEffect(() => {
       if (!seed) return
       setText(seed)
       if (onSeedUsed) onSeedUsed()
       if (ref.current) { try { ref.current.focus() } catch { /* 老浏览器 */ } }
     }, [seed, onSeedUsed])

     const submit = async () => {
       const v = text.trim()
       if (!v || busy) return
       setBusy(true)
       try {
         const body = await run('capture', { text: v })
         if (body && body.result) { setText(''); if (onDone) onDone(body.result) }
         else if (onFail) onFail()
       } finally { setBusy(false); if (ref.current) ref.current.focus() }
     }

     return h('div', { className: '__dk_capture' }, [
       h('textarea', {
         key: 'i', ref: ref, rows: 1, className: '__dk_input __dk_grow', autoFocus: true,
         placeholder: '说一句:10分钟后提醒我关火 / 明天10点交电费 / 把这段存起来\n(Shift+Enter 换行)',
         value: text,
         onChange: (e) => setText(e.target.value),
         onCompositionStart: () => { composing.current = true },
         onCompositionEnd: () => { composing.current = false },
         onKeyDown: (e) => {
           if (e.key !== 'Enter') return
           // 输入法选词中:交给输入法,别抢
           if (composing.current || (e.nativeEvent && e.nativeEvent.isComposing) || e.keyCode === 229) return
           // Shift/Ctrl + Enter 换行
           if (e.shiftKey || e.ctrlKey || e.metaKey) return
           e.preventDefault()
           submit()
         },
       }),
       h('button', { key: 'b', className: '__dk_send', title: '存(Enter)', disabled: busy || !text.trim(), onClick: submit }, h(Ico, { name: 'send', size: 17 })),
     ])
   }

