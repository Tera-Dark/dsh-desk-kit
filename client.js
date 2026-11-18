/**
* dsh-desk-kit · 浏览器半侧(0.5)
*
* 手机式操作:底部一排分类栏,中间是圆形首页键;切页左右滑屏动画;
* 全部图标为内联黑白 SVG(不用 emoji)。数据仍走 /desk-kit-api。
*/
window.__ModuleLoader__.load({
 id: 'dsh-desk-kit',
 factory: (require) => {
   const module = { exports: {} }
   const exports = module.exports
   Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

   const React = require('react')
   const h = React.createElement
   const { useState, useEffect, useCallback, useRef } = React

   const API = '/desk-kit-api'

   /**
    * 面板轮询。页面藏起来(切到别的标签/窗口最小化)时,20 秒拉一次全量快照纯属浪费 ——
    * 300 条便签的快照快 90KB。可见 20 秒,不可见 60 秒,切回来立刻补一次。
    */
   function usePoll(load, activeMs = 20000, idleMs = 60000) {
     useEffect(() => {
       let timer = null
       let stopped = false
       const visible = () => !(typeof document !== 'undefined' && document && document.hidden)
       const schedule = () => {
         if (stopped) return
         if (timer) clearTimeout(timer)
         timer = setTimeout(async () => {
           if (stopped) return
           if (visible()) { try { await load() } catch { /* 由 load 自己记错误 */ } }
           schedule()
         }, visible() ? activeMs : idleMs)
       }
       if (visible()) load()
       schedule()
       const onVis = () => { if (visible()) load(); schedule() }
       try { document.addEventListener('visibilitychange', onVis) } catch { /* SSR */ }
       return () => {
         stopped = true
         if (timer) clearTimeout(timer)
         try { document.removeEventListener('visibilitychange', onVis) } catch { /* SSR */ }
       }
     }, [load, activeMs, idleMs])
   }
   // 浮标:尺寸、贴边间距、位置存档键
   const FAB_SIZE = 46
   const FAB_PAD = 18
   const LS_FAB = 'desk-kit.fab'
   const WEEK = ['日', '一', '二', '三', '四', '五', '六']
   const VERSION = '1.10.0'
   // 和底部导航同序:提醒 便签 [首页] 网页 保险库,设置在最右(滑动可到)
   const ORDER = ['reminders', 'notes', 'home', 'links', 'vault', 'settings']
   // 侧栏页面顶部分类条用(和浮标里的底部导航是同一批页面,只是横排)
   const SIDEBAR_ORDER = ['home', 'links', 'reminders', 'notes', 'vault', 'settings']
   const PANEL_LABELS = { home: '首页', links: '网页', reminders: '提醒', notes: '便签', vault: '保险库', settings: '设置' }
   const PANEL_ICONS = { home: 'home', links: 'grid', reminders: 'bell', notes: 'note', vault: 'lock', settings: 'gear' }

   // ---------------------------------------------------------------- 图标(Lucide 风格, stroke)
   const PATHS = {
     bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
     note: ['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 12h7', 'M9 16h5'],
     home: ['M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'],
     lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 1 1 6 0v3'],
     gear: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
     link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
     copy: ['M9 9h10v10H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
     edit: ['M4 20h4L19 9a2 2 0 0 0-3-3L5 17z'],
     x: ['M6 6l12 12', 'M18 6L6 18'],
     pin: ['M12 17v5', 'M9 3h6l-1 6 3 3v2H7v-2l3-3z'],
     check: ['M4 12l5 5L20 6'],
     clipboard: ['M9 4h6v3H9z', 'M8 5H6v16h12V5h-2'],
     plus: ['M12 5v14', 'M5 12h14'],
     send: ['M12 19V5', 'M5 12l7-7 7 7'],
     chevronLeft: ['M15 5l-7 7 7 7'],
     undo: ['M9 14L4 9l5-5', 'M4 9h9a7 7 0 0 1 0 14H8'],
     trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
     clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7v5l3.5 2'],
     swap: ['M4 8h13', 'M14 5l3 3-3 3', 'M20 16H7', 'M10 19l-3-3 3-3'],
     pause: ['M9 5v14', 'M15 5v14'],
     play: ['M8 5l11 7-11 7z'],
     download: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 20h14'],
     grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
     globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3'],
   }
   function Ico({ name, size, className }) {
     const paths = PATHS[name] || []
     return h('svg', {
       className, width: size || 20, height: size || 20, viewBox: '0 0 24 24', fill: 'none',
       stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
       'aria-hidden': 'true',
     }, paths.map((d, i) => h('path', { key: i, d })))
   }

   /**
    * 到点提示音。
    * 两声上行(A5 → E6)加 6ms 起音、0.55s 指数衰减,低通 6.2kHz 削掉数字味 ——
    * 走路听见会回头,戴耳机不炸耳。用 Web Audio 现场合成,不打包 mp3:
    * 体积为零、没有版权问题、音量随系统走。
    */
   const SOUND = { notes: [880, 1318.51], gap: 0.10, attack: 0.006, decay: 0.55, gain: 0.08, cutoff: 6200 }
   let audioCtx = null

   function playChime() {
     try {
       const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
       if (!AC) return false
       if (!audioCtx) audioCtx = new AC()
       // 浏览器要一次用户手势才允许出声;点过面板之后就一直可用
       if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') audioCtx.resume()
       const t0 = audioCtx.currentTime + 0.01
       const filter = audioCtx.createBiquadFilter()
       filter.type = 'lowpass'
       filter.frequency.value = SOUND.cutoff
       filter.connect(audioCtx.destination)
       SOUND.notes.forEach((freq, i) => {
         const start = t0 + i * SOUND.gap
         const osc = audioCtx.createOscillator()
         const gain = audioCtx.createGain()
         osc.type = 'triangle'          // 三角波:比正弦有存在感,比锯齿干净
         osc.frequency.value = freq
         gain.gain.setValueAtTime(0.0001, start)
         gain.gain.exponentialRampToValueAtTime(SOUND.gain, start + SOUND.attack)
         gain.gain.exponentialRampToValueAtTime(0.0001, start + SOUND.decay)
         osc.connect(gain)
         gain.connect(filter)
         osc.start(start)
         osc.stop(start + SOUND.decay + 0.02)
       })
       return true
     } catch { return false }
   }

   /**
    * 新告警出现时响一声。
    * 只在「多出来一条」时响:打开面板时已经躺在列表里的旧提醒不吵人;
    * 一次轮询回来三条也只响一下。
    */
   function useAlertSound(settings, alerts) {
     const heard = useRef('')
     useEffect(() => {
       const key = (alerts || []).map((a) => a.id).join(',')
       if (!key) { heard.current = ''; return }
       if (heard.current === key) return
       const first = heard.current === ''
       heard.current = key
       const st0 = settings || {}
       if (first) {
         // 打开面板时旧提醒一般不吵;但「DSH 关着时错过的」要响一声,否则等于没提醒
         if ((alerts || []).some((a) => a.late) && !st0.muted && st0.sound !== false) playChime()
         return
       }
       const st = settings || {}
       if (st.muted || st.sound === false) return
       playChime()
     }, [settings, alerts])
   }

   const CSS = [
     '@keyframes __dkSlideL{from{transform:translateX(26px);opacity:0}to{transform:translateX(0);opacity:1}}',
     '@keyframes __dkSlideR{from{transform:translateX(-26px);opacity:0}to{transform:translateX(0);opacity:1}}',
     '@keyframes __dkAlertIn{from{opacity:0;transform:translate3d(20px,12px,0) scale(.97)}to{opacity:1;transform:none}}',
     '@keyframes __dkAlertOut{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(26px,-8px,0) scale(.96)}}',
     '.__dk_sp{display:flex;flex-direction:column;height:100%;min-height:0;font:13px/1.55 system-ui,"Segoe UI",sans-serif;background:var(--dsw-alias-bg-layer-1,#1c1f24);color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_sphead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px 6px;flex:none}',
     '.__dk_sptitle{font-size:15px;font-weight:600;letter-spacing:.02em;display:flex;align-items:center;gap:8px}',
     '.__dk_spnav{display:flex;gap:6px;padding:4px 14px 8px;flex:none;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_spbody{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 16px 18px;position:relative}',
     '.__dk_stab{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);border-radius:9px;padding:5px 10px;font-size:12.5px;line-height:1.4;font-family:inherit;cursor:pointer;flex:none}',
     '.__dk_stab:hover{background:var(--dsw-alias-bg-layer-2,#24282e);color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_stab.on{background:var(--dsw-alias-bg-layer-2,#24282e);color:var(--dsw-alias-brand-primary,#4d7cf3);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 45%,transparent)}',
     '.__dk_note{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);line-height:1.6}',
     '.__dk_spdot{display:inline-block;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5484d;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:600}',
     '.__dk_spbody .__dk_page{max-width:960px;margin:0 auto}',
     '.__dk_spacer{flex:1}',
     '.__dk_area{resize:vertical;font-family:inherit;line-height:1.6}',
     '.__dk_lockrow{display:flex;gap:7px;align-items:center}',
     '.__dk_root{position:fixed;z-index:2147482000;width:46px;height:46px;font:13px/1.55 system-ui,"Segoe UI",sans-serif}',
     '.__dk_fab{position:relative;width:46px;height:46px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-1,#1c1f24);color:var(--dsw-alias-label-primary,#e6edf3);box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:grab;display:flex;align-items:center;justify-content:center;transition:transform .14s;touch-action:none;user-select:none;-webkit-user-select:none}',
     '.__dk_fab:hover{transform:scale(1.06)}',
     '.__dk_fab.__dk_dragging{cursor:grabbing;transform:none}',
     '.__dk_badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5484d;color:#fff;font-size:10px;line-height:18px;text-align:center;font-weight:600}',
     '.__dk_panel{position:fixed;box-sizing:border-box;max-width:calc(100vw - 16px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#1c1f24);color:var(--dsw-alias-label-primary,#e6edf3);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:16px;box-shadow:0 20px 56px rgba(0,0,0,.42);overflow:hidden}',
     '.__dk_head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 6px;flex:none}',
     '.__dk_title{font-size:13.5px;font-weight:600;letter-spacing:.02em}',
     '.__dk_icobtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);cursor:pointer;padding:4px;border-radius:7px;display:flex}',
     '.__dk_icobtn:hover{background:var(--dsw-alias-bg-layer-2,#24282e);color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_body{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 14px 8px;position:relative}',
     '.__dk_page{animation-duration:.2s;animation-timing-function:cubic-bezier(.22,.6,.36,1);animation-fill-mode:both}',
     '.__dk_page--left{animation-name:__dkSlideL}',
     '.__dk_page--right{animation-name:__dkSlideR}',
     '.__dk_capture{display:flex;gap:6px;align-items:flex-end;padding:2px 0 10px}',
     '.__dk_input{width:100%;box-sizing:border-box;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 85%,transparent);color:var(--dsw-alias-label-primary,#e6edf3);border:1px solid transparent;border-radius:10px;padding:8px 11px;font-size:12.5px;line-height:1.55;font-family:inherit;outline:none;transition:border-color .15s,background .15s}',
     '.__dk_input:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 65%,transparent);background:var(--dsw-alias-bg-layer-1,#1c1f24)}',
     '.__dk_capture .__dk_input{flex:1}',
     '.__dk_grow{resize:none;overflow-y:hidden;min-height:34px;max-height:168px;line-height:1.5;padding:8px 10px;font-family:inherit}',
     '.__dk_send{flex:none;width:34px;height:34px;border-radius:10px;border:none;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 88%,#000);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}',
     '.__dk_send:disabled{opacity:.4;cursor:default}',
     '.__dk_reply{margin:0 auto 10px;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 11%,transparent);color:var(--dsw-alias-brand-primary,#4d7cf3);font-size:12px;max-width:960px}',
     '.__dk_sec{display:flex;align-items:center;justify-content:space-between;margin:16px auto 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa4b2);letter-spacing:.06em;gap:7px;max-width:960px;font-weight:600;text-transform:none}',
     '.__dk_row{display:flex;align-items:center;gap:9px;padding:9px 10px;border-bottom:none;border-radius:11px;transition:background .15s}',
     '.__dk_row:last-child{border-bottom:none}',
     '.__dk_check{flex:none;width:19px;height:19px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
     '.__dk_check.on{background:#3fb950;border-color:#3fb950}',
     '.__dk_check:not(.on):hover{border-color:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_rowmain{flex:1;min-width:0}',
     '.__dk_rt{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
     '.__dk_rm{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa4b2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
     '.__dk_done .__dk_rt{text-decoration:line-through;opacity:.5}',
     '.__dk_go{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary,#4d7cf3);text-decoration:none;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 45%,transparent);border-radius:7px;padding:3px 8px;white-space:nowrap}',
     '.__dk_mini{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);cursor:pointer;padding:0;display:inline-flex;border-radius:8px;width:26px;height:26px;align-items:center;justify-content:center;transition:color .15s,background .15s}',
     '.__dk_mini:hover{color:var(--dsw-alias-label-primary,#e6edf3);background:var(--dsw-alias-bg-layer-2,#24282e)}',
     '.__dk_empty{color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:12px;padding:26px 12px;text-align:center;border:1px dashed var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:12px;margin:10px 0;line-height:1.7}',
     '.__dk_item{padding:10px 10px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border:1px solid transparent;border-radius:11px;transition:background .15s,border-color .15s}',
     '.__dk_item:last-child{border-bottom:none}',
     '.__dk_itop{display:flex;align-items:flex-start;gap:8px}',
     '.__dk_itext{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;font-size:12.5px}',
     '.__dk_imeta{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b949e);margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
     '.__dk_tag{font-size:10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:999px;padding:0 6px;color:var(--dsw-alias-label-secondary,#9aa4b2)}',
     '.__dk_fields{display:flex;flex-direction:column;gap:3px;margin-top:6px}',
     '.__dk_field{display:flex;align-items:baseline;gap:8px;justify-content:space-between;background:var(--dsw-alias-bg-layer-2,#24282e);border-radius:7px;padding:4px 8px}',
     '.__dk_field .k{color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:10.5px;flex:none}',
     '.__dk_field .v{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all;text-align:right}',
     '.__dk_form{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 70%,transparent);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:9px;margin:0 auto 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));max-width:960px}',
     '.__dk_form .__dk_input{background:var(--dsw-alias-bg-layer-1,#1c1f24)}',
     '.__dk_frow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
     '.__dk_frow .__dk_input{flex:1;min-width:92px;width:auto}',
     '.__dk_btn{border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,rgba(255,255,255,.18)) 80%,transparent);background:transparent;color:var(--dsw-alias-label-primary,#e6edf3);border-radius:9px;padding:0 11px;font-size:11.5px;cursor:pointer;font-size:12px;line-height:1;font-family:inherit;height:28px;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}',
     '.__dk_btn:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 80%,transparent)}',
     '.__dk_btn.p{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 88%,#000);border-color:transparent;color:#fff;font-weight:600}',
     '.__dk_btn:disabled{opacity:.42;cursor:default}',
     '.__dk_days{display:flex;gap:4px;flex-wrap:wrap}',
     '.__dk_day{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);border-radius:6px;width:24px;height:24px;font-size:11px;cursor:pointer;font-family:inherit;padding:0}',
     '.__dk_day.on{background:var(--dsw-alias-brand-primary,#4d7cf3);border-color:var(--dsw-alias-brand-primary,#4d7cf3);color:#fff}',
     '.__dk_hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);line-height:1.6;word-break:break-word}',
     '.__dk_setrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));font-size:12.5px;margin-bottom:6px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 45%,transparent)}',
     '.__dk_setrow:last-child{border-bottom:none}',
     '.__dk_switch{width:36px;height:20px;border-radius:999px;border:none;background:var(--dsw-alias-border-l1,rgba(255,255,255,.10));cursor:pointer;position:relative;transition:background .15s;flex:none}',
     '.__dk_switch.on{background:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}',
     '.__dk_switch.on::after{transform:translateX(16px)}',
     '.__dk_err{color:#e5484d;font-size:12px;padding:8px 12px;border-radius:10px;margin:0 auto 10px;max-width:960px;background:color-mix(in srgb,#e5484d 11%,transparent)}',
     '.__dk_tabbar{flex:none;display:flex;align-items:flex-end;justify-content:space-around;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));padding:4px 2px 6px;background:var(--dsw-alias-bg-layer-1,#1c1f24)}',
     '.__dk_tab{display:flex;flex-direction:column;align-items:center;gap:1px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:10px;line-height:1.4;font-family:inherit;cursor:pointer;width:58px;padding:4px 0;border-radius:9px}',
     '.__dk_tab:hover{color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_tab.on{color:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_tabhome{width:46px;height:46px;border-radius:50%;border:none;background:var(--dsw-alias-brand-primary,#4d7cf3);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-top:-20px;box-shadow:0 6px 18px rgba(0,0,0,.3);position:relative;transition:transform .14s}',
     '.__dk_tabhome:hover{transform:translateY(-1px)}',
     '.__dk_tabhome .__dk_dot{position:absolute;top:-1px;right:-1px;min-width:14px;height:14px;border-radius:7px;background:#e5484d;color:#fff;font-size:9px;line-height:14px;text-align:center;padding:0 3px}',
     '.__dk_sec--act::before{content:"";width:5px;height:5px;border-radius:50%;background:#e5484d;display:inline-block;margin-right:6px;vertical-align:middle}',
     '.__dk_row--act .__dk_rt{font-weight:600}',
     '.__dk_row--act .__dk_check{border-color:#e5484d}',
     '.__dk_sec--ref{color:var(--dsw-alias-label-tertiary,#8b949e);font-weight:400}',
     '.__dk_item--ref .__dk_itext{opacity:.82}',
     '.__dk_item--dim .__dk_itext,.__dk_item--dim .__dk_imeta{opacity:.55}',
     // 网页格子(手机桌面那种)
     '.__dk_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:14px 6px;padding:6px 2px 14px}',
     '.__dk_tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px}',
     '.__dk_app{position:relative;width:54px;height:54px;border-radius:15px;border:none;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28);transition:transform .12s,box-shadow .12s;overflow:hidden}',
     '.__dk_app:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.32)}',
     '.__dk_app:active{transform:scale(.96)}',
     '.__dk_appchar{font-size:19px;font-weight:600;letter-spacing:.5px}',
     '.__dk_appimg{width:26px;height:26px;border-radius:5px;object-fit:contain;background:transparent}',
     '.__dk_apppin{position:absolute;top:3px;right:4px;font-size:9px;opacity:.9}',
     '.__dk_appname{max-width:78px;font-size:11.5px;line-height:1.32;text-align:center;color:var(--dsw-alias-label-primary,#e6edf3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
     '.__dk_appact{position:absolute;top:-7px;right:-4px;display:flex;gap:2px;opacity:0;transition:opacity .12s}',
     '.__dk_tile:hover .__dk_appact,.__dk_tile:focus-within .__dk_appact{opacity:1}',
     '.__dk_appact .__dk_mini{width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#24282e);box-shadow:0 1px 4px rgba(0,0,0,.3)}',
     '.__dk_groupchips{display:flex;gap:6px;flex-wrap:wrap;padding:2px 0 6px}',
     '.__dk_movechips{align-items:center;padding:4px 2px 6px}',
     '.__dk_card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02));font-size:13px;line-height:1.6}',
     '.__dk_cardtop{display:flex;align-items:baseline;gap:8px}',
     '.__dk_cardtitle{font-weight:600;font-size:13.5px}',
     '.__dk_cardcounts{display:flex;gap:16px;flex-wrap:wrap}',
     '.__dk_cardcount{display:flex;align-items:baseline;gap:4px;color:var(--dsw-alias-label-secondary,#9aa4b2)}',
     '.__dk_cardcount b{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_cardcount span{font-size:11.5px}',
     '.__dk_cardrows{display:flex;flex-direction:column;gap:6px}',
     '.__dk_cardrow{display:flex;align-items:center;justify-content:space-between;gap:10px}',
     '.__dk_cardkbd{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8b949e)}',
     '.__dk_appnote{max-width:78px;font-size:10.5px;line-height:1.3;color:var(--dsw-alias-label-tertiary,#8b949e);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
     '.__dk_grid--home{grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:10px 4px;padding:2px 0 10px}',
     '.__dk_grid--home .__dk_app{width:48px;height:48px;border-radius:14px}',
     '.__dk_grid--home .__dk_appname{max-width:68px;font-size:11px}',
     '.__dk_linkbtn{border:none;background:transparent;color:var(--dsw-alias-brand-primary,#4d7cf3);font:inherit;font-size:11.5px;cursor:pointer;padding:0}',
     '.__dk_headact{display:flex;align-items:center;gap:2px}',
     '.__dk_icobtn.on{color:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_dotsep{display:inline-block;width:8px;height:8px;margin:0 12px 0 8px;border-radius:50%;background:var(--dsw-alias-border-l1,rgba(255,255,255,.25));flex:none}',
     '.__dk_row--act .__dk_rt{font-weight:600}',
     '.__dk_row--act .__dk_dotsep{background:#e5484d}',
     '.__dk_row--dim .__dk_rt,.__dk_row--dim .__dk_rm{opacity:.6}',
     '.__dk_row--dim .__dk_dotsep{background:var(--dsw-alias-border-l1,rgba(255,255,255,.2))}',
     '.__dk_lvl{display:inline-flex;align-items:center;gap:4px;margin-left:7px;padding:0 6px;height:16px;border-radius:8px;font-size:9.5px;font-weight:600;letter-spacing:.04em;border:1px solid currentColor;opacity:.85;vertical-align:1px}',
     '.__dk_lvl i{width:5px;height:5px;border-radius:50%;background:currentColor;display:block}',
     '.__dk_hbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);cursor:pointer}',
     '.__dk_hbtn:hover{background:var(--dsw-alias-bg-layer-2,#24282e);color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_hdot{position:absolute;top:-1px;right:-1px;min-width:14px;height:14px;border-radius:7px;background:#e5484d;color:#fff;font:600 9px/14px system-ui,sans-serif;text-align:center;padding:0 3px}',
     '.__dk_dock{position:fixed;right:20px;bottom:22px;z-index:2147483001;display:flex;flex-direction:column;gap:10px;width:322px;max-width:calc(100vw - 32px);pointer-events:none}',
     '.__dk_alert{pointer-events:auto;position:relative;display:flex;flex-direction:column;gap:9px;padding:12px 13px 11px 15px;border-radius:14px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,rgba(255,255,255,.18)) 75%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#1c1f24) 94%,transparent);backdrop-filter:blur(14px) saturate(1.15);-webkit-backdrop-filter:blur(14px) saturate(1.15);box-shadow:0 16px 40px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.14);color:var(--dsw-alias-label-primary,#e6edf3);font:12px/1.55 system-ui,"Segoe UI",sans-serif;overflow:hidden;animation:__dkAlertIn .34s cubic-bezier(.22,.68,.36,1) both}',
     '.__dk_alert::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#f2727a,#e5484d 50%,#c8373d)}',
     '.__dk_alert--calm::before{background:linear-gradient(180deg,#7fb0ff,#4d7cf3 50%,#3a63d0)}',
     '.__dk_alert--out{animation:__dkAlertOut .3s ease forwards}',
     '.__dk_ahead{display:flex;align-items:flex-start;gap:9px}',
     '.__dk_aicon{flex:none;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,#e5484d 14%,transparent);color:#e5484d;margin-top:1px}',
     '.__dk_alert--calm .__dk_aicon{background:color-mix(in srgb,#4d7cf3 14%,transparent);color:#4d7cf3}',
     '.__dk_amain{flex:1;min-width:0}',
     '.__dk_atitle{font-weight:600;font-size:12.5px;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
     '.__dk_ameta{color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
     '.__dk_ax{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);cursor:pointer;padding:2px;border-radius:6px;display:flex;transition:color .15s,background .15s}',
     '.__dk_ax:hover{color:var(--dsw-alias-label-primary,#e6edf3);background:var(--dsw-alias-bg-layer-2,#24282e)}',
     '.__dk_trow{display:flex;gap:6px}',
     '.__dk_tbtn{flex:1;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,rgba(255,255,255,.18)) 70%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 60%,transparent);color:var(--dsw-alias-label-primary,#e6edf3);border-radius:9px;padding:6px 8px;font-size:11.5px;line-height:1.35;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s}',
     '.__dk_tbtn:hover{background:var(--dsw-alias-bg-layer-2,#24282e);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.18))}',
     '.__dk_tbtn.p{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 86%,#000);border-color:transparent;color:#fff;font-weight:600}',
     '.__dk_tbtn.p:hover{filter:brightness(1.06)}',
     '.__dk_dockmore{pointer-events:auto;align-self:flex-end;border:none;background:transparent;cursor:pointer;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b949e);padding:2px 4px;border-radius:6px}',
     '.__dk_dockmore:hover{color:var(--dsw-alias-label-primary,#e6edf3);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 70%,transparent)}',
     '.__dk_inline{display:flex;align-items:center;gap:9px;padding:9px 11px;margin:0 auto 8px;max-width:960px;border-radius:11px;border:1px solid color-mix(in srgb,#e5484d 26%,transparent);background:color-mix(in srgb,#e5484d 7%,transparent)}',
     '.__dk_inline .__dk_ameta{max-width:none}',
     '.__dk_chips{display:flex;gap:5px;flex-wrap:wrap}',
     '.__dk_chip{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);border-radius:999px;padding:3px 10px;font-size:11.5px;line-height:1.5;font-family:inherit;cursor:pointer;transition:color .15s,border-color .15s,background .15s}',
     '.__dk_chip:hover{color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.18))}',
     '.__dk_chip.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 55%,transparent);color:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_list{display:flex;flex-direction:column;gap:2px}',
     '.__dk_item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 55%,transparent);border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_row:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 55%,transparent)}',
     '.__dk_toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 auto 10px;max-width:960px}',
     '.__dk_foot{display:flex;align-items:center;gap:8px;margin:14px auto 0;padding-top:10px;max-width:960px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_foot .__dk_sp{display:none}',
     '.__dk_sec::after{content:"";order:1;flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_sec > span{order:0}',
     '.__dk_sec > span:last-child{order:2;font-weight:500;letter-spacing:0;color:var(--dsw-alias-label-tertiary,#8b949e)}',
     '.__dk_sec--act{color:#e5484d}',
     '.__dk_num{flex:none;width:64px}',
     '.__dk_num--wide{width:96px}',
     '.__dk_setrow--col{flex-direction:column;align-items:flex-start;gap:5px}',
     '.__dk_setrow > span:first-child{flex:none;font-weight:500}',
     '.__dk_btn.p:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#4d7cf3)}',
     '.__dk_input:hover{border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_input::placeholder{color:var(--dsw-alias-label-tertiary,#8b949e)}',
     '.__dk_search{max-width:960px;margin:0 auto 10px;position:relative}',

     // ------------------------------------------------ 1.6.0 排版尺度 + 交互细节
     // 一套尺度管住全部:间距 4/8/12/16/24,正文 13.5,次要 11.5,行高 1.7。
     // 先用 token 再写规则 —— 后面每条都只引用变量,不再各处即兴写 9px/11px。
     '.__dk_sp,.__dk_panel{--dk-1:4px;--dk-2:8px;--dk-3:12px;--dk-4:16px;--dk-5:24px;--dk-fs:13.5px;--dk-fs-sm:11.5px}',
     // 正文容器:上下留白对称,右侧留出滚动条位置,页面统一 820 宽(侧栏再宽也不摊成一条线)
     '.__dk_spbody{padding:var(--dk-4) var(--dk-4) var(--dk-5)}',
     '.__dk_spbody .__dk_page{max-width:820px}',
     '.__dk_page .__dk_search,.__dk_page .__dk_sec,.__dk_page .__dk_form,.__dk_page .__dk_reply,.__dk_page .__dk_err,.__dk_page .__dk_toolbar,.__dk_page .__dk_foot,.__dk_page .__dk_inline{max-width:100%}',
     // 顶部:标题和日期同基线,日期不再孤零零贴在角落
     '.__dk_sphead{padding:var(--dk-4) var(--dk-4) var(--dk-1);align-items:baseline}',
     '.__dk_sptitle{font-size:15.5px;font-weight:650;gap:var(--dk-2)}',
     '.__dk_spnav{gap:var(--dk-1);padding:var(--dk-2) var(--dk-3) var(--dk-3);position:relative}',
     '.__dk_stab{height:30px;padding:0 11px;border-radius:10px;font-size:12.5px;gap:6px}',
     '.__dk_stab.on{box-shadow:inset 0 -2px 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 70%,transparent)}',
     // 分区头:与上一组拉开 24,与自己的列表只差 8 —— 组间＞组内的比例才看得出层次
     '.__dk_page > .__dk_sec:first-child,.__dk_sec:first-of-type{margin-top:0}',
     '.__dk_sec{margin:var(--dk-5) auto var(--dk-2);font-size:var(--dk-fs-sm);letter-spacing:.04em;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa4b2)}',
     '.__dk_sec > span:last-child{font-weight:500;opacity:.75;font-variant-numeric:tabular-nums}',
     // 列表行:指过去才亮 —— 之前全无 hover,看着像纯文本
     '.__dk_row{padding:10px var(--dk-3);gap:var(--dk-2);border-radius:10px}',
     '.__dk_row:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 65%,transparent)}',
     '.__dk_row--act{box-shadow:inset 2px 0 0 #e5484d}',
     '.__dk_rt{font-size:var(--dk-fs)}',
     '.__dk_rm{font-size:var(--dk-fs-sm);margin-top:2px}',
     // 卡片:圆角 12,悬停描边,内外都留一口气
     '.__dk_item{padding:var(--dk-3);border-radius:12px;border:1px solid transparent}',
     '.__dk_item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 50%,transparent);border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.10))}',
     '.__dk_itext{font-size:var(--dk-fs);line-height:1.7}',
     '.__dk_imeta{gap:var(--dk-2);margin-top:6px;font-size:11px;align-items:center;flex-wrap:wrap}',
     // 每行的动作按钮:平时藏起来,悬停/聚焦才显(触屏没有 hover 就常显)。
     // 一条便签原本常驻 6 个图标 + 时间 + 标签,挤成一团谁也点不准。
     '.__dk_iact{display:flex;align-items:center;gap:2px;flex:none;opacity:.35;transition:opacity .13s}',
     '.__dk_item:hover .__dk_iact,.__dk_item:focus-within .__dk_iact,.__dk_row:hover .__dk_iact{opacity:1}',
     '.__dk_mini{width:28px;height:28px}',
     '@media (hover:none){.__dk_iact{opacity:1}}',
     // 表单改成三块分组:先看清「什么时候 / 提前多少 / 链接」再填,不再一坨输入框
     '.__dk_form{gap:0;padding:0;border:none;background:transparent;margin:0 auto var(--dk-4)}',
     '.__dk_group{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 55%,transparent);padding:var(--dk-3);display:flex;flex-direction:column;gap:var(--dk-2)}',
     '.__dk_group + .__dk_group{margin-top:var(--dk-2)}',
     '.__dk_grouph{display:flex;align-items:center;justify-content:space-between;gap:var(--dk-2);font-size:11px;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary,#8b949e);font-weight:600;margin-bottom:2px}',
     '.__dk_group .__dk_input{background:var(--dsw-alias-bg-layer-1,#1c1f24)}',
     '.__dk_gtip{font-size:11px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#8b949e)}',
     '.__dk_btn{height:30px;border-radius:10px;padding:0 var(--dk-3);font-size:12px}',
     // 搜索:右侧清空键 + 命中数
     '.__dk_qwrap{position:relative;display:flex;align-items:center}',
     '.__dk_qwrap .__dk_input{padding-right:34px}',
     '.__dk_qclear{position:absolute;right:3px;width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);cursor:pointer;display:flex;align-items:center;justify-content:center}',
     '.__dk_qclear:hover{background:var(--dsw-alias-bg-layer-2,#24282e);color:var(--dsw-alias-label-primary,#e6edf3)}',
     '.__dk_qhint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);margin:-4px 0 var(--dk-2);padding-left:2px}',
     // 空态:给一个能直接动手的出口,不只是看一行灰字
     '.__dk_empty{padding:28px var(--dk-4);border-radius:12px;line-height:1.75}',
     '.__dk_emptytitle{font-size:var(--dk-fs);color:var(--dsw-alias-label-secondary,#9aa4b2);margin-bottom:var(--dk-2)}',
     '.__dk_emptyact{margin-top:var(--dk-2)}',
     '.__dk_more{display:flex;justify-content:center;padding:var(--dk-2) 0 var(--dk-1)}',
     '.__dk_morebtn{border:1px dashed var(--dsw-alias-border-l1,rgba(255,255,255,.10));background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);border-radius:10px;padding:6px 12px;font-size:11.5px;font-family:inherit;cursor:pointer;transition:color .15s,border-color .15s,background .15s}',
     '.__dk_morebtn:hover{color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#24282e) 60%,transparent)}',
     // 撤销条:写完就后悔的那 6 秒
     '.__dk_reply{display:flex;align-items:center;gap:var(--dk-2);padding:8px 10px 8px 12px}',
     '.__dk_replytext{flex:1;min-width:0}',
     '.__dk_replybtn{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 45%,transparent);background:transparent;color:var(--dsw-alias-brand-primary,#4d7cf3);border-radius:8px;height:24px;padding:0 9px;font-size:11.5px;font-family:inherit;cursor:pointer}',
     '.__dk_replybtn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d7cf3) 16%,transparent)}',
     // 提醒坞:轮播时鼠标一放上去就停,别把人正在读的那条切走
     '.__dk_dock{padding-bottom:2px}',
     '.__dk_dock--paused .__dk_alert{transition:none}',
     '.__dk_alert{transition:box-shadow .15s,border-color .15s}',
     '.__dk_alert:hover{box-shadow:0 18px 46px rgba(0,0,0,.38),0 2px 8px rgba(0,0,0,.16)}',
     // 长文本折叠:两行预览(原来一行,等于没预览)
     '.__dk_clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}',
   ].join('\n')

   function injectCss() {
     if (typeof document === 'undefined') return
     const id = 'dsh-desk-kit/main.css'
     if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
     const tag = document.createElement('style')
     tag.dataset.plugin = 'dsh-desk-kit'
     tag.dataset.pluginCss = id
     tag.textContent = CSS
     document.head.appendChild(tag)
   }

   // 服务端要求这个头:跨源页面想带就得先发预检,而我们从不应答 CORS,于是拿不到。
   const HEAD = { 'x-desk-kit': '1' }

   async function apiGet() {
     const res = await fetch(API, { cache: 'no-store', headers: HEAD })
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     return body.state
   }
   async function apiPost(action, payload) {
     const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...HEAD }, body: JSON.stringify({ action, payload: payload || {} }) })
     const body = await res.json().catch(() => ({ ok: false, error: '宿主返回不是 JSON' }))
     if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status))
     return body
   }

   /**
    * 复制敏感内容:30 秒后如果剪贴板里还是它,就清掉。
    * Windows 的剪贴板历史会一直留着复制的密码,这一步至少不让它躺在最上面。
    */
   function copySecret(text, ms = 30000) {
     try { navigator.clipboard.writeText(String(text)) } catch { return false }
     setTimeout(async () => {
       try {
         const now = await navigator.clipboard.readText()
         if (now === String(text)) await navigator.clipboard.writeText('')
       } catch { /* 没给读剪贴板权限:读不到就只留提示,不硬清 */ }
     }, ms)
     return true
   }

   const fmtClock = (ts) => { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
   const fmtWhen = (ts) => { const d = new Date(ts); const n = new Date(); return d.toDateString() === n.toDateString() ? '今天 ' + fmtClock(ts) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(ts) }
   const weekText = (days) => (Array.isArray(days) && days.length ? '周' + days.map((d) => WEEK[d]).join('、周') : '每天')
   /** 2026-11-16 → 11月16日 周日(侧栏头部用)。拿不到就返回空串。 */
   const fmtDay = (ymd) => {
     if (typeof ymd !== 'string') return ''
     const parts = ymd.split('-').map(Number)
     if (parts.length !== 3 || !parts[0]) return ''
     const d = new Date(parts[0], parts[1] - 1, parts[2])
     if (isNaN(d.getTime())) return ''
     return (parts[1]) + '月' + parts[2] + '日 周' + WEEK[d.getDay()]
   }

   const copy = (t) => { try { navigator.clipboard.writeText(String(t)); return true } catch { return false } }

   // ---------------------------------------------------------------- 浮标位置
   /** 视口尺寸;非浏览器环境(SSR 测试)给保守默认值。 */
   function viewport() {
     // visualViewport 才是「用户真正看得见的那块」(手机软键盘、浏览器缩放都会改它)
     const vv = typeof window !== 'undefined' ? window.visualViewport : null
     const w = (vv && vv.width) || (typeof window !== 'undefined' && window.innerWidth) || 1280
     const h = (vv && vv.height) || (typeof window !== 'undefined' && window.innerHeight) || 800
     return { w, h }
   }
   /** 约束在视口内,别拖出屏幕外找不回来。 */
   function clampFab(x, y, vw, vh) {
     const mx = Math.max(4, vw - FAB_SIZE - 4)
     const my = Math.max(4, vh - FAB_SIZE - 4)
     return { x: Math.min(Math.max(4, x), mx), y: Math.min(Math.max(4, y), my) }
   }
   /** 松手贴边:以半屏为界吸左或吸右,垂直位置不动。 */
   function snapFab(pos, vw, vh) {
     const c = clampFab(pos.x, pos.y, vw, vh)
     const left = c.x + FAB_SIZE / 2 < vw / 2
     return {
       x: left ? FAB_PAD : Math.max(FAB_PAD, vw - FAB_SIZE - FAB_PAD),
       y: c.y,
       side: left ? 'left' : 'right',
     }
   }
   /** 没存过位置时的默认点:右下角。 */
   function defaultFab() {
     const v = viewport()
     return {
       x: Math.max(FAB_PAD, v.w - FAB_SIZE - FAB_PAD),
       y: Math.max(FAB_PAD, v.h - FAB_SIZE - FAB_PAD),
       side: 'right',
     }
   }
   function loadFab(vw, vh) {
     try {
       const raw = JSON.parse(window.localStorage.getItem(LS_FAB) || 'null')
       if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return clampFab(raw.x, raw.y, vw, vh)
     } catch { /* 存档坏了就当没存过 */ }
     return null
   }
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
     if (r.status === 'silenced') return base + ' · 今天不再提醒'
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

   function ReplyBar({ reply, run, onClear, onSay }) {
     if (!reply) return null
     const text = typeof reply === 'string' ? reply : reply.text
     const undo = reply && typeof reply === 'object' ? reply.undo : null
     const move = reply && typeof reply === 'object' ? reply.move : null
     return h('div', { className: '__dk_reply' }, [
       h('span', { key: 't', className: '__dk_replytext' }, text),
       undo
         ? h('button', {
           key: 'u', className: '__dk_replybtn', title: '撤销刚才那一步',
           onClick: async () => {
             await run(undo.action, undo.payload)
             if (typeof undo.after === 'function') undo.after()
             if (onClear) onClear()
           },
         }, '撤销')
         : null,
     ])
   }

   /** 回执下的第二行:存错分类了,直接挪。 */
   function ReplyMove({ reply, run, onSay }) {
     const move = reply && typeof reply === 'object' ? reply.move : null
     if (!move || !move.id) return null
     return h(MoveChips, { kind: move.kind, id: move.id, run, notify: onSay, label: '分错了?转存到' })
   }

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

   // ---------------------------------------------------------------- 提醒页
   const CYCLE = [
     ['daily', '每天'],
     ['weekly', '每周'],
     ['monthly', '每月'],
     ['once', '一次性'],
     ['solar', '公历每年'],
     ['lunar', '农历每年'],
   ]

   /** 本地「今天」的 YYYY-MM-DD(不能用 toISOString:那是 UTC,晚上会差一天)。 */
   function todayISO(now = new Date()) {
     const p = (n) => String(n).padStart(2, '0')
     return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
   }

   /** 常用提前量:让人点一下,而不是算「4320 分钟是几天」。 */
   const LEAD_PRESETS = [
     [0, '准时'],
     [10, '10 分钟'],
     [30, '30 分钟'],
     [60, '1 小时'],
     [1440, '1 天'],
     [4320, '3 天'],
   ]

   function ReminderForm({ initial, onSave, onCancel, title }) {
     const mode = initial.lunar ? 'lunar'
       : initial.annual ? 'solar'
         : Number.isFinite(initial.monthly) ? 'monthly'
           : initial.date ? 'once'
             : (initial.weekdays && initial.weekdays.length) ? 'weekly' : 'daily'
     const [t, setT] = useState(initial.title || '')
     const [time, setTime] = useState(initial.time || '21:00')
     const [cycle, setCycle] = useState(mode)
     const [days, setDays] = useState(initial.weekdays || [])
     const [mday, setMday] = useState(Number.isFinite(initial.monthly) ? initial.monthly : 1)
     const [date, setDate] = useState(initial.date || todayISO())
     const [url, setUrl] = useState(initial.url || '')
     const [lead, setLead] = useState(initial.leadMin == null ? 30 : initial.leadMin)
     const [mm, setMm] = useState(initial.lunar ? initial.lunar.month : Number((initial.annual || '01-01').split('-')[0]) || 1)

     const [dd, setDd] = useState(initial.lunar ? initial.lunar.day : Number((initial.annual || '01-01').split('-')[1]) || 1)

     const save = () => {
       const payload = { title: t.trim(), time, leadMin: Number(lead) || 0, url: url.trim() }
       if (cycle === 'weekly') payload.weekdays = days
       else if (cycle === 'monthly') { payload.monthly = Math.max(1, Math.min(31, Number(mday) || 1)); payload.weekdays = [] }
       else if (cycle === 'once') { payload.date = date || todayISO(); payload.weekdays = [] }
       else if (cycle === 'solar') { payload.annual = String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0'); payload.weekdays = []; payload.yearly = true }
       else if (cycle === 'lunar') { payload.lunar = { month: Number(mm), day: Number(dd) }; payload.weekdays = []; payload.yearly = true }
       else payload.weekdays = []
       if (initial.id) payload.id = initial.id
       onSave(payload)
     }

     const annual = cycle === 'solar' || cycle === 'lunar'
     const leadNum = Number(lead) || 0

     // 表单分三块:什么时候 → 什么时候提醒我 → 链接。一块一问,不用在一堆输入框里找。
     return h('div', { className: '__dk_form' }, [
       h('div', { key: 'g1', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [
           h('span', { key: 'a' }, title || '新提醒'),
           h('span', { key: 'b' }, annual ? '每年一次'
             : cycle === 'weekly' ? '按周'
               : cycle === 'monthly' ? '每月' + (Number(mday) || 1) + ' 号'
                 : cycle === 'once' ? '只提醒一次' : '每天'),
         ]),
         h('input', {
           key: 'a', className: '__dk_input', autoFocus: true,
           placeholder: '提醒什么,如「交电费」/「吃药」/「朋友生日」',
           value: t, onChange: (e) => setT(e.target.value),
         }),
         h('div', { key: 'cyc', className: '__dk_chips' }, CYCLE.map(([k, label]) =>
           h('button', { key: k, className: '__dk_chip' + (cycle === k ? ' on' : ''), onClick: () => setCycle(k) }, label))),
         cycle === 'weekly'
           ? h('div', { key: 'c', className: '__dk_days' }, WEEK.map((w, i) => h('button', {
             key: i, className: '__dk_day' + (days.includes(i) ? ' on' : ''),
             onClick: () => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i))),
             title: '周' + w,
           }, w)))
           : null,
         cycle === 'weekly' && !days.length ? h('div', { key: 'd', className: '__dk_gtip' }, '都不选 = 每天') : null,
         cycle === 'monthly'
           ? h('div', { key: 'mo', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, '每月'),
             h('input', {
               key: 'd', type: 'number', min: 1, max: 31, className: '__dk_input __dk_num',
               value: mday, onChange: (e) => setMday(e.target.value),
             }),
             h('span', { key: 'u', className: '__dk_gtip' }, '号'),
           ])
           : null,
         cycle === 'monthly'
           ? h('div', { key: 'mt', className: '__dk_gtip' }, '小月没有 31 号时,按当月最后一天提醒')
           : null,
         cycle === 'once'
           ? h('div', { key: 'once', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, '在哪天'),
             h('input', {
               key: 'd', type: 'date', className: '__dk_input', value: date,
               onChange: (e) => setDate(e.target.value),
             }),
           ])
           : null,
         cycle === 'once'
           ? h('div', { key: 'ot', className: '__dk_gtip' }, '过了这天就不再提醒,也不会自动排下一次')
           : null,
         annual
           ? h('div', { key: 'md', className: '__dk_frow' }, [
             h('span', { key: 'l', className: '__dk_gtip' }, cycle === 'lunar' ? '农历' : '公历'),
             h('input', { key: 'mm', type: 'number', min: 1, max: 12, className: '__dk_input __dk_num', value: mm, onChange: (e) => setMm(e.target.value) }),
             h('span', { key: 'u', className: '__dk_gtip' }, '月'),
             h('input', { key: 'dd', type: 'number', min: 1, max: 31, className: '__dk_input __dk_num', value: dd, onChange: (e) => setDd(e.target.value) }),
             h('span', { key: 'v', className: '__dk_gtip' }, '日'),
           ])
           : null,
         h('div', { key: 'b', className: '__dk_frow' }, [
           h('span', { key: 'l', className: '__dk_gtip' }, '几点'),
           h('input', { key: 'tm', type: 'time', className: '__dk_input __dk_num __dk_num--wide', value: time, onChange: (e) => setTime(e.target.value) }),
         ]),
       ]),

       h('div', { key: 'g2', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '提前多久提醒')]),
         h('div', { key: 'p', className: '__dk_chips' }, LEAD_PRESETS.map(([v, label]) =>
           h('button', {
             key: v, className: '__dk_chip' + (leadNum === v ? ' on' : ''),
             onClick: () => setLead(v),
           }, label))),
         h('div', { key: 'b', className: '__dk_frow' }, [
           h('input', { key: 'ld', type: 'number', min: 0, max: 10080, className: '__dk_input __dk_num', value: lead, onChange: (e) => setLead(e.target.value) }),
           h('span', { key: 'm', className: '__dk_gtip' }, '分钟' + (leadNum >= 1440 ? '(≈ ' + (leadNum / 1440).toFixed(1).replace(/\.0$/, '') + ' 天前)' : '')),
         ]),
         annual ? h('div', { key: 'tip', className: '__dk_gtip' }, '生日/纪念日:选好月日后每年自动提醒;默认提前 3 天(4320 分钟)') : null,
       ]),

       h('div', { key: 'g3', className: '__dk_group' }, [
         h('div', { key: 'h', className: '__dk_grouph' }, [h('span', { key: 'a' }, '打开链接'), h('span', { key: 'b' }, '可选')]),
         h('input', { key: 'e', className: '__dk_input', placeholder: 'https://…', value: url, onChange: (e) => setUrl(e.target.value) }),
         h('div', { key: 't', className: '__dk_gtip' }, '填了会在提醒行右侧给一个「打开」按钮'),
       ]),

       h('div', { key: 'f', className: '__dk_frow' }, [
         h('button', { key: 's', className: '__dk_btn p', disabled: !t.trim() || (cycle === 'once' && !date), onClick: save }, '保存'),
         h('button', { key: 'c', className: '__dk_btn', onClick: onCancel }, '取消'),
       ]),
     ])
   }

   function RemindersPage({ state, run, notify }) {
     const [editing, setEditing] = useState('')
     const [adding, setAdding] = useState(false)
     const [view, setView] = useState('active')          // active | trash
     const [moveId, setMoveId] = useState('')            // 哪一条正在挑分类
     const all = state.reminders || []
     const trashed = state.trashedReminders || []
     const rc = state.reminderCounts || { active: all.length, trash: trashed.length }
     const say = (text, undo) => { if (notify) notify(text, undo) }

     // 暂停的沉到最下面:列表顺序也应该跟着「现在要不要管它」走
     const sorted = all.slice().sort((a, b) => (a.status === 'paused' ? 1 : 0) - (b.status === 'paused' ? 1 : 0))

     // ---- 垃圾箱视图 ----
     if (view === 'trash') {
       return h(React.Fragment, null, [
         h('div', { key: 'bar', className: '__dk_toolbar' }, [
           h('button', { key: 'b', className: '__dk_btn', onClick: () => setView('active') }, [
             h(Ico, { key: 'i', name: 'chevronLeft', size: 14 }), ' 返回',
           ]),
           h('span', { key: 'h', className: '__dk_hint' }, '删掉的提醒都在这里,可恢复'),
         ]),
         trashed.length
           ? trashed.map((r) => h('div', { key: r.id, className: '__dk_item' }, [
             h('div', { key: 't', className: '__dk_itop' }, [
               h('div', { key: 'x', className: '__dk_itext' }, r.title),
               h('div', { key: 'act', className: '__dk_iact' }, [
                 h('button', { key: 'rs', className: '__dk_mini', title: '恢复', 'aria-label': '恢复', onClick: () => run('reminder.restore', { id: r.id }) }, h(Ico, { name: 'undo', size: 15 })),
                 h('button', { key: 'pg', className: '__dk_mini', title: '彻底删除', 'aria-label': '彻底删除', onClick: () => { if (window.confirm('彻底删除「' + r.title + '」?不可恢复')) run('reminder.purge', { id: r.id }) } }, h(Ico, { name: 'x', size: 15 })),
               ]),
             ]),
             h('div', { key: 'm', className: '__dk_imeta' }, [
               h('span', { key: 'd' }, '删除于 ' + fmtWhen(r.deletedAt)),
               r.annual ? h('span', { key: 'a' }, '每年 ' + r.annual) : null,
               r.lunar ? h('span', { key: 'l' }, '农历' + r.lunar.month + '/' + r.lunar.day) : null,
             ]),
           ]))
           : h('div', { key: 'e', className: '__dk_empty' }, [
             h('div', { key: 't', className: '__dk_emptytitle' }, '垃圾箱是空的'),
             h('div', { key: 'h', className: '__dk_note' }, '删掉的提醒会先在这里放一阵子,想恢复随时来拿。'),
           ]),
       ])
     }
     const save = async (r, patch) => {
       if (r) await run('reminder.update', { id: r.id, ...patch })
       else await run('reminder.add', patch)
       setEditing(''); setAdding(false)
       say(r ? '已保存修改' : '已加一条提醒')
     }
     return h(React.Fragment, null, [
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => { setAdding(true); setEditing('') } }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), ' 新提醒']),
         h('span', { key: 'h', className: '__dk_hint' }, '全部 ' + all.length + ' 条'),
       ]),
       adding ? h(ReminderForm, { key: 'new', title: '新提醒', initial: {}, onSave: (v) => save(null, v), onCancel: () => setAdding(false) }) : null,
       sorted.length
         ? sorted.map((r) => h('div', { key: r.id, className: '__dk_item' + (r.status === 'expired' || r.status === 'paused' ? ' __dk_item--dim' : '') }, [
           editing === r.id
             ? h(ReminderForm, { key: 'f', title: '编辑', initial: r, onSave: (v) => save(r, v), onCancel: () => setEditing('') })
             : h(React.Fragment, { key: 'v' }, [
               h('div', { key: 't', className: '__dk_itop' }, [
                 h('button', { key: 'c', className: '__dk_check' + (r.done ? ' on' : ''), title: r.done ? '取消完成' : '标记完成', onClick: () => run(r.done ? 'reminder.uncheckin' : 'reminder.checkin', { id: r.id }) }, r.done ? h(Ico, { name: 'check', size: 12 }) : null),
                 h('div', { key: 'm', className: '__dk_itext' }, [
                   h('div', { key: 'a' }, r.title),
                   h('div', { key: 'b', className: '__dk_imeta' }, reminderMeta(r)),
                 ]),
                 r.url ? h('a', { key: 'go', className: '__dk_go', href: r.url, target: '_blank', rel: 'noreferrer' }, '打开') : null,
                 h('div', { key: 'act', className: '__dk_iact' }, [
                   // 暂停 = 暂时不想收到提醒,但记录留着。以前只有改时间或者删掉这两条路。
                   h('button', {
                     key: 'p', className: '__dk_mini',
                     title: r.active === false ? '继续提醒' : '暂停提醒',
                     'aria-label': r.active === false ? '继续提醒' : '暂停提醒',
                     onClick: async () => {
                       await run('reminder.update', { id: r.id, active: r.active === false })
                       say(r.active === false ? '已继续提醒' : '已暂停,不再弹提醒')
                     },
                   }, h(Ico, { name: r.active === false ? 'play' : 'pause', size: 15 })),
                   h('button', { key: 'mv', className: '__dk_mini', title: '转存到别的分类', 'aria-label': '转存到别的分类', onClick: () => setMoveId(moveId === r.id ? '' : r.id) }, h(Ico, { name: 'swap', size: 15 })),
                   h('button', { key: 'e', className: '__dk_mini', title: '编辑', 'aria-label': '编辑', onClick: () => { setEditing(r.id); setAdding(false) } }, h(Ico, { name: 'edit', size: 15 })),
                   h('button', {
                     key: 'x', className: '__dk_mini', title: '移入垃圾箱', 'aria-label': '移入垃圾箱',
                     onClick: async () => {
                       // 软删,所以不用弹确认框 —— 直接给「撤销」更好用
                       await run('reminder.delete', { id: r.id })
                       say('已移入垃圾箱', { action: 'reminder.restore', payload: { id: r.id } })
                     },
                   }, h(Ico, { name: 'trash', size: 15 })),
                 ]),
               ]),
               moveId === r.id ? h(MoveChips, { key: 'mv', kind: 'reminder', id: r.id, run, notify: (t) => { setMoveId(''); say(t) } }) : null,
             ]),
         ]))
         : h('div', { key: 'e', className: '__dk_empty' }, [
           h('div', { key: 't', className: '__dk_emptytitle' }, '还没有提醒'),
           h('div', { key: 'h', className: '__dk_note' }, '点上面「新提醒」手动加;或者在首页说一句「每天 9 点提醒我吃药」。'),
         ]),
       h('div', { key: 'foot', className: '__dk_foot' }, [
         h('span', { key: 'sp', className: '__dk_spacer' }),
         h('button', { key: 't', className: '__dk_chip', onClick: () => setView('trash') },
           '垃圾箱 (' + (rc.trash || 0) + ')'),
       ]),
     ])
   }

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
     const hit = (n) => !kw || (n.text + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(kw)
     // 搜索时跨「进行中 + 长期」一起搜,平铺显示;不搜索时分成两段
     const searched = kw ? buckets.active.concat(buckets.long, buckets.archived).filter(hit) : []
     // 便签页的搜索框也顺手当全局搜:提醒和保险库的标题一起找
     const remHits = kw ? (state.reminders || []).filter((r) => !((r.deletedAt || 0) > 0) && String(r.title || '').toLowerCase().includes(kw)) : []
     const secHits = kw ? (state.secrets || []).filter((x) => String(x.title || '').toLowerCase().includes(kw)) : []
     const linkHits = kw ? (state.links || []).filter((l) => (String(l.title || '') + ' ' + String(l.url || '')).toLowerCase().includes(kw)) : []

     const add = async () => {
       const text = draft.trim()
       if (!text) return
       await run('note.add', { text, tags: tags.split(/[\s,，]+/).filter(Boolean) })
       setDraft(''); setTags(''); setOpenAdd(false)
       say('已存进便签')
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
             }, isLong && !open ? (n.pinned ? '📌 ' : '') + firstLine : n.text),
             h('div', { key: 'm', className: '__dk_imeta' }, [
               h('span', { key: 'd' }, fmtWhen(n.updatedAt)),
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
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => setOpenAdd((v) => !v) }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), openAdd ? ' 收起' : ' 新便签']),
         h('button', {
           key: 'ca', className: '__dk_btn', title: '复制当前列表',
           onClick: () => {
             const allText = (kw ? searched : buckets.active.concat(buckets.long)).map((n) => (n.tags && n.tags.length ? '[' + n.tags.join(' ') + '] ' : '') + n.text).join('\n\n')
             if (copy(allText)) say('已复制 ' + (kw ? searched.length : buckets.active.length + buckets.long.length) + ' 条')
           },
         }, [h(Ico, { key: 'i', name: 'copy', size: 13 }), ' 复制']),
       ]),
       openAdd ? h('div', { key: 'form', className: '__dk_form' }, [
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
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 's', className: '__dk_btn p', disabled: !draft.trim(), onClick: add }, '保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => setOpenAdd(false) }, '取消'),
         ]),
       ]) : null,

       // 搜索:平铺结果(便签 + 提醒标题 + 保险库标题)
       kw
         ? (searched.length
           ? searched.map((n) => row(n, n.shelf === 'long' && !n.archived ? 'long' : 'daily'))
           : (remHits.length || secHits.length || linkHits.length
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
           style: custom ? { background: 'var(--dsw-alias-bg-layer-2,#24282e)' } : { background: 'hsl(' + linkHue(l.url) + ' 52% 40%)' },
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

   function VaultPage({ state, run, notify }) {
     const [moving, setMoving] = useState('')
     const [openAdd, setOpenAdd] = useState(false)
     const [title, setTitle] = useState('')
     const [body, setBody] = useState('')
     const [revealed, setRevealed] = useState({})
     const [editing, setEditing] = useState(null)   // { id, title, body }
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
       if (!title.trim()) return
       await run('secret.add', { title: title.trim(), body })
       setTitle(''); setBody(''); setOpenAdd(false)
       say('已加密保存')
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

     return h(React.Fragment, null, [
       h('div', { key: 'bar', className: '__dk_toolbar' }, [
         h('button', { key: 'a', className: '__dk_btn p', onClick: () => setOpenAdd((v) => !v) }, [h(Ico, { key: 'i', name: 'plus', size: 14 }), openAdd ? ' 收起' : ' 新条目']),
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
       openAdd ? h('div', { key: 'form', className: '__dk_form' }, [
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
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 's', className: '__dk_btn p', disabled: !title.trim(), onClick: add }, '加密保存'),
           h('button', { key: 'c', className: '__dk_btn', onClick: () => setOpenAdd(false) }, '取消'),
         ]),
       ]) : null,
       secrets.length
         ? secrets.map((s) => h('div', { key: s.id, className: '__dk_item' }, [
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

   // ---------------------------------------------------------------- 设置

   /**
    * 识图模型选择。
    * 必须对宿主返回做类型守卫:老宿主没有 /models 路由时会回 {ok:true,state:…},
    * 此时 providers 是 undefined —— 直接 .map() 会让整个 overlay 抛错卸载,
    * 表现就是「点开设置插件消失」(踩过)。
    */
   function ModelPicker({ label, hint, providerKey, modelKey, settings, onUpdate, initialProviders }) {
     const [providers, setProviders] = useState(function () {
       return Array.isArray(initialProviders) ? initialProviders : [];
     });
     const [loading, setLoading] = useState(initialProviders === undefined);
     const [failed, setFailed] = useState('');

     useEffect(function () {
       if (initialProviders !== undefined) return; // 测试注入时不再请求
       fetch('/desk-kit-api/models', { headers: HEAD })
         .then(function (r) { return r.json() })
         .then(function (data) {
           setProviders(data && Array.isArray(data.providers) ? data.providers : []);
           setLoading(false);
         })
         .catch(function (e) {
           setFailed(String((e && e.message) || e));
           setProviders([]);
           setLoading(false);
         });
     }, []);

     if (loading) return h('div', { className: '__dk_hint' }, '正在加载模型目录…');

     const list = Array.isArray(providers) ? providers : [];
     const s = settings || {};
     const p = typeof s[providerKey] === 'string' ? s[providerKey] : '';
     const m = typeof s[modelKey] === 'string' ? s[modelKey] : '';
     const current = list.find(function (x) { return x && x.id === p });
     const models = current && Array.isArray(current.models) ? current.models : [];

     return h('div', { className: '__dk_form' }, [
       h('div', { key: 't', className: '__dk_hint' }, label),
       hint ? h('div', { key: 'hh', className: '__dk_hint' }, hint) : null,
       h('select', {
         key: 'selP',
         className: '__dk_input',
         value: p,
         onChange: function (e) { var patch = {}; patch[providerKey] = e.target.value; patch[modelKey] = ''; onUpdate(patch) },
       }, [
         h('option', { key: '__auto', value: '' }, '跟随默认模型'),
         ...list.map(function (prov) {
           return h('option', { key: prov.id, value: prov.id }, prov.name || prov.id)
         }),
       ]),
       p ? h('select', {
         key: 'selM',
         className: '__dk_input',
         value: m,
         onChange: function (e) { var patch = {}; patch[providerKey] = p; patch[modelKey] = e.target.value; onUpdate(patch) },
       }, [
         h('option', { key: '__none', value: '' }, '请选择模型'),
         ...models.map(function (mod) {
           const label = (mod.name || mod.id) + (mod.image === true ? ' ✓识图' : mod.image === false ? ' (不支持图片)' : '')
           return h('option', { key: mod.id, value: mod.id }, label)
         }),
       ]) : null,
       failed ? h('div', { key: 'e', className: '__dk_hint' }, '模型目录读取失败:' + failed) : null,
       list.length === 0 && !failed
         ? h('div', { key: 'n', className: '__dk_hint' }, '宿主没返回任何模型')
         : null,
     ]);
   }

   /**
    * 真正的 React 错误边界(必须用 class:getDerivedStateFromError 只有 class 有)。
    * 单个页面崩了只显示一行错误,不能把整个浮层卸载掉 ——
    * 之前「点开设置插件消失」就是渲染抛错把 overlay 带走。
    */
   class SafePage extends React.Component {
     constructor(props) {
       super(props)
       this.state = { err: '' }
     }
     static getDerivedStateFromError(error) {
       return { err: String((error && error.message) || error) }
     }
     render() {
       if (this.state.err) {
         return h('div', { className: '__dk_err' }, '这个页面出错了:' + this.state.err + '(其它页还能用)')
       }
       return this.props.children
     }
   }

   function Settings({ state, run, sidebarReady }) {
     const s = state.settings || {};
     const update = (newS) => run('settings.update', newS);
     return h(React.Fragment, null, [
       h('div', { key: 's1', className: '__dk_sec' }, [h('span', { key: 'a' }, '入口'), h('span', { key: 'b' })]),
       h('div', { key: 'v', className: '__dk_setrow' }, [h('span', { key: 'l' }, '版本'), h('span', { key: 'r', className: '__dk_hint' }, VERSION)]),
       h('div', { key: 'fab', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '浮标快捷入口'),
         h('button', {
           key: 'b', className: '__dk_switch' + (floatEnabled(state, sidebarReady) ? ' on' : ''),
           onClick: () => run('settings.update', { floatFab: !floatEnabled(state, sidebarReady) }),
         }),
       ]),
       h('div', { key: 'entry', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '入口在哪'),
         h('span', { key: 'r', className: '__dk_hint' }, '主入口是侧边栏的「随手台」标签页(要装 dsh-better-sidebar);另外有会话顶栏图标和 Ctrl/Cmd+Shift+K。浮标默认让位,没装侧栏插件时自动兜底。'),
       ]),
       h('div', { key: 'd', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '数据目录'),
         h('span', { key: 'r', className: '__dk_hint' }, state.root || ''),
       ]),
       h('div', { key: 'snd', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '提示音'),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', { key: 'try', className: '__dk_chip', title: '试听一下', onClick: () => playChime() }, '试听'),
           h('button', {
             key: 'b', className: '__dk_switch' + (s.sound !== false ? ' on' : ''),
             title: s.sound === false ? '打开提示音' : '关闭提示音',
             onClick: () => update({ sound: s.sound === false }),
           }),
         ]),
       ]),
       h('div', { key: 'fav', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '网页用网站图标'),
         h('button', {
           key: 'b', className: '__dk_switch' + (s.linkFavicons ? ' on' : ''),
           title: s.linkFavicons ? '改回首字色块(不联网)' : '去取网站图标(会联网)',
           onClick: () => update({ linkFavicons: !s.linkFavicons }),
         }),
       ]),
       h('div', { key: 'favh', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'r', className: '__dk_hint' },
           s.linkFavicons
             ? '现在会去 icons.duckduckgo.com 取图标 —— 等于把域名告诉它。不想联网就关掉,改用「首字 + 按域名算的底色」。'
             : '关着:用「首字 + 按域名算出来的底色」,不联网也能一眼认。打开才会去第三方取图标。'),
       ]),
       h('div', { key: 'm', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '静音提醒'),
         h('button', {
           key: 'b', className: '__dk_switch' + (state.settings && state.settings.muted ? ' on' : ''),
           onClick: () => run('settings.update', { muted: !(state.settings && state.settings.muted) }),
         }),
       ]),
       h('div', { key: 'h', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '怎么用'),
         h('span', { key: 'r', className: '__dk_hint' }, '首页说一句话自动分类;要精确控制就点下方对应的分类页手动加。'),
       ]),
       h('div', { key: 's2', className: '__dk_sec' }, [h('span', { key: 'a' }, '模型'), h('span', { key: 'b' })]),
       h(ModelPicker, {
         key: 'mp-classify',
         label: '分类模型(首页说一句话时用)',
         hint: '选一个纯文字模型即可;它只负责把你的话判成 提醒/便签/保险库。不选就走本地规则。',
         providerKey: 'classifyProvider',
         modelKey: 'classifyModel',
         settings: s, onUpdate: update,
       }),
       h('div', { key: 's3', className: '__dk_sec' }, [h('span', { key: 'a' }, '数据'), h('span', { key: 'b' })]),
       h('div', { key: 'cnt', className: '__dk_setrow' }, [
         h('span', { key: 'l' }, '现在存了'),
         h('span', { key: 'r', className: '__dk_hint' },
           (state.reminderCounts ? state.reminderCounts.active : (state.reminders || []).length) + ' 条提醒 · '
           + (state.notes || []).filter((n) => !((n.deletedAt || 0) > 0)).length + ' 条便签 · '
           + (state.links || []).length + ' 个网页 · '
           + (state.secrets || []).length + ' 条保险库'),
       ]),
       h('div', { key: 'bk', className: '__dk_setrow __dk_setrow--col' }, [
         h('span', { key: 'l' }, '导出备份'),
         h('div', { key: 'r', className: '__dk_frow' }, [
           h('button', {
             key: 'b', className: '__dk_btn',
             onClick: async () => {
               try {
                 const r = await fetch(API + '/export', { headers: HEAD })
                 const body = await r.json()
                 if (!body || !body.ok) throw new Error((body && body.error) || '导出失败')
                 const text = JSON.stringify(body.backup, null, 2)
                 const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
                 const a = document.createElement('a')
                 a.href = url
                 a.download = 'desk-kit-' + new Date().toISOString().slice(0, 10) + '.json'
                 document.body.appendChild(a)
                 a.click()
                 setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 0)
               } catch (e) {
                 if (window.alert) window.alert('导出没成功:' + (e && e.message ? e.message : e))
               }
             },
           }, [h(Ico, { key: 'i', name: 'download', size: 14 }), ' 导出为 JSON']),
         ]),
         h('span', { key: 'h', className: '__dk_hint' }, '提醒和便签是明文;保险库导出的是密文,换机器要连 vault.key 一起拷才解得开。'),
       ]),
     ])
   }

   // ---------------------------------------------------------------- 主体
   const TITLES = { home: '随手台', links: '网页', reminders: '提醒', notes: '便签 / 合集', vault: '保险库', settings: '设置' }

   /**
    * 重要等级(界面只表达四档,不再细分):
    *   L1 待行动 —— 今天/过点要你动手的:提醒、到点提示。红点、加粗、红边圈。
    *   L2 记录   —— 正在跟进的事:首页今天列表、便签「进行中」。
    *   L3 备查   —— 存着不催的:长期资料、保险库。灰、折叠、不抢眼。
    *   L4 配置   —— 一年点两次的:设置。收在最右。
    */
   const LEVELS = {
     home: { code: 'L1', name: '待行动', color: '#e5484d' },
     links: { code: 'L2', name: '常用入口', color: 'var(--dsw-alias-brand-primary)' },
     reminders: { code: 'L1', name: '待行动', color: '#e5484d' },
     notes: { code: 'L2', name: '记录', color: 'var(--dsw-alias-brand-primary)' },
     vault: { code: 'L3', name: '备查', color: '#8b949e' },
     settings: { code: 'L4', name: '配置', color: '#8b949e' },
   }

   // 浮标可能被别的浮窗盖住,所以留了两条侧门:会话顶栏的小图标 + 快捷键。
   // 两条侧门都只发一条 window 事件,面板自己监听 —— 两棵 React 树不用共享状态。
   const OPEN_EVENT = 'desk-kit:open'
   function requestOpen() {
     try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)) } catch { /* 没有 window 就算了 */ }
   }

   /** 待办数:到点未完成的提醒 + 未确认提示。0 表示没东西催。 */
   function dueCount(state) {
     if (!state) return 0
     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const pend = (state.reminders || []).filter((r) => r.status === 'pending' && !r.done)
     return pend.length + alerts.length
   }

   // ---------------------------------------------------------------- 侧门:会话顶栏
   /**
    * 会话顶栏的小图标(shell 的 utilities 槽,在宿主自己的按钮左边,随流排布,
    * 不会和任何悬浮窗打架)。自己轻量轮询一次待办数,60 秒一次,别跟主面板抢。
    */

   // ---------------------------------------------------------------- 到点提醒
   /**
    * 提醒坞:右下角,一屏最多 3 条,超过 3 条按页轮转。
    * 轮转 = 旧的一批渐隐 + 新的一批渐显(不是硬切),每条都带缓动入场。
    */
   const DOCK_MAX = 3
   const DOCK_ROTATE_MS = 6500

   /** 一屏取哪几条:page 从 0 开始,越界夹回,尾页也要填满 3 格。纯函数,好测。 */
   function dockSlice(alerts, page) {
     const total = alerts.length
     if (!total) return { shown: [], rest: 0, pages: 1, page: 0 }
     const pages = Math.max(1, Math.ceil(total / DOCK_MAX))
     const p = Math.min(Math.max(0, page | 0), pages - 1)
     const start = Math.min(p * DOCK_MAX, Math.max(0, total - DOCK_MAX))
     const shown = alerts.slice(start, start + DOCK_MAX)
     return { shown: shown, rest: total - shown.length, pages: pages, page: p }
   }

   function alertMeta(a) {
     return a.text || ('计划 ' + fmtClock(a.dueAt))
   }

   /** 卡片上半句:错过的 / 到点了 / 快到点了。 */
   function alertHead(a) {
     if (a.late) return '错过的提醒 · '
     return a.over ? '到点了 · ' : '快到点了 · '
   }

   const SNOOZE_CHOICES = [[10, '10 分钟'], [30, '30 分钟'], [60, '1 小时']]

   function AlertCard({ a, run, onOpen, quiet }) {
     const over = !!a.over
     const [menu, setMenu] = useState(false)
     // 先 ack 再 snooze:ack 会把当天记成静音,snooze 要把静音解除 —— 顺序反了就永远不响
     const snooze = async (minutes) => {
       await run('alert.ack', { id: a.id })
       await run('reminder.snooze', { id: a.refId, minutes })
       setMenu(false)
     }
     return h('div', { className: '__dk_alert' + (over ? '' : ' __dk_alert--calm') }, [
       h('div', { key: 'hd', className: '__dk_ahead' }, [
         h('span', { key: 'i', className: '__dk_aicon' }, h(Ico, { name: over ? 'bell' : 'clock', size: 13 })),
         h('div', { key: 'm', className: '__dk_amain' }, [
           h('div', { key: 't', className: '__dk_atitle', title: a.title }, a.title),
           h('div', { key: 's', className: '__dk_ameta' }, alertHead(a) + alertMeta(a)),
         ]),
         h('button', {
           key: 'x', className: '__dk_ax', title: '知道了(不再提醒)',
           onClick: () => run('alert.ack', { id: a.id }),
         }, h(Ico, { name: 'x', size: 13 })),
       ]),
       h('div', { key: 'r', className: '__dk_trow' }, [
         h('button', {
           key: 'c', className: '__dk_tbtn p', title: '标记今天已完成',
           onClick: async () => { await run('reminder.checkin', { id: a.refId, date: a.dueDate }); await run('alert.ack', { id: a.id }) },
         }, '完成'),
         h('button', {
           key: 's', className: '__dk_tbtn', title: '晚点再提醒', onClick: () => setMenu((v) => !v),
         }, menu ? '稍后 ▴' : '稍后 ▾'),
         onOpen ? h('button', { key: 'o', className: '__dk_tbtn', title: '打开随手台', onClick: onOpen }, '打开') : null,
       ]),
       menu
         ? h('div', { key: 'menu', className: '__dk_chips' }, SNOOZE_CHOICES.map(([m, label]) =>
           h('button', { key: m, className: '__dk_chip', onClick: () => snooze(m) }, label)))
         : null,
     ])
   }

   /**
    * 右下角提醒坞:多条时按页轮转。
    * model 是纯函数式的:page 由 effect 每 DOCK_ROTATE_MS 推一格,切换前先 fade 300ms。
    */
   function AlertDock({ alerts, run, onOpen, offsetBottom, onAllAck }) {
     const [page, setPage] = useState(0)
     const [fading, setFading] = useState(false)
     // 人正在读的时候不能把卡片换掉。鼠标移上去 / 键盘聚焦 / 指头按着,都算「正在看」。
     const [paused, setPaused] = useState(false)
     const total = alerts.length
     const pages = Math.max(1, Math.ceil(total / DOCK_MAX))

     // 条数变少时把页码夹回合法范围
     useEffect(() => { setPage((p) => Math.min(p, Math.max(0, pages - 1))) }, [pages])

     useEffect(() => {
       if (pages < 2 || paused) { setFading(false); return }
       let outTimer = null
       const tick = setInterval(() => {
         setFading(true)
         outTimer = setTimeout(() => { setPage((p) => (p + 1) % pages); setFading(false) }, 300)
       }, DOCK_ROTATE_MS)
       return () => { clearInterval(tick); if (outTimer) clearTimeout(outTimer) }
     }, [pages, paused])

     if (!total) return null
     const { shown, rest } = dockSlice(alerts, page)

     const off = Number.isFinite(offsetBottom) && offsetBottom > 0 ? offsetBottom : 0
     return h('div', {
       className: '__dk_dock' + (paused ? ' __dk_dock--paused' : ''),
       title: pages > 1 ? (paused ? '已暂停轮播' : '多条提醒在轮播:鼠标移上去可以停下来慢慢看') : null,
       onMouseEnter: () => setPaused(true),
       onMouseLeave: () => setPaused(false),
       onPointerDown: () => setPaused(true),
       onFocusCapture: () => setPaused(true),
       onBlurCapture: () => setPaused(false),
       style: Object.assign(
         { opacity: fading ? 0 : 1, transition: 'opacity .3s ease' },
         off ? { bottom: (22 + off) + 'px' } : null,
       ),
     }, [
       rest > 0 || pages > 1
         ? h('button', {
           key: 'more', className: '__dk_dockmore', title: '把所有提醒标为已读',
           onClick: () => {
             run('alert.ackAll')
             if (onAllAck) onAllAck()
           },
         }, rest > 0 ? '还有 ' + rest + ' 条 · 全部知道了' : '全部知道了')
         : null,
       ...shown.map((a) => h(AlertCard, { key: a.id, a, run, onOpen })),
     ])
   }

   /** 侧栏页里的同款提醒,横排一条一条铺开(不是浮层)。 */
   function AlertInline({ alerts, run }) {
     if (!alerts || !alerts.length) return null
     return h('div', { className: '__dk_inline' }, [
       h('span', { key: 'i', className: '__dk_aicon' }, h(Ico, { name: 'bell', size: 13 })),
       h('div', { key: 'm', className: '__dk_amain' }, [
         h('div', { key: 't', className: '__dk_atitle' }, alerts.length === 1 ? alerts[0].title : (alerts[0].title + ' 等 ' + alerts.length + ' 项')),
         h('div', { key: 's', className: '__dk_ameta' }, alerts.length === 1 ? alertMeta(alerts[0]) : '点下面的按钮处理,或切到「提醒」页'),
       ]),
       h('button', {
         key: 'go', className: '__dk_chip',
         onClick: () => { run('alert.ackAll') },
       }, '全部知道了'),
     ])
   }

   function HeaderButton() {
     const [due, setDue] = useState(0)
     useEffect(() => {
       let alive = true
       const tick = async () => {
         try { const s = await apiGet(); if (alive) setDue(dueCount(s)) } catch { /* 拉不到就保持原样 */ }
       }
       tick()
       const t = setInterval(tick, 60000)
       return () => { alive = false; clearInterval(t) }
     }, [])
     return h('button', {
       type: 'button', className: '__dk_hbtn', title: '随手台' + (due ? '(' + due + ' 项待办)' : ''), onClick: requestOpen,
     }, [
       h(Ico, { key: 'i', name: 'clipboard', size: 16 }),
       due ? h('span', { key: 'd', className: '__dk_hdot' }, String(due)) : null,
     ])
   }
   const TABS = [
     ['reminders', 'bell', '提醒'],
     ['notes', 'note', '便签'],
     ['links', 'grid', '网页'],
     ['vault', 'lock', '保险库'],
   ]

   /** 底部导航:左右各两格,中间是首页圆键。 */
   function TabBar({ page, go, due }) {
     const half = (items) => items.map(([id, icon, label]) => h('button', {
       key: id, className: '__dk_tab' + (page === id ? ' on' : ''), onClick: () => go(id),
     }, [h(Ico, { key: 'i', name: icon, size: 20 }), h('span', { key: 'l' }, label)]))
     return h('div', { className: '__dk_tabbar' }, [
       ...half(TABS.slice(0, 2)),
       h('button', { key: 'home', className: '__dk_tabhome', title: '首页', onClick: () => go('home') },
         [h(Ico, { key: 'i', name: 'home', size: 21 }), due ? h('span', { key: 'd', className: '__dk_dot' }, String(due)) : null]),
       ...half(TABS.slice(2)),
     ])
   }

   function Root({ bridge }) {
     const sidebar = useSidebarBridge(bridge)
     const [open, setOpen] = useState(false)
     const [fab, setFab] = useState(defaultFab)
     const [dragging, setDragging] = useState(false)
     const [fabRect, setFabRect] = useState(null)
     const [panelShift, setPanelShift] = useState({ dx: 0, dy: 0 })
     const shiftTries = useRef(0)
     const drag = useRef(null)
     const fabEl = useRef(null)
     const panelEl = useRef(null)
     const [page, setPage] = useState('home')
     const [dir, setDir] = useState('left')
     const [seq, setSeq] = useState(0)
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [reply, setReply] = useState(null)
     // 撤销后回填到输入框的原话
     const [seed, setSeed] = useState('')
     const touch = useRef({ x: 0, y: 0, t: 0 })
     const timer = useRef(null)

     const load = useCallback(async () => {
       try { setState(await apiGet()); setErr('') } catch (e) { setErr(String((e && e.message) || e)) }
     }, [])
     usePoll(load)
     useAlertSound(state && state.settings, state && state.alerts)

     // 位置:首屏读存档,改窗口大小时别把它挤到屏幕外
     useEffect(() => {
       const v = viewport()
       const saved = loadFab(v.w, v.h)
       if (saved) setFab((cur) => ({ ...cur, ...saved, side: saved.x + FAB_SIZE / 2 < v.w / 2 ? 'left' : 'right' }))
       const onResize = () => {
         const v2 = viewport()
         setFab((cur) => { const c = clampFab(cur.x, cur.y, v2.w, v2.h); return { ...cur, ...c } })
       }
       window.addEventListener('resize', onResize)
       return () => window.removeEventListener('resize', onResize)
     }, [])

     // 侧门(顶栏图标 / 快捷键)统一走这条事件。
     // 有侧栏标签页就交给它;浮标只在「没装侧栏」或「用户显式打开浮标」时才弹。
     const floatRef = useRef(false)
     useEffect(() => { floatRef.current = floatEnabled(state, sidebar.ready) }, [state, sidebar.ready])
     useEffect(() => {
       const onOpen = () => {
         // 有侧栏标签页:apply() 那条监听已经负责打开它,这里别再开一次
         if (sidebar.open) return
         if (state && !floatRef.current) return
         setOpen(true); load(); setPage('home'); setSeq((s) => s + 1)
       }
       window.addEventListener(OPEN_EVENT, onOpen)
       return () => window.removeEventListener(OPEN_EVENT, onOpen)
     }, [load, state])

     useEffect(() => {
       const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
       window.addEventListener('keydown', onKey)
       return () => window.removeEventListener('keydown', onKey)
     }, [])

     const run = useCallback(async (action, payload) => {
       try {
         const body = await apiPost(action, payload)
         if (body.state) setState(body.state)
         setErr('')
         return body
       } catch (e) { setErr(String((e && e.message) || e)); return null }
     }, [])

     // notify(text) 									只报一句
     // notify(text, {action, payload}) 		顺手给一个「撤销」,6 秒内可点
     const showReply = useCallback((text, undo, move) => {
       setReply(text ? { text: text, undo: undo || null, move: move || null } : null)
       if (timer.current) clearTimeout(timer.current)
       if (!text) return
       timer.current = setTimeout(() => setReply(null), undo ? 6000 : 3500)
     }, [])

     const go = useCallback((next) => {
       setDir(ORDER.indexOf(next) >= ORDER.indexOf(page) ? 'left' : 'right')
       setPage(next)
       setSeq((s) => s + 1)
     }, [page])

     const move = useCallback((step) => {
       const i = ORDER.indexOf(page) + step
       if (i < 0 || i >= ORDER.length) return
       go(ORDER[i])
     }, [page, go])

     // ------------- 浮标:拖哪停哪,松手吸边
     const toggle = useCallback(() => {
       if (open) { setOpen(false); return }
       setOpen(true); load(); go('home')
     }, [open, load, go])

     const onFabDown = (e) => {
       if (e.pointerType === 'mouse' && e.button !== 0) return
       // 记「起点指针位置 + 起点状态位」,拖动时按**增量**移动:
       // 宿主的浮层容器有缩放时,屏幕上的 1px 不等于状态位里的 1px,增量法才能两面对齐。
       drag.current = { sx: e.clientX, sy: e.clientY, fx: fab.x, fy: fab.y, moved: false }
       setDragging(true)
       try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老浏览器没有指针捕获 */ }
     }
     const onFabMove = (e) => {
       const d = drag.current
       if (!d) return
       const dx = e.clientX - d.sx
       const dy = e.clientY - d.sy
       if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
       // 祖先缩放比例(没有祖先/量不到就是 1)
       const s = (originOf(fabRect, fab).s) || 1
       const v = viewport()
       const c = clampFab(d.fx + dx / s, d.fy + dy / s, v.w, v.h)
       setFab((cur) => ({ ...cur, x: c.x, y: c.y }))
       // 拖动过程中让面板实时跟着走(读真实矩形,不猜)
       try {
         const el = fabEl.current
         if (el && typeof el.getBoundingClientRect === 'function') {
           const r = el.getBoundingClientRect()
           if (r && (r.width || r.height)) setFabRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
         }
       } catch { /* 量不到就等松手再量 */ }
     }
     const onFabUp = () => {
       const d = drag.current
       drag.current = null
       setDragging(false)
       if (!d) return
       if (!d.moved) { toggle(); return }        // 没拖动 = 点击
       const v = viewport()
       setFab((cur) => { const s = snapFab(cur, v.w, v.h); saveFab(s); return s })
     }

     /** 量浮标在视口里的真实位置。用 getBoundingClientRect:宿主的浮层容器有
      *  transform/缩放/滚动都不影响,算出来的是「屏幕上真正在哪」。 */
     const measureFab = useCallback(() => {
       const el = fabEl.current
       if (!el || typeof el.getBoundingClientRect !== 'function') { setFabRect(fabRectOf(fab)); return }
       const r = el.getBoundingClientRect()
       if (!r || (!r.width && !r.height)) { setFabRect(fabRectOf(fab)); return }
       setFabRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
     }, [fab])

     // 打开时、拖动结束后、窗口变化时都要重新量;面板开着时浮标一挪就跟着挪
     useEffect(() => { measureFab() }, [measureFab, open, dragging])
     // 浮标一挪或面板开关一次,微调量归零重算(否则会带着旧位移量越跑越偏)
     useEffect(() => { shiftTries.current = 0; setPanelShift({ dx: 0, dy: 0 }) }, [open, fabRect])
     // 宿主容器一旦有 transform,position:fixed 的参照物会跟着它滚;滚动/缩放都要重新量,
     // 否则面板会在你把聊天区滚上去之后慢慢飘出屏幕。
     useEffect(() => {
       const remeasure = () => measureFab()
       window.addEventListener('resize', remeasure)
       window.addEventListener('scroll', remeasure, true)
       const vv = window.visualViewport
       if (vv) { vv.addEventListener('resize', remeasure); vv.addEventListener('scroll', remeasure) }
       return () => {
         window.removeEventListener('resize', remeasure)
         window.removeEventListener('scroll', remeasure, true)
         if (vv) { vv.removeEventListener('resize', remeasure); vv.removeEventListener('scroll', remeasure) }
       }
     }, [measureFab])

     /**
      * 兜底:P1 算出来之后,再拿面板自己的**真实矩形**对一次视口。
      * 任何祖先有 transform / 缩放 / 滚动,或者宿主改了浮层容器尺寸,都能被这一步拉回屏幕内
      * (translate 反复微调,最多 8 次,必然收敛)。这条是「绝不出屏」的最后保险。
      */
     useEffect(() => {
       if (!open || !state) return
       const el = panelEl.current
       if (!el || typeof el.getBoundingClientRect !== 'function') return
       const v = viewport()
       const r = el.getBoundingClientRect()
       if (!r.width || !r.height) return
       const { dx, dy } = nudgeIntoView(r, v.w, v.h, 8)
       if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
       if (shiftTries.current >= 8) return
       shiftTries.current += 1
       // translate 也在祖先坐标系里,先换算回本地单位,否则缩放后会被放大/缩小
       const s = (originOf(fabRect, fab).s) || 1
       setPanelShift((cur) => ({ dx: cur.dx + dx / s, dy: cur.dy + dy / s }))
     }, [open, state, fabRect, panelShift])

     // 触屏和鼠标拖动都走 pointer 事件
     const onPointerDown = (e) => {
       touch.current = { x: e.clientX, y: e.clientY, t: Date.now() }
     }
     const onPointerUp = (e) => {
       if (!touch.current.t) return
       const dx = e.clientX - touch.current.x
       const dy = e.clientY - touch.current.y
       touch.current = { x: 0, y: 0, t: 0 }
       if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1)
     }

     /**
      * 存完给一条回执,并且允许撤销 —— 存错类别是最常见的一次性失误:
      * 撤销会删掉刚建的那条,把原话塞回输入框,改个说法就能重来。
      */
     const onCaptureDone = useCallback((r) => {
       if (!r) return
       const c = r.created
       const raw = (r.parsed && (r.parsed.raw || r.parsed.text)) || ''
       let undo = null
       // 去重命中时没有「新建」这回事,别给出会删掉旧便签的撤销
       if (c && c.kind === 'link' && c.id && !c.deduped) undo = { action: 'link.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'note' && c.id && !c.deduped) undo = { action: 'note.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'reminder' && c.id && !c.deduped) undo = { action: 'reminder.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'secret' && c.id) undo = { action: 'secret.delete', payload: { query: c.id }, after: () => setSeed(raw) }
       // 刚建出来的这条可以在回执里直接改分类(去重命中时挪的是旧条目,不给)
       const move = c && c.id && !c.deduped ? { kind: c.kind, id: c.id } : null
       showReply(r.reply || '已保存', undo, move)
       if (r.parsed && r.parsed.kind === 'link') { setDir('left'); setPage('links'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'secret') { setDir('left'); setPage('vault'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'note') { setDir('left'); setPage('notes'); setSeq((s) => s + 1) }
       else setPage('home')
     }, [showReply])

     const onLink = useCallback(async (r) => {
       const v = window.prompt('粘贴要打开的网址(留空可清除)', r.url || '')
       if (v === null) return
       await run('reminder.update', { id: r.id, url: String(v).trim() })
       showReply(String(v).trim() ? '已绑定打开链接' : '已清除链接')
     }, [run, showReply])

     const fabStyle = { left: Math.round(fab.x) + 'px', top: Math.round(fab.y) + 'px' }
     const fabNode = h('button', {
       key: 'fab', ref: fabEl,
       className: '__dk_fab' + (dragging ? ' __dk_dragging' : ''),
       title: '随手台 · 按住可拖动,松手吸边;点一下开合',
       onPointerDown: onFabDown, onPointerMove: onFabMove, onPointerUp: onFabUp, onPointerCancel: onFabUp,
     }, [h(Ico, { key: 'i', name: 'clipboard', size: 21 }), (state ? dueCount(state) : 0) ? h('span', { key: 'b', className: '__dk_badge' }, String(dueCount(state))) : null])

     if (!state) {
       // 装了侧栏标签页时连首屏这一下都不闪浮标(设置里显式开浮标的等状态加载后自然出现)
       if (sidebar.ready) return null
       return h('div', { className: '__dk_root', style: fabStyle }, [
         err ? h('div', { key: 'e', className: '__dk_err' }, err) : null,
         fabNode,
       ])
     }

     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const due = dueCount(state)
     // 浮标只是兜底入口:侧栏标签页在的时候默认不画,免得挡视线。
     // 但**到点提醒不能跟着消失** —— 只留 toast,不带浮标和面板。
     const showFab = floatEnabled(state, sidebar.ready)
     const goTo = go
     const lv = LEVELS[page] || LEVELS.home
     const body = (() => {
       const notify = showReply
       if (page === 'home') return [h(CaptureBar, { key: 'cap', run, onDone: onCaptureDone, seed, onSeedUsed: () => setSeed('') }), h(Home, { key: 'home', state, run, onLink, onGo: goTo, notify })]
       if (page === 'reminders') return [h(RemindersPage, { key: 'r', state, run, notify })]
       if (page === 'notes') return [h(NotesPage, { key: 'n', state, run, notify })]
       if (page === 'links') return [h(LinksPage, { key: 'w', state, run, notify })]
       if (page === 'vault') return [h(VaultPage, { key: 'v', state, run, notify })]
       return [h(Settings, { key: 's', state, run, sidebarReady: sidebar.ready })]
     })()

     return h(React.Fragment, null, [
       // 浮标开着时把坞抬高,别跟它叠在同一个角落
       h(AlertDock, {
         key: 'dock', alerts, run,
         onOpen: () => { if (sidebar.open) { sidebar.open(); return } setOpen(true) },
         offsetBottom: showFab ? 62 : 0,
         onAllAck: () => showReply('全部标为已读', { action: 'alert.unackAll', payload: {} }),
       }),

       showFab ? h('div', { key: 'root', className: '__dk_root', style: fabStyle }, [
         open ? h('div', {
           key: 'panel', ref: panelEl, className: '__dk_panel',
           style: Object.assign(
             (() => {
               const v = viewport()
               const rect = fabRect || fabRectOf(fab)
               const box = layoutPanel(rect, v.w, v.h)
               const local = toLocal(box, originOf(fabRect, fab))
               return {
                 left: Math.round(local.left) + 'px', top: Math.round(local.top) + 'px',
                 width: Math.round(local.width) + 'px', height: Math.round(local.height) + 'px',
               }
             })(),
             panelShift.dx || panelShift.dy ? { transform: 'translate(' + Math.round(panelShift.dx) + 'px,' + Math.round(panelShift.dy) + 'px)' } : null,
           ),
         }, [
           h('div', { key: 'h', className: '__dk_head' }, [
             h('div', { key: 't', className: '__dk_title' }, [
               TITLES[page] || '随手台',
               h('span', { key: 'l', className: '__dk_lvl', style: { color: lv.color }, title: '重要等级:' + lv.name }, [
                 h('i', { key: 'i' }), lv.code + ' ' + lv.name,
               ]),
             ]),
             h('div', { key: 'act', className: '__dk_headact' }, [
               h('button', {
                 key: 's', className: '__dk_icobtn' + (page === 'settings' ? ' on' : ''), title: '设置',
                 onClick: () => go('settings'),
               }, h(Ico, { name: 'gear', size: 16 })),
               h('button', { key: 'x', className: '__dk_icobtn', title: '关闭 (Esc)', onClick: () => setOpen(false) }, h(Ico, { name: 'x', size: 17 })),
             ]),
           ]),            h('div', { key: 'body', className: '__dk_body', onPointerDown, onPointerUp }, [
             h(ReplyBar, { key: 'reply', reply, run, onClear: () => showReply('') }),
             h(ReplyMove, { key: 'rmove', reply, run, onSay: (t) => showReply(t) }),
             err ? h('div', { key: 'err', className: '__dk_err' }, err) : null,
             // key 带 seq:切页整块重建,滑屏动画才会重放
             h('div', { key: 'page-' + page + '-' + seq, className: '__dk_page __dk_page--' + dir },
               h(SafePage, null, body)),
           ]),
           h(TabBar, { key: 'tabbar', page, go, due }),
         ]) : null,
         fabNode,
       ]) : null,
     ])
   }

   // ---------------------------------------------------------------- 侧边栏页面(dsh-better-sidebar)
   /**
    * 侧栏桥:better-sidebar 服务可能比本插件晚就绪,也可能先就绪后卸载。
    * 每次 apply 建一个实例,由槽位闭包与 effect 持有 —— 不再用模块级可变布尔量。
    */
   function createSidebarBridge() {
     const listeners = new Set()
     let state = { ready: false, open: null }
     return {
       read() { return state },
       write(next) {
         state = next
         for (const fn of [...listeners]) {
           try { fn(state) } catch (error) { /* 一个订阅者渲染出错不能连累其他订阅者 */ }
         }
       },
       subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
     }
   }

   /** 订阅侧栏桥:标签页就绪与否会改变浮标是否兜底,渲染必须跟着走 */
   function useSidebarBridge(bridge) {
     const [snapshot, setSnapshot] = useState(() => (bridge ? bridge.read() : { ready: false, open: null }))
     useEffect(() => {
       if (!bridge) return undefined
       setSnapshot(bridge.read())
       return bridge.subscribe(setSnapshot)
     }, [bridge])
     return snapshot
   }

   /** 浮标开不开放:settings.floatFab 显式 true 才开;没设过时只在没有侧栏服务时兜底开 */
   function floatEnabled(state, sidebarReady) {
     const v = state && state.settings ? state.settings.floatFab : undefined
     if (v === true) return true
     if (v === false) return false
     return !sidebarReady
   }

   function SidebarIcon({ size }) {
     return h(Ico, { name: 'clipboard', size: size || 16 })
   }

   function SidebarPage({ visible, bridge }) {
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [page, setPage] = useState('home')
     const [seq, setSeq] = useState(0)
     const [reply, setReply] = useState(null)
     // 撤销后回填到输入框的原话
     const [seed, setSeed] = useState('')
     const timer = useRef(null)

     const load = useCallback(async () => {
       try { setState(await apiGet()); setErr('') } catch (e) { setErr(String((e && e.message) || e)) }
     }, [])
     useAlertSound(state && state.settings, state && state.alerts)

     // 侧栏标签页没打开时完全不轮询(以前后台也每 20 秒拉一遍全量)
     useEffect(() => {
       if (!visible) return undefined
       load()
       const t = setInterval(load, 20000)
       return () => clearInterval(t)
     }, [visible, load])

     const run = useCallback(async (action, payload) => {
       try {
         const body = await apiPost(action, payload)
         if (body.state) setState(body.state)
         setErr('')
         return body
       } catch (e) { setErr(String((e && e.message) || e)); return null }
     }, [])

     // notify(text) 									只报一句
     // notify(text, {action, payload}) 		顺手给一个「撤销」,6 秒内可点
     const showReply = useCallback((text, undo, move) => {
       setReply(text ? { text: text, undo: undo || null, move: move || null } : null)
       if (timer.current) clearTimeout(timer.current)
       if (!text) return
       timer.current = setTimeout(() => setReply(null), undo ? 6000 : 3500)
     }, [])

     const go = useCallback((next) => { setPage(next); setSeq((s) => s + 1) }, [])

     const onCaptureDone = useCallback((r) => {
       if (!r) return
       const c = r.created
       const raw = (r.parsed && (r.parsed.raw || r.parsed.text)) || ''
       let undo = null
       // 去重命中时没有「新建」这回事,别给出会删掉旧便签的撤销
       if (c && c.kind === 'link' && c.id && !c.deduped) undo = { action: 'link.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'note' && c.id && !c.deduped) undo = { action: 'note.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'reminder' && c.id && !c.deduped) undo = { action: 'reminder.delete', payload: { id: c.id }, after: () => setSeed(raw) }
       else if (c && c.kind === 'secret' && c.id) undo = { action: 'secret.delete', payload: { query: c.id }, after: () => setSeed(raw) }
       // 刚建出来的这条可以在回执里直接改分类(去重命中时挪的是旧条目,不给)
       const move = c && c.id && !c.deduped ? { kind: c.kind, id: c.id } : null
       showReply(r.reply || '已保存', undo, move)
       if (r.parsed && r.parsed.kind === 'link') { setPage('links'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'secret') { setPage('vault'); setSeq((s) => s + 1) }
       else if (r.parsed && r.parsed.kind === 'note') { setPage('notes'); setSeq((s) => s + 1) }
       else setPage('home')
     }, [showReply])

     const onLink = useCallback(async (r) => {
       const v = window.prompt('粘贴要打开的网址(留空可清除)', r.url || '')
       if (v === null) return
       await run('reminder.update', { id: r.id, url: String(v).trim() })
       showReply(String(v).trim() ? '已绑定打开链接' : '已清除链接')
     }, [run, showReply])

     return h(SidebarView, {
       state, page, seq, reply, err, run, bridge,
       onGo: go, onCaptureDone, onLink,
       notify: showReply,
       onClearReply: () => showReply(''),
       seed,
       onSeedUsed: () => setSeed(''),
     })
   }

   /** 侧栏页面的纯展示部分:状态由 SidebarPage 喂进来(这样能脱离浏览器直接测)。 */
   function SidebarView({ state, page, seq, reply, err, run, onGo, onCaptureDone, onLink, onClearReply, notify, seed, onSeedUsed, bridge }) {
     const sidebar = useSidebarBridge(bridge)
     const goTo = onGo
     if (!state) {
       return h('div', { className: '__dk_sp' }, [
         h('div', { key: 'b', className: '__dk_spbody' }, err ? h('div', { className: '__dk_err' }, err) : h('div', { className: '__dk_hint' }, '正在读取…')),
       ])
     }

     const due = dueCount(state)
     const lv = LEVELS[page] || LEVELS.home
     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const body = (() => {
       // notify 由 SidebarPage 注入(这里没有自己的 showReply)
       if (page === 'home') return [h(CaptureBar, { key: 'cap', run, onDone: onCaptureDone, seed, onSeedUsed: () => setSeed('') }), h(Home, { key: 'home', state, run, onLink, onGo: goTo, notify })]
       if (page === 'reminders') return [h(RemindersPage, { key: 'r', state, run, notify })]
       if (page === 'notes') return [h(NotesPage, { key: 'n', state, run, notify })]
       if (page === 'links') return [h(LinksPage, { key: 'w', state, run, notify })]
       if (page === 'vault') return [h(VaultPage, { key: 'v', state, run, notify })]
       return [h(Settings, { key: 's', state, run, sidebarReady: sidebar.ready })]
     })()
     // 顶部横排:首页放第一格(浮标里的底部导航是另一套顺序,各用各的)
     const tabs = SIDEBAR_ORDER.map((id) => h('button', {
       key: id,
       className: '__dk_stab' + (page === id ? ' on' : ''),
       title: PANEL_LABELS[id],
       onClick: () => onGo(id),
     }, [h(Ico, { key: 'i', name: PANEL_ICONS[id], size: 16 }), h('span', { key: 'l' }, PANEL_LABELS[id])]))

     return h('div', { className: '__dk_sp' }, [
       h('div', { key: 'head', className: '__dk_sphead' }, [
         h('div', { key: 't', className: '__dk_sptitle' }, [
           '随手台',
           h('span', { key: 'l', className: '__dk_lvl', style: { color: lv.color }, title: '重要等级:' + lv.name }, [h('i', { key: 'i' }), lv.code + ' ' + lv.name]),
           due ? h('span', { key: 'd', className: '__dk_spdot' }, String(due)) : null,
         ]),
         h('div', { key: 'v', className: '__dk_note', title: 'Ctrl/Cmd+Shift+K 也能直接跳到这里' },
           fmtDay(state.today) + (due ? ' · ' + due + ' 项待办' : ' · 暂无待办')),
       ]),
       h('div', { key: 'nav', className: '__dk_spnav' }, tabs),
       h('div', { key: 'body', className: '__dk_spbody' }, [
         // 提醒主视觉在右下角提醒坞;这里只留一条紧凑状态条,不重复堆卡片
         h(AlertInline, { key: 'alerts', alerts, run }),
         h(ReplyBar, { key: 'reply', reply, run, onClear: onClearReply }),
         h(ReplyMove, { key: 'rmove', reply, run, onSay: onClearReply ? (t) => showReply(t) : null }),
         err ? h('div', { key: 'err', className: '__dk_err' }, err) : null,
         h('div', { key: 'page-' + page + '-' + seq, className: '__dk_page' }, h(SafePage, null, body)),
       ]),
     ])
   }

   /**
    * 设置 → 插件 里的入口卡片(plugins.bundle.config / plugins.row.config)。
    * 为什么要有:随手台的主入口是侧栏标签页,不装侧栏插件时是右下角浮标 ——
    * 两种都藏在「界面」里,而人找设置第一反应是「设置 → 插件」。这里放一张真正的
    * 控制面板:版本、当前存量、三个开关、备份,和「打开随手台」。
    */
   function PluginCard({ view }) {
     const [state, setState] = useState(null)
     const [err, setErr] = useState('')
     const [busy, setBusy] = useState(false)
     useEffect(() => {
       let alive = true
       apiGet().then((st) => { if (alive) setState(st) }).catch((e) => { if (alive) setErr(String((e && e.message) || e)) })
       return () => { alive = false }
     }, [])
     const set = async (patch) => {
       setBusy(true)
       try {
         const body = await apiPost('settings.update', patch)
         if (body && body.state) setState(body.state)
       } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
     }
     const open = () => { try { requestOpen() } catch (e) { setErr('叫不醒面板:' + String((e && e.message) || e)) } }
     const backup = async () => {
       try {
         const r = await fetch(API + '/export', { headers: HEAD })
         const data = await r.json()
         const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' })
         const a = document.createElement('a')
         a.href = URL.createObjectURL(blob)
         a.download = 'desk-kit-backup-' + new Date().toISOString().slice(0, 10) + '.json'
         a.click()
         setTimeout(() => URL.revokeObjectURL(a.href), 5000)
       } catch (e) { setErr('导出失败:' + String((e && e.message) || e)) }
     }
     if (view === 'summary') {
       const c = state
       return h('span', { className: '__dk_hint' }, c
         ? [c.reminderCounts.active + ' 条提醒 · ' + c.noteCounts.active + ' 张便签 · ' + c.linkCounts.active + ' 个网页 · ' + (c.secrets || []).length + ' 条凭据'].join('')
         : '提醒 · 便签 · 网页 · 保险库')
     }
     const s2 = state || {}
     const settings = s2.settings || {}
     const counts = [
       ['提醒', (s2.reminderCounts || {}).active || 0],
       ['便签', (s2.noteCounts || {}).active || 0],
       ['网页', (s2.linkCounts || {}).active || 0],
       ['凭据', (s2.secrets || []).length],
     ]
     return h('div', { className: '__dk_card' }, [
       h('div', { key: 'h', className: '__dk_cardtop' }, [
         h('span', { key: 'v', className: '__dk_cardtitle' }, '随手台'),
         h('span', { key: 'ver', className: '__dk_hint' }, 'v' + VERSION),
       ]),
       h('div', { key: 'c', className: '__dk_cardcounts' }, counts.map(([label, n]) =>
         h('span', { key: label, className: '__dk_cardcount' }, [h('b', { key: 'n' }, String(n)), h('span', { key: 'l' }, label)]))),
       h('div', { key: 'sw', className: '__dk_cardrows' }, [
         h('div', { key: 's1', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '到点提示音'),
           h('button', { key: 'b', className: '__dk_switch' + (settings.sound !== false ? ' on' : ''), disabled: busy, title: '到点了响一声', onClick: () => set({ sound: settings.sound === false }) }),
         ]),
         h('div', { key: 's2', className: '__dk_cardrow' }, [
           h('span', { key: 'l' }, '网页用网站图标'),
           h('button', { key: 'b', className: '__dk_switch' + (settings.linkFavicons ? ' on' : ''), disabled: busy, title: '会联网去 icons.duckduckgo.com 取', onClick: () => set({ linkFavicons: !settings.linkFavicons }) }),
         ]),
       ]),
       h('div', { key: 'a', className: '__dk_frow' }, [
         h('button', { key: 'o', className: '__dk_btn p', onClick: open }, '打开随手台'),
         h('button', { key: 'b', className: '__dk_btn', onClick: backup }, [h(Ico, { key: 'i', name: 'download', size: 14 }), ' 备份']),
       ]),
       h('div', { key: 'k', className: '__dk_hint __dk_cardkbd' }, '也能用:侧栏「随手台」标签 · 会话顶栏的剪贴板图标 · Ctrl/Cmd+Shift+K · 在输入框敲 /desk-kit'),
       err ? h('div', { key: 'e', className: '__dk_err' }, err) : null,
     ])
   }

   const inject = ['slots']

   /**
    * 挂到 dsh-better-sidebar 的「侧边栏标签页」(软依赖):
    *   装了 —— 标签页是主入口,浮标默认让位;
    *   没装 —— sidebarReady=false,浮标自动兜底,不至于没有入口。
    * 服务可能比本插件晚就绪(装插件顺序 / HMR 都不定),所以监听 internal/service 再对一次。
    */
   function mountSidebarTab(ctx, bridge) {
     let current = null
     const release = () => {
       if (current) { try { current.dispose() } catch (error) { /* 已经卸载过 */ } }
       current = null
       bridge.write({ ready: false, open: null })
     }
     const reconcile = () => {
       const service = ctx.get && ctx.get('betterSidebar')
       if (current && current.service === service) return
       release()
       if (!service || typeof service.registerTab !== 'function') return
       let disposeTab = null
       try {
         disposeTab = service.registerTab({
           id: 'desk-kit:main',
           title: () => '随手台',
           description: () => '定时提醒 · 随手便签 · 加密保险库',
           icon: (size) => h(SidebarIcon, { size: size || 16 }),
           order: 40,
           single: true,
           component: (props) => h(SidebarPage, { visible: !!(props && props.visible), bridge }),
         })
       } catch (error) {
         disposeTab = null
       }
       if (typeof disposeTab !== 'function') return
       current = { service, dispose: disposeTab }
       bridge.write({
         ready: true,
         open: () => {
           try { service.openTab({ type: 'desk-kit:main', title: '随手台', reveal: true }); return true } catch (error) { return false }
         },
       })
     }
     reconcile()
     let off = null
     try {
       if (typeof ctx.on === 'function') off = ctx.on('internal/service', (name) => { if (name === 'betterSidebar') reconcile() })
     } catch (error) { /* 老宿主没有服务事件 */ }
     return () => {
       try { if (typeof off === 'function') off() } catch (error) { /* 取消失败不影响卸载 */ }
       release()
     }
   }

   function apply(ctx) {
     injectCss()
     if (!ctx) return
     // 每次 apply 一个桥:侧栏服务是否就绪、怎么把它叫到前面,都在这里
     const bridge = createSidebarBridge()
     // 先挂侧栏标签页:它决定浮标要不要兜底
     try {
       if (typeof ctx.effect === 'function') ctx.effect(() => mountSidebarTab(ctx, bridge))
       else mountSidebarTab(ctx, bridge)
     } catch (error) { /* 侧栏服务异常不能拖垮插件 */ }
     // 侧门统一走这条事件:优先把侧栏标签页叫到前面,没有侧栏时浮标自己接。
     // 监听归插件所有 —— dispose 时必须摘掉,否则重建插件会叠出多个监听。
     try {
       const onOpen = () => {
         const open = bridge.read().open
         if (typeof open === 'function') open()
       }
       if (typeof ctx.effect === 'function') {
         ctx.effect(() => {
           window.addEventListener(OPEN_EVENT, onOpen)
           return () => window.removeEventListener(OPEN_EVENT, onOpen)
         }, 'desk-kit: side-door listener')
       } else {
         window.addEventListener(OPEN_EVENT, onOpen)
       }
     } catch (error) { /* 没有 window(非浏览器环境)就算了 */ }
     if (!ctx.slots) return
     ctx.slots.inject('shell.overlay', () => ctx.slots.register(
       { name: 'shell.overlay', id: 'desk-kit-panel', order: 90, registrant: 'dsh-desk-kit' },
       () => h(Root, { bridge }),
     ))
     // 侧门 1:会话顶栏。写在流里,永远不会被别的悬浮窗盖住。
     // 老宿主没有这个槽时会 throw —— 顶栏图标没了不影响浮标照常用。
     try {
       ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
         { name: 'conversation.session.header.utilities', id: 'desk-kit-header', order: 20, registrant: 'dsh-desk-kit' },
         () => h(HeaderButton),
       ))
     } catch { /* 宿主没这个槽位:只保留浮标 */ }
     // 侧门 3:设置 → 插件 里的卡片。包页(bundle)和组件行(row)两个座位都占:
     // 宿主版本不同,能渲染出的那个不一样。
     for (const [slot, key] of [['plugins.bundle.config', 'dsh-desk-kit'], ['plugins.row.config', 'dsh-desk-kit#dsh-desk-kit']]) {
       try {
         ctx.slots.inject(slot, () => ctx.slots.register(
           { name: slot, key },   // 不声明 locale:卡片里没有需要翻译的文案
           (props) => h(PluginCard, { view: props && props.view }),
         ))
       } catch (error) { /* 宿主没有这个槽位:少一个入口,不影响主流程 */ }
     }
     // 侧门 4:斜杠命令 /desk-kit。手不用离开输入框。
     try {
       const commandUi = ctx.get && ctx.get('commandUi')
       const register = (command, name) => command.register({
         name,
         description: () => '打开随手台 / Open Desk Kit',
         available: () => true,
         ui: { kind: 'action', run: () => { try { requestOpen() } catch (e) { /* 面板不在也就算了 */ } } },
       })
       if (commandUi && typeof commandUi.register === 'function') {
         const off = register(commandUi, 'desk-kit')
         if (typeof ctx.effect === 'function' && typeof off === 'function') ctx.effect(() => off, 'desk-kit: slash command')
         // 中文命令名不是所有宿主都收,单独试,失败不影响上面的
         try {
           const offZh = register(commandUi, '随手台')
           if (typeof ctx.effect === 'function' && typeof offZh === 'function') ctx.effect(() => offZh, 'desk-kit: 中文命令')
         } catch (error) { /* 只认英文命令名 */ }
       }
     } catch (error) { /* 老宿主没有 commandUi */ }
     // 侧门 2:快捷键 Ctrl/Cmd+Shift+K。没有 shortcuts 服务时静默跳过。
     try {
       const shortcuts = ctx.get && ctx.get('shortcuts')
       if (shortcuts && typeof shortcuts.register === 'function') {
         const binding = { code: 'KeyK', modifiers: ['primary', 'shift'] }
         const defaults = Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux'].map((p) => [p, binding]))
         shortcuts.register({
           id: 'desk-kit.open', label: () => '打开随手台', aliases: [], defaults,
           regions: ['page'], modals: [],
           resolve: () => ({ status: 'handled', run: requestOpen }),
         })
       }
     } catch { /* 键位被占用/不在白名单:不注册 */ }
   }

   exports.apply = apply
   exports.inject = inject
   exports.__test = {
     Root, TabBar, Home, RemindersPage, NotesPage, VaultPage, Settings, ModelPicker, SafePage, CaptureBar, HeaderButton,
     Ico, PATHS, weekText, fmtClock, reminderMeta, CSS, ReplyBar, LEAD_PRESETS, ReminderForm, CYCLE, todayISO, alertHead,
     SidebarPage, SidebarView, SidebarIcon, floatEnabled, PANEL_LABELS, PANEL_ICONS, SIDEBAR_ORDER, ORDER,
     LinksPage, LinkTile, linkInitial, linkHue, linkHost, MoveChips, ReplyMove, MOVE_TARGETS, PluginCard,
     AlertDock, AlertCard, AlertInline, DOCK_MAX, DOCK_ROTATE_MS, dockSlice, fmtDay, alertMeta,
     clampFab, snapFab, defaultFab, viewport, FAB_SIZE, FAB_PAD, LEVELS, dueCount, requestOpen, OPEN_EVENT,
     layoutPanel, fabRectOf, originOf, toLocal, nudgeIntoView,
     playChime, SOUND, useAlertSound,
   }
   return module.exports
 },
})