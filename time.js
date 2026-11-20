/**
 * dsh-desk-kit · 时间与日历
 *
 * 提醒的「下一次是哪天几点」全在这里算,不碰任何存储/状态,
 * 所以可以单独喂任意 now 验证,不用起 store、不用碰盘。
 *
 * 约定:一律用本地时区(YYYY-MM-DD / 当天 HH:MM),
 * 绝不用 toISOString —— 那是 UTC,晚上会串日。
 */
import { solar2lunar } from './lunar.js'

/** YYYY-MM-DD 是不是真实存在的一天(2026-02-30 / 2026-13-01 都要拒绝)。 */
export function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return false
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 本地 YYYY-MM-DD(不要用 toISOString:那是 UTC,晚上会串日)。 */
export function localYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

/** 解析 "HH:MM" → 当天该时刻;格式不合法返回 null。 */
export function parseClock(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim())
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

/**
 * 这次的点是不是早于「登记这条提醒」本身:早于它的点不该被说成「你错过了」。
 * 只在「问的时间已过登记时间」时成立 —— 拿一个早于登记的模拟时间去查(测试、补算)
 * 时按原样回答,免得把「未来」问成「过去」。
 */
export function beforeCreated(r, occ, nowMs) {
  if (!occ) return false
  const created = Number(r && r.createdAt) || 0
  if (!created || nowMs < created) return false
  return occ.getTime() < created - 5 * 60000
}

const mmddOf = (d) => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const lunarSpec = (r) => (r && r.lunar && Number.isFinite(r.lunar.month) && Number.isFinite(r.lunar.day) ? r.lunar : null)

/**
 * 这一天(本地日)是不是这条提醒的计划日 —— 只看日历,不看时间过没过。
 *
 * 分支顺序必须与写库口径一致:
 *   date 一次性 → lunar 农历每年 → annual 公历每年 → monthly 每月 N 号 → weekdays 周几(空 = 每天)
 * 前四种都是「只在这天」,后一种是「这天的某几个周几」。
 */
function matchesDay(r, day) {
  if (r.date) return r.date === localYmd(day)

  const lunar = lunarSpec(r)
  if (lunar) {
    const today = solar2lunar(day.getFullYear(), day.getMonth() + 1, day.getDate())
    return today.month === lunar.month && today.day === lunar.day
  }

  if (r.annual) return r.annual === mmddOf(day)

  // 每月 N 号:月末没有这一天(31 号遇到 4 月)按当月最后一天算
  if (Number.isFinite(r.monthly)) {
    const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
    return Math.min(r.monthly, lastDay) === day.getDate()
  }

  const days = Array.isArray(r.weekdays) ? r.weekdays : []
  if (days.length && !days.includes(day.getDay())) return false
  return true
}

/** 这条提醒在 day 那天的发生时刻(Date);不是计划日或时间写坏返回 null。 */
function occurrenceOn(r, day) {
  const clock = parseClock(r.time)
  if (!clock) return null
  if (!matchesDay(r, day)) return null
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.h, clock.m, 0, 0)
}

/**
 * 某条提醒今天的计划时刻(Date),不匹配返回 null。
 *
 * 支持四种重复方式:
 *   date       一次性(YYYY-MM-DD)
 *   lunarMonth/lunarDay  农历每年(生日):按今天换算成农历后比对
 *   annual     'MM-DD' 公历每年(生日)
 *   weekdays   周几,空数组 = 每天
 */
export function occurrenceOf(reminder, now = new Date()) {
  return occurrenceOn(reminder, now)
}

/**
 * 下一次发生(可能是未来几天)。
 *
 * occurrenceOf 只回答"今天是不是那天",所以 leadMin 一旦跨天(生日提前 3 天)
 * 就永远等到当天才提醒 —— 提前量形同虚设。这里补上"向前找":
 *   annual/lunar 最多找 400 天,weekdays 最多找 7 天,date 只看当天。
 */
export const DAY_MS = 86400000

export function nextOccurrence(reminder, now = new Date()) {
  const clock = parseClock(reminder.time)
  if (!clock) return null
  const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), clock.h, clock.m, 0, 0)

  // 一次性日期:今天就是今天,以后的就是那天(以前只认今天,明天的一次性提醒会变成
  // 「没有下一次」,首页看不见、状态也不对)
  if (reminder.date) {
    const today = localYmd(now)
    if (reminder.date < today) return null
    if (reminder.date === today) return at(now)
    const d = new Date(reminder.date + 'T00:00:00')
    return Number.isNaN(d.getTime()) ? null : at(d)
  }

  if (reminder.lunar || reminder.annual) {
    // 手改数据把 lunar 写坏了:旧行为是「永远不匹配」,别在这里悄悄降级成每天
    if (reminder.lunar && !lunarSpec(reminder)) return null
    // 公历每年要扫 4 年多:2 月 29 日的生日隔 4 年才有一次,400 天扫不到就变成「没有下一次」,
    // 那条提醒从此永远不响。农历一年一次,400 天足够。
    const span = reminder.annual ? 1500 : 400
    for (let i = 0; i < span; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (matchesDay(reminder, d)) return at(d)
    }
    return null
  }

  if (Number.isFinite(reminder.monthly)) {
    for (let i = 0; i < 62; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (matchesDay(reminder, d)) return at(d)
    }
    return null
  }

  const days = Array.isArray(reminder.weekdays) ? reminder.weekdays : []
  if (days.length) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (matchesDay(reminder, d)) return at(d)
    }
    return null
  }
  // 每天:今天这个点(已经过了也照答,由调用方决定「今天已过」怎么显示)
  return at(now)
}
