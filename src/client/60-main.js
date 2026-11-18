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

