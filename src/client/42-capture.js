   // ---------------------------------------------------------------- 一句话
   const CAPTURE_MAX_H = 168   // 约 7 行,再多就自己滚

   /** 一句话输入:多行自适应。内容多就长高,到上限后内部滚动。 */
   function CaptureBar({ run, onDone, seed, onSeedUsed }) {
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

