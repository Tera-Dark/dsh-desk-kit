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
   const VERSION = '1.14.0'
   // 和底部导航同序:提醒 便签 [首页] 网页 保险库,设置在最右(滑动可到)
   const ORDER = ['reminders', 'notes', 'home', 'links', 'vault', 'settings']
   // 侧栏页面顶部分类条用(和浮标里的底部导航是同一批页面,只是横排)
   const SIDEBAR_ORDER = ['home', 'links', 'reminders', 'notes', 'vault', 'settings']
   const PANEL_LABELS = { home: '首页', links: '网页', reminders: '提醒', notes: '便签', vault: '保险库', settings: '设置' }
   const PANEL_ICONS = { home: 'home', links: 'grid', reminders: 'bell', notes: 'note', vault: 'lock', settings: 'gear' }

