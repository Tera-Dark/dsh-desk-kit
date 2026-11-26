/**
 * dsh-desk-kit · 提醒域
 *
 * 提醒的增删改、今日视图、到点扫描(tick)与告警确认,靠 mixin 挂到
 * DeskStore.prototype 上:this.data / this.save() / 时间计算全部照旧。
 */
import {
  ALERT_KEEP_MS, MAX_CHECKINS, uid,
} from '../store.js'
import {
  beforeCreated, isRealDate, localYmd, occurrenceOf, nextOccurrence, parseClock,
} from '../time.js'

/** 挂到原型上的提醒方法。 */
export const reminders = {

  addReminder(input = {}) {
    const title = String(input.title || '').trim()
    if (!title) throw new Error('提醒标题不能为空')
    const clock = parseClock(input.time)
    if (!clock) throw new Error('时间格式必须是 HH:MM,例如 21:00')
    const days = Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : []
    const now = Date.now()
    // 两种入口统一:lunar 对象(面板) 或 lunarMonth/lunarDay(工具/API 简写)
    const lunarIn = input.lunar
      || (Number.isFinite(Number(input.lunarMonth)) && Number.isFinite(Number(input.lunarDay))
        ? { month: Number(input.lunarMonth), day: Number(input.lunarDay) }
        : null)
    const reminder = {
      id: uid('r-'),
      title: title.slice(0, 120),
      note: String(input.note || '').slice(0, 2000),
      time: String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0'),
      weekdays: days,
      date: (() => {
        if (input.date === undefined || input.date === null || input.date === '') return undefined
        const d = String(input.date)
        // 以前只验格式:2026-02-30 会原样存下,那天永远不存在,提醒也不会响
        if (!isRealDate(d)) throw new Error('日期不存在:' + d)
        return d
      })(),
      // 农历每年(生日):{month,day,isLeap}
      lunar: lunarIn && Number.isFinite(Number(lunarIn.month)) && Number.isFinite(Number(lunarIn.day))
        ? { month: Math.max(1, Math.min(12, Number(lunarIn.month))), day: Math.max(1, Math.min(30, Number(lunarIn.day))), isLeap: !!lunarIn.isLeap }
        : undefined,
      // 公历每年:'MM-DD'
      annual: typeof input.annual === 'string' && /^\d{2}-\d{2}$/.test(input.annual) ? input.annual : undefined,
      // 每月 N 号(交房租/信用卡这类)
      monthly: Number.isFinite(Number(input.monthly)) && Number(input.monthly) >= 1 && Number(input.monthly) <= 31
        ? Number(input.monthly)
        : undefined,
      // 每年重复标记(生日类),只用于展示
      yearly: !!input.yearly,
      // 上限 7 天:生日这类要提前几天提醒,原来卡在 720 分钟(12h)会让提前量失效
      leadMin: Number.isFinite(input.leadMin) ? Math.max(0, Math.min(10080, input.leadMin)) : 0,
      snoozeMin: Number.isFinite(input.snoozeMin) ? Math.max(1, Math.min(720, input.snoozeMin)) : 20,
      url: typeof input.url === 'string' && /^https?:\/\//i.test(input.url.trim()) ? input.url.trim().slice(0, 600) : '',
      active: true,
      doneDates: [],
      // 点过「知道了」的日期(YYYY-MM-DD):这一天不再提醒,但不是删掉
      silencedDates: [],
      snoozeUntil: 0,
      createdAt: now,
      updatedAt: now,
    }
    // 同一件事说两遍(或者换个写法再说一遍):返回已有那条,别再存一份。
    // 以前会存出两条一模一样的提醒,到点弹两次、列表里也是一对。
    const sig = (x) => [
      x.title, x.time, x.date || '', x.monthly || '', x.annual || '',
      x.lunar ? x.lunar.month + '-' + x.lunar.day : '', (x.weekdays || []).join(','),
    ].join('|')
    const same = this.data.reminders.find((x) => (x.deletedAt || 0) === 0 && sig(x) === sig(reminder))
    if (same) {
      same.updatedAt = now
      this.save()
      return { ...same, deduped: true }
    }
    // 新登记的重复提醒,如果今天这次的点在你登记之前就已经过去,别立刻说「你错过了」——
    // 下午三点登记「每天早上 7:50 吃药」,要的是从明早开始。
    //
    // 判断基准是「这次的点 vs 登记时间」,不写死某个日期:
    // 写 silencedDates 会把「今天」固化下来,测试和跨时区补算都按别的 now 查一次就错位;
    // 用 createdAt 推导,任何时候拿任意 now 来问都得到同一个答案。
    // 只超过 5 分钟以上才算「过去」:刚刚到点的那次照常响。一次性(明说了日期)不动。
    if (!reminder.date) {
      const todayAt = occurrenceOf(reminder, new Date(now))
      const dueFrom = todayAt ? todayAt.getTime() - (reminder.leadMin || 0) * 60000 : 0
      if (todayAt && dueFrom <= now - 5 * 60000) reminder.startTomorrow = true
    }
    this.data.reminders.push(reminder)
    this.save()
    return reminder
  },

  updateReminder(id, patch = {}) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    if (typeof patch.title === 'string' && patch.title.trim()) r.title = patch.title.trim().slice(0, 120)
    if (typeof patch.note === 'string') r.note = patch.note.slice(0, 2000)
    if (patch.time !== undefined) {
      const clock = parseClock(patch.time)
      if (!clock) throw new Error('时间格式必须是 HH:MM')
      r.time = String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0')
    }
    if (Array.isArray(patch.weekdays)) r.weekdays = patch.weekdays.map(Number).filter((d) => d >= 0 && d <= 6)
    if (Number.isFinite(patch.leadMin)) r.leadMin = Math.max(0, Math.min(10080, patch.leadMin))
    if (Number.isFinite(patch.snoozeMin)) r.snoozeMin = Math.max(1, Math.min(720, patch.snoozeMin))
    if (typeof patch.active === 'boolean') r.active = patch.active
    if (typeof patch.url === 'string') {
      const u = patch.url.trim()
      r.url = /^https?:\/\//i.test(u) ? u.slice(0, 600) : ''
    }
    // 周期是互斥的:选了哪一种,就把其它的清掉。
    // 以前只清 date→其它,反向不清:把「明天」改成「每月 1 号」后 date 还压在上面。
    if (patch.lunar === null) r.lunar = undefined
    else if (patch.lunar && Number.isFinite(patch.lunar.month) && Number.isFinite(patch.lunar.day)) {
      r.lunar = { month: Math.max(1, Math.min(12, patch.lunar.month)), day: Math.max(1, Math.min(30, patch.lunar.day)), isLeap: !!patch.lunar.isLeap }
      r.date = undefined; r.monthly = undefined; r.annual = undefined; r.weekdays = []
    }
    if (patch.annual === null) r.annual = undefined
    else if (typeof patch.annual === 'string' && /^\d{2}-\d{2}$/.test(patch.annual)) {
      r.annual = patch.annual
      r.date = undefined; r.monthly = undefined; r.lunar = undefined; r.weekdays = []
    }
    if (patch.monthly === null) r.monthly = undefined
    else if (Number.isFinite(patch.monthly) && patch.monthly >= 1 && patch.monthly <= 31) {
      r.monthly = Number(patch.monthly)
      r.date = undefined; r.annual = undefined; r.lunar = undefined; r.weekdays = []
    }
    if (typeof patch.date === 'string' && patch.date) {
      if (!isRealDate(patch.date)) throw new Error('日期不存在:' + patch.date)
      r.date = patch.date
      r.weekdays = []; r.annual = undefined; r.lunar = undefined; r.monthly = undefined
    }
    if (patch.date === null) r.date = undefined
    // 改了时间点/周期 = 用户还想让它响,今天的静音作废
    const touchedSchedule = patch.time !== undefined || Array.isArray(patch.weekdays) || patch.date !== undefined
      || patch.monthly !== undefined || patch.annual !== undefined || patch.lunar !== undefined
    if (touchedSchedule) r.silencedDates = []
    if (typeof patch.yearly === 'boolean') r.yearly = patch.yearly
    if (typeof patch.calendar === 'string') r.calendar = patch.calendar === 'lunar' ? 'lunar' : 'solar'
    r.updatedAt = Date.now()
    this.save()
    return r
  },

  /** 删除 = 移入垃圾箱(可恢复)。要真删用 purgeReminder。 */
  deleteReminder(id) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    r.deletedAt = Date.now()
    r.active = false
    r.updatedAt = Date.now()
    // 未确认的告警一起撤掉,别在删完还弹
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && !a.acked))
    this.save()
    return { trashed: id, id, title: r.title }
  },

  /** 从垃圾箱恢复。 */
  restoreReminder(id) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    r.deletedAt = 0
    r.active = true
    r.updatedAt = Date.now()
    this.save()
    return r
  },

  /** 彻底删除(不可恢复)。 */
  purgeReminder(id) {
    const before = this.data.reminders.length
    const target = this.data.reminders.find((r) => r.id === id)
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id)
    if (this.data.reminders.length === before) throw new Error('找不到提醒 ' + id)
    this.data.alerts = this.data.alerts.filter((a) => a.refId !== id)
    this.dropFiles(target && target.files)
    this.save()
    return { purged: id, id }
  },

  /** 提醒分档计数(给界面用)。 */
  reminderCounts() {
    const rs = this.data.reminders
    const trashed = rs.filter((r) => (r.deletedAt || 0) > 0).length
    return { active: rs.length - trashed, trash: trashed }
  },

  /** 今日签到(可补签某天:date 传 YYYY-MM-DD)。 */
  checkin(id, date) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const day = date ? String(date).slice(0, 10) : localYmd()
    if (!r.doneDates.includes(day)) r.doneDates.push(day)
    if (r.doneDates.length > MAX_CHECKINS) r.doneDates = r.doneDates.slice(-MAX_CHECKINS)
    r.silencedDates = (r.silencedDates || []).filter((d) => d !== day)
    r.snoozeUntil = 0
    r.updatedAt = Date.now()
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && a.date === day))
    this.save()
    return { reminder: r, date: day }
  },

  /** 取消今天(或指定某天)的签到。 */
  uncheckin(id, date) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const day = date ? String(date).slice(0, 10) : localYmd()
    r.doneDates = (r.doneDates || []).filter((d) => d !== day)
    r.updatedAt = Date.now()
    this.data.alerts = this.data.alerts.filter((a) => !(a.refId === id && a.date === day))
    this.save()
    return { reminder: r, date: day }
  },

  /** 静音到某个时刻(点「稍后提醒」)。 */
  snooze(id, minutes, nowMs = Date.now()) {
    const r = this.data.reminders.find((x) => x.id === id)
    if (!r) throw new Error('找不到提醒 ' + id)
    const min = Number.isFinite(minutes) ? Math.max(1, Math.min(720, minutes)) : r.snoozeMin || 20
    r.snoozeUntil = nowMs + min * 60000
    // 点「稍后」就是要它再响一次,今天的静音先解除
    r.silencedDates = (r.silencedDates || []).filter((d) => d !== localYmd(new Date(nowMs)))
    this.save()
    return r
  },

  /** 今日各提醒状态(给 UI / Agent 看)。 */
  todayView(now = new Date()) {
    const today = localYmd(now)
    return this.data.reminders
      .filter((r) => !((r.deletedAt || 0) > 0))   // 垃圾箱里的不进主列表
      .map((r) => {
        // 用 nextOccurrence:生日/周几的提前量会跨天,occurrenceOf 只认"今天"
        let occ = nextOccurrence(r, now)
        // 一次性提醒今天的时间已经过了:nextOccurrence 说「没有下一次」,
        // 但 tick 当天还会补一张告警 —— 两边说法要一致,别一个「到点了」一个「没有下一次」。
        if (!occ) { const todayAt = occurrenceOf(r, now); if (todayAt) occ = todayAt }
        const dueDate = occ ? localYmd(occ) : today
        const done = (r.doneDates || []).includes(dueDate)
        const doneToday = (r.doneDates || []).includes(today)
        let status = 'idle'
        if (!r.active) status = 'paused'
        else if (done) status = 'done'
        // 登记之前就已经过去的点:今天不吵,理由挂在 startTomorrow 上给界面用。
        else if (occ && localYmd(occ) === today && beforeCreated(r, occ, now.getTime())) status = 'silenced'
        else if (occ && localYmd(occ) === today && (r.silencedDates || []).includes(today)) status = 'silenced'
        else if (!occ) status = r.date && r.date < today ? 'expired' : 'no-next'
        else if (now.getTime() >= occ.getTime() - (r.leadMin || 0) * 60000) status = 'pending'
        else status = 'upcoming'
        return {
          ...r,
          today,
          dueDate,
          startTomorrow: beforeCreated(r, occ, now.getTime()),
          done: done || doneToday,
          occurrenceAt: occ ? occ.getTime() : null,
          status,
          secondsLeft: occ ? Math.round((occ.getTime() - now.getTime()) / 1000) : null,
        }
      })
  },

  /**
   * 主循环:算出该不该弹提醒。
   * 返回这一轮新增的告警数(便于日志)。
   */
  tick(nowMs = Date.now(), opts = {}) {
    const now = new Date(nowMs)
    const today = localYmd(now)
    let created = 0
    let mutated = false
    const alerts = this.data.alerts
    for (const r of this.data.reminders) {
      if ((r.deletedAt || 0) > 0) continue      // 垃圾箱里的不提醒
      if (!r.active) continue
      let occ = nextOccurrence(r, now)          // 生日提前 3 天也要能算出来
      if (!occ) {
        // 一次性提醒的时间今天已经过了,nextOccurrence 会说「没有下一次」。
        // 于是「早上八点关机、晚上才开 DSH」就永远收不到 —— 当天内补一张。
        const todayAt = occurrenceOf(r, now)
        if (todayAt && todayAt.getTime() <= nowMs) occ = todayAt
      }
      if (!occ) continue
      const dueDate = localYmd(occ)
      if ((r.doneDates || []).includes(dueDate) || (r.doneDates || []).includes(today)) continue
      // 「知道了」= 今天这条不再提。之前 ack 只标记那条 alert,tick 20 分钟后又造一条新的,
      // 按钮写着「不再提醒」却在弹 —— 现在按日期记在提醒上。
      if ((r.silencedDates || []).includes(today)) continue
      // 这次的点早于登记时间(超过 5 分钟宽限):本来就不存在,不补「错过」。
      if (!r.date && beforeCreated(r, occ, nowMs)) continue
      const dueFrom = occ.getTime() - (r.leadMin || 0) * 60000
      if (nowMs < dueFrom) continue
      if (r.snoozeUntil && nowMs < r.snoozeUntil) continue
      const sameDay = alerts.filter((a) => a.refId === r.id && a.date === today)
      const last = sameDay.sort((a, b) => b.at - a.at)[0]
      // 同一条还没被确认:就地更新,不要再叠一张。
      // 以前逾期后每 snoozeMin 分钟 push 一条新的,十分钟后右下角就有三张一模一样的卡片。
      // 确认过的那张会被 silencedDates 挡住一整天,唯一还会再建新卡的是「稍后」到点。
      if (last && !last.acked) {
        if (nowMs >= occ.getTime() && !last.over) { last.over = true; mutated = true }
        if (r.snoozeUntil && nowMs >= r.snoozeUntil) { r.snoozeUntil = 0; mutated = true }
        continue
      }
      // 没有卡片,或者上一张已经确认过(「稍后」到点):建一张新的
      if (!last || last.acked) {
        alerts.push({
          id: uid('a-'),
          kind: 'reminder',
          refId: r.id,
          date: today,
          dueDate,
          title: r.title,
          text: r.note || '',
          at: nowMs,
          dueAt: occ.getTime(),
          over: nowMs >= occ.getTime(),
          // 超过一分钟才算「错过」(开机补算的、当天补的一次性提醒都走这条),
          // 界面上写「计划几点」,而不是假装刚刚到点。
          late: nowMs - dueFrom >= 60000,
          acked: false,
        })
        created++
      }
    }
    // 清理 7 天前的告警
    const cutoff = nowMs - ALERT_KEEP_MS
    this.data.alerts = alerts.filter((a) => a.at >= cutoff).slice(-300)
    // 到期的垃圾箱/孤儿附件:每 6 小时最多跑一次,不用等用户点
    let swept = null
    if (nowMs - (this.data.settings.lastSweepAt || 0) > 6 * 3600 * 1000) {
      try { swept = this.sweepTrash({ nowMs }) } catch { /* 清理失败不能连累提醒 */ }
    }
    if (created || mutated || swept) this.save()
    return created
  },

  ackAlert(id) {
    const a = this.data.alerts.find((x) => x.id === id)
    if (!a) return { acked: false }
    a.acked = true
    a.ackedAt = Date.now()
    // 同一天的其它未读也一起收掉,否则点一条还剩三条同标题的
    for (const other of this.data.alerts) {
      if (other.refId && other.refId === a.refId && other.date === a.date && !other.acked) {
        other.acked = true
        other.ackedAt = a.ackedAt
      }
    }
    if (a.refId && a.date) {
      const r = this.data.reminders.find((x) => x.id === a.refId)
      if (r) {
        r.silencedDates = Array.isArray(r.silencedDates) ? r.silencedDates : []
        if (!r.silencedDates.includes(a.date)) r.silencedDates.push(a.date)
        if (r.silencedDates.length > MAX_CHECKINS) r.silencedDates = r.silencedDates.slice(-MAX_CHECKINS)
        // 「今天点已过,明天开始」只在登记当天成立;之后自己点「知道了」不该再挂这句话
        r.startTomorrow = false
      }
    }
    this.save()
    return { acked: true, id, date: a.date || null }
  },

  ackAll() {
    const now = Date.now()
    const today = localYmd()
    for (const a of this.data.alerts) {
      if (a.acked) continue
      a.acked = true
      a.ackedAt = now
      // 「全部知道了」和单条 X 一样:今天不再提这些(否则 20 分钟后又是一堆卡片)
      if (a.refId && a.date) {
        const r = this.data.reminders.find((x) => x.id === a.refId)
        if (r) {
          r.silencedDates = Array.isArray(r.silencedDates) ? r.silencedDates : []
          if (!r.silencedDates.includes(a.date)) r.silencedDates.push(a.date)
          if (r.silencedDates.length > MAX_CHECKINS) r.silencedDates = r.silencedDates.slice(-MAX_CHECKINS)
          r.startTomorrow = false
        }
      }
    }
    // 告警的过期清理只在 tick 里做:tick 的 now 是可以注入的(测试、补算),
    // 这里用本机时钟会把「模拟时间」里的告警当成过期整批删掉,撤销就没得恢复了。
    void today
    this.save()
    return { acked: true, at: now }
  },

  /** 「全部知道了」的撤销:5 分钟内点撤销,把刚确认的那批恢复未读并解除当天静音。 */
  unackAll() {
    const now = Date.now()
    let restored = 0
    for (const a of this.data.alerts) {
      if (!a.acked || now - (a.ackedAt || 0) > 5 * 60000) continue
      a.acked = false
      a.ackedAt = 0
      restored++
      if (a.refId && a.date) {
        const r = this.data.reminders.find((x) => x.id === a.refId)
        if (r) r.silencedDates = (r.silencedDates || []).filter((d) => d !== a.date)
      }
    }
    this.save()
    return { restored }
  },

  pendingAlerts() {
    return this.data.alerts.filter((a) => !a.acked).sort((a, b) => b.at - a.at)
  },
}
