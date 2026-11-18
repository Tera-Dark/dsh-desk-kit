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
