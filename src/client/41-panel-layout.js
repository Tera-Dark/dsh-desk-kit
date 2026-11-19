   // ---------------------------------------------------------------- 面板定位
   /**
    * 面板摆哪:一律按**实测**的浮标矩形和视口算,算完再夹进屏幕。
    *
    * 之前踩过的坑:面板是浮标那个 46px 小盒子的绝对定位子元素,一旦宿主把浮层
    * 容器加了 transform / 缩放 / 滚动,「相对谁定位」就跟视口对不上了,表现就是
    * 点开直接甩到屏幕外。现在改成:
    *   1) 优先朝空间大的那一侧开(上下比大小);
    *   2) 横向贴着浮标那一侧展开;
    *   3) 最后不管算出什么,都夹进 [pad, 视口-pad-尺寸] —— 永远不会出屏。
    * @returns {{left:number, top:number, width:number, height:number}}
    */
   function layoutPanel(rect, vw, vh) {
     const pad = 8
     const gap = 10
     const W = Math.max(200, Math.min(344, vw - pad * 2))
     const below = vh - rect.bottom - gap - pad
     const above = rect.top - gap - pad
     const openBelow = below >= above
     const space = Math.max(openBelow ? below : above, 0)
     // 空间够就按内容开,不够就矮一点;连 200 都不到就让它尽量占满,靠夹取兜底
     const H = Math.min(660, vh - pad * 2, Math.max(200, space))
     let y = openBelow ? rect.bottom + gap : rect.top - gap - H
     y = Math.max(pad, Math.min(y, vh - pad - H))
     const fabMid = (rect.left + rect.right) / 2
     let x = fabMid < vw / 2 ? rect.left : rect.right - W
     x = Math.max(pad, Math.min(x, vw - pad - W))
     return { left: Math.round(x), top: Math.round(y), width: Math.round(W), height: Math.round(H) }
   }

   /**
    * 把「屏幕坐标」换算成「宿主给的坐标系里的坐标」。
    *
    * 宿主的浮层容器一旦有 transform / zoom / 缩放,position:fixed 就不再对着视口,
    * 而是对着那个祖先 —— 这正是面板被甩出屏幕的原因。偏移量不用猜:
    * 浮标是我们自己按 (fab.x, fab.y) 摆的,量回来的真实矩形减掉它,差值就是那个祖先的偏移。
    */
   function originOf(rect, pos) {
     const none = { ox: 0, oy: 0, s: 1 }
     if (!rect || !pos) return none
     // 缩放也要算:祖先有 scale 时,fixed 子元素的 left/top 会被按比例缩放
     const w = rect.right - rect.left
     const s = w > 0 ? w / FAB_SIZE : 1
     const scale = Number.isFinite(s) && s > 0.2 && s < 5 ? s : 1
     // 先扣掉缩放再比位移量,得到祖先的原点
     const ox = rect.left - pos.x * scale
     const oy = rect.top - pos.y * scale
     if (!Number.isFinite(ox) || !Number.isFinite(oy)) return none
     if (Math.abs(ox) > 2000 || Math.abs(oy) > 2000) return none
     return { ox, oy, s: scale }
   }
   /**
    * 第三层防线:拿面板**自己**的真实矩形跟视口对一次,算出要挪多少才不出屏。
    * 纯函数,好测;主流程拿到 dx/dy 直接 translate。
    * @returns {{dx:number, dy:number}} 0,0 表示已经在屏幕内
    */
   function nudgeIntoView(rect, vw, vh, pad) {
     const p = pad == null ? 8 : pad
     let dx = 0
     let dy = 0
     if (rect.right > vw - p) dx = vw - p - rect.right
     if (rect.left + dx < p) dx = p - rect.left
     if (rect.bottom > vh - p) dy = vh - p - rect.bottom
     if (rect.top + dy < p) dy = p - rect.top
     return { dx, dy }
   }

   /** 视口坐标 → 祖先坐标系坐标(originOf 的逆运算)。 */
   function toLocal(box, origin) {
     const s = origin && origin.s ? origin.s : 1
     const ox = origin ? origin.ox : 0
     const oy = origin ? origin.oy : 0
     return {
       left: (box.left - ox) / s,
       top: (box.top - oy) / s,
       width: box.width / s,
       height: box.height / s,
     }
   }
   /** 浮标状态位 → 近似矩形(还没量到真实 DOM 时用,比如首帧/SSR)。 */
   function fabRectOf(pos) {
     return { left: pos.x, top: pos.y, right: pos.x + FAB_SIZE, bottom: pos.y + FAB_SIZE }
   }
   function saveFab(pos) {
     try {
       window.localStorage.setItem(LS_FAB, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }))
     } catch { /* 隐私模式写不进去也不影响本次使用 */ }
   }

   function reminderMeta(r) {
     let base
     if (r.lunar) base = '农历每年 ' + r.lunar.month + '月' + r.lunar.day + '日 ' + r.time
     else if (r.annual) base = '公历每年 ' + r.annual + ' ' + r.time
     else if (Number.isFinite(r.monthly)) base = '每月 ' + r.monthly + ' 号 ' + r.time
     else if (r.date) base = r.date + ' ' + r.time
     else base = weekText(r.weekdays) + ' ' + r.time
     if (r.status === 'paused') return base + ' · 已暂停'
     // 一次性提醒过了那天就不该再装成「进行中」:列表里明说已过期
     if (r.status === 'expired') return base + ' · 已过期'
     // 点过「知道了」:今天这条已经处理过,别一直挂着「到点了」
     if (r.status === 'silenced') {
       // 刚登记就发现今天的点已过(下午登记「每天 7:50 吃药」):说清楚从明天开始,别让人以为今天还得补
       return base + (r.startTomorrow ? ' · 今天的点已过,明天开始' : ' · 今天不再提醒')
     }
     if (r.done) return base + ' · 今天已完成'
     if (r.status === 'pending') return base + ' · 到点了'
     if (r.status === 'upcoming') return base + (r.occurrenceAt ? ' · ' + fmtClock(r.occurrenceAt - (r.leadMin || 0) * 60000) + ' 提醒' : '')
     // 「今天不用」放在「接下来」里会读着别扭:直接说下次哪天
     if (r.status === 'not-today') {
       // occurrenceAt 是时间戳,fmtDay 吃 YYYY-MM-DD
       const d = r.occurrenceAt ? new Date(r.occurrenceAt) : null
       const ymd = d && !isNaN(d.getTime())
         ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
         : ''
       return base + (ymd ? ' · 下次 ' + fmtDay(ymd) : ' · 今天不用')
     }
     return base
   }

