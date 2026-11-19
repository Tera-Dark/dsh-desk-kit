   // ---------------------------------------------------------------- 反馈条
   /**
    * 统一反馈条:一句结果 + 一个「撤销」(可选)。
    * 人改错东西的第一反应是「刚才那下能撤吗」,而不是去垃圾箱里翻。
    */
   // 自动分类分错了,一条记录换到别的分类
   const MOVE_TARGETS = {
     note: [['link', '网页'], ['secret', '保险库'], ['reminder', '提醒']],
     link: [['note', '便签'], ['secret', '保险库'], ['reminder', '提醒']],
     secret: [['link', '网页'], ['note', '便签']],
     reminder: [['note', '便签'], ['link', '网页']],
   }

   /**
    * 「分错了?转存到:网页 / 便签 / 保险库」。
    * 便签/网页/提醒转走后原条目进垃圾箱;保险库带密码时会被拦下(明文存不得)。
    */
   function MoveChips({ kind, id, run, notify, label }) {
     const targets = MOVE_TARGETS[kind] || []
     if (!targets.length) return null
     return h('div', { className: '__dk_groupchips __dk_movechips' }, [
       h('span', { key: 'l', className: '__dk_hint' }, label || '转存到'),
       ...targets.map(([to, name]) => h('button', {
         key: to, className: '__dk_chip',
         onClick: async () => {
           const body = await run('item.convert', { kind, id, to })
           if (!body || body.ok === false) return
           if (notify) notify((body.result && body.result.reply) || ('已转到' + name))
         },
       }, name)),
     ])
   }

   function ReplyBar({ reply, run, onClear, onSay, onGo }) {
     if (!reply) return null
     const text = typeof reply === 'string' ? reply : reply.text
     const undo = reply && typeof reply === 'object' ? reply.undo : null
     const move = reply && typeof reply === 'object' ? reply.move : null
     const goPage = reply && typeof reply === 'object' ? reply.goPage : ''
     const label = reply && typeof reply === 'object' ? reply.label : ''
     const title = reply && typeof reply === 'object' ? reply.title : ''
     const tone = (reply && typeof reply === 'object' && reply.tone) || 'ok'
     const life = reply && reply.life ? (reply.life / 1000) + 's' : '4.2s'
     return h('div', {
       className: '__dk_toast __dk_toast--' + tone + (reply && reply.leaving ? ' __dk_toast--out' : ''),
       role: 'status', 'aria-live': 'polite',
     }, [
       h('div', { key: 'ic', className: '__dk_toasticon' }, tone === 'err' ? '!' : '✓'),
       h('div', { key: 'm', className: '__dk_toastmain' }, [
         h('div', { key: 'h', className: '__dk_toasthead' }, [
           label ? h('span', { key: 'b', className: '__dk_toastbadge' }, label) : null,
           h('span', { key: 's', className: '__dk_toaststatus' }, tone === 'err' ? '保存失败' : '已保存'),
         ]),
         title ? h('div', { key: 't', className: '__dk_toasttitle' }, title) : null,
         text ? h('div', { key: 'd', className: '__dk_toasttext __dk_replytext' }, text) : null,
         move ? h('div', { key: 'mv', className: '__dk_toastmove' },
           h(MoveChips, { kind: move.kind, id: move.id, run, notify: onSay, label: '分错了?转存到' })) : null,
         undo ? h('div', { key: 'a', className: '__dk_toastacts' }, [
           // 存完默认留在原地:要去对应分类看,点这里。
           goPage && onGo ? h('button', {
             key: 'g', className: '__dk_replybtn __dk_replybtn--go',
             onClick: () => { onGo(goPage); if (onClear) onClear() },
           }, '去看看') : null,
           h('button', {
             key: 'u', className: '__dk_replybtn', title: '撤销刚才那一步',
             onClick: async () => {
               await run(undo.action, undo.payload)
               if (typeof undo.after === 'function') undo.after()
               if (onClear) onClear()
             },
           }, '撤销'),
         ]) : (goPage && onGo ? h('div', { key: 'a', className: '__dk_toastacts' }, [
           h('button', {
             key: 'g', className: '__dk_replybtn __dk_replybtn--go',
             onClick: () => { onGo(goPage); if (onClear) onClear() },
           }, '去看看'),
         ]) : null),
       ]),
       h('button', {
         key: 'x', className: '__dk_toastx', title: '关闭', 'aria-label': '关闭提示',
         onClick: () => { if (onClear) onClear() },
       }, '×'),
       h('i', { key: 'life', className: '__dk_toastlife', style: { '--dk-toast-life': life } }),
     ])
   }

   /** 回执下的第二行:存错分类了,直接挪。 */
   function ReplyMove({ reply, run, onSay }) {
     const move = reply && typeof reply === 'object' ? reply.move : null
     if (!move || !move.id) return null
     return h(MoveChips, { kind: move.kind, id: move.id, run, notify: onSay, label: '分错了?转存到' })
   }

