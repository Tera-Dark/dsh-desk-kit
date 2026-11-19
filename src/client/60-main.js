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
     home: { code: 'L1', name: '待行动', color: '#e5484d', hint: '今天/过点要你动手的' },
     links: { code: 'L2', name: '常用入口', color: 'var(--dsw-alias-brand-primary)', hint: '常点的站,一格格摆着' },
     reminders: { code: 'L1', name: '待行动', color: '#e5484d', hint: '到点会响的提醒' },
     notes: { code: 'L2', name: '记录', color: 'var(--dsw-alias-brand-primary)', hint: '正在跟进的事,记着不催' },
     vault: { code: 'L3', name: '备查', color: '#8b949e', hint: '存着不催,列表不摊明文' },
     settings: { code: 'L4', name: '配置', color: '#8b949e', hint: '一年点两次的地方' },
   }

   // 浮标可能被别的浮窗盖住,所以留了两条侧门:会话顶栏的小图标 + 快捷键。
   // 两条侧门都只发一条 window 事件,面板自己监听 —— 两棵 React 树不用共享状态。
   const OPEN_EVENT = 'desk-kit:open'
   // 手机主屏快捷方式进来时,除了打开面板,还要把首页输入框准备好
   const CAPTURE_EVENT = 'desk-kit:capture'
   function requestOpen() {
     try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)) } catch { /* 没有 window 就算了 */ }
   }

   /**
    * 深链:打开 ?dk=capture 后自动进首页、聚焦输入框;可带 ?text=... 预填。
    * 只处理一次,并把参数从地址栏抹掉 —— 刷新/再次打开主屏图标不会反复弹。
    * 事件重复发几轮是为了等 React 树挂载:面板和侧栏谁先接住都行,同 token 会去重。
    */
   function handleDeepLink() {
     if (typeof window === 'undefined' || !window.location) return false
     let url
     try { url = new URL(window.location.href) } catch { return false }
     if (url.searchParams.get('dk') !== 'capture') return false
     const text = String(url.searchParams.get('text') || '').slice(0, 2000)
     url.searchParams.delete('dk')
     url.searchParams.delete('text')
     const next = url.pathname + (url.search || '') + (url.hash || '')
     try { window.history.replaceState(null, '', next) } catch { /* 只读地址栏/沙箱:不影响打开 */ }
     const token = 'cap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
     requestOpen()
     let left = 10
     const fire = () => {
       try { window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: { text, token } })) } catch { /* 没有 window */ }
       if (--left > 0) setTimeout(fire, 120)
     }
     setTimeout(fire, 80)
     return true
   }

   /** 待办数:到点未完成的提醒 + 未确认提示。0 表示没东西催。 */
   function dueCount(state) {
     if (!state) return 0
     const alerts = (state.alerts || []).filter(() => !(state.settings && state.settings.muted))
     const pend = (state.reminders || []).filter((r) => r.status === 'pending' && !r.done)
     return pend.length + alerts.length
   }

