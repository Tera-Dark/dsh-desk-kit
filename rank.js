/**
 * dsh-desk-kit · 常用度排序
 *
 * 只回答「谁该排在前面」,不看存储、不改数据,喂任意 now 都能单独验证单调性。
 */
import { DAY_MS } from './time.js'

/** 半衰:多少天后权重剩一半。新东西衰减快(新鲜感过了就该让位),常用度衰减慢。 */
const HALF_FRESH_DAYS = 3
const HALF_USED_DAYS = 10

const decay = (at, now, halfDays) => {
  const t = Number(at) || 0
  if (!t) return 0
  const days = Math.max(0, (now - t) / DAY_MS)
  return Math.pow(0.5, days / halfDays)
}

/**
 * 一条记录的「注意力权重」:谁该排在前面。
 *
 * 三件事叠加,各自都想得明白:
 * 1. **新鲜**:刚建的、一次都没碰过的东西给 0.12(3 天半衰)。新东西本来就已经靠
 *    「新近」拿到高分,这一项只是让「刚存的」压过「很久没碰过的」,不该压过「刚点开过的」——
 *    所以它比「用过一次」的加成小。
 * 2. **新近**:最后一次被用到(看过 / 打开过 / 改过)有多近(10 天半衰)。
 * 3. **常用**:用过几次,对数饱和 —— 第 1 次就有明显加成,第 15 次之后不再涨,
 *    免得一条看了 200 遍的老记录永远压着别的。
 *
 * 置顶不在这里算:置顶是「我说了算」,永远在权重之上。
 */
export function attentionScore(x, now = Date.now()) {
  if (!x) return 0
  const created = Number(x.createdAt) || 0
  const used = Math.max(
    Number(x.lastViewedAt) || 0,
    Number(x.lastOpenedAt) || 0,
    Number(x.updatedAt) || 0,
    created,
  )
  const count = Math.max(Number(x.views) || 0, Number(x.hits) || 0)
  const fresh = count ? 0 : 0.12 * decay(created, now, HALF_FRESH_DAYS)
  const recent = 0.5 * decay(used, now, HALF_USED_DAYS)
  const often = 0.6 * Math.min(1, Math.log2(1 + count) / 4)
  return fresh + recent + often
}

/** 排序:置顶 → 权重 → 时间倒序(同分时 newest first,顺序才稳定)。 */
export function byAttention(a, b, now) {
  const pin = (Number(b.pinned) - Number(a.pinned))
  if (pin) return pin
  const d = attentionScore(b, now) - attentionScore(a, now)
  if (Math.abs(d) > 1e-9) return d
  return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
}

