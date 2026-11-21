/**
 * dsh-desk-kit · 最近的失败
 *
 * 失败以前要么被空 catch 吞掉、要么只进宿主日志,用户看不到。
 * 这里留一个**内存里**的环形缓冲(不落盘、不进 data.json、不进快照),
 * 设置页点开能看到最近几条「什么时候、哪个动作、什么原因」。
 *
 * 只收 action + message 两个字段:
 *   - 不收 payload —— 保险库明文、账号密码绝不能因为「记个错」进日志;
 *   - message 落库前再脱敏一遍,顺手截短,免得一条超长报错把缓冲撑爆。
 */

/** 只留最近 20 条:够定位问题,又不至于变成一份无限增长的日志。 */
const MAX_ERRORS = 20
/** 单条 message 的上限:堆栈/超长 JSON 不该整段进内存。 */
const MAX_MESSAGE = 300

const ring = []

/** 看起来像凭据的片段一律打码:name=value / name: value 两种写法都盖住。 */
const SECRET_PATTERNS = [
  /\b(password|passwd|pwd|secret|token|api[-_]?key|authorization|bearer)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
  /\b(password|passwd|pwd|secret|token|api[-_]?key)\b\s+("[^"]*"|'[^']*'|\S+)/gi,
]

/** 长串 token / base64 / 十六进制(>=24 位)也当成敏感值处理。 */
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{24,}/g

export function redact(message) {
  let text = String(message == null ? '' : message)
  for (const re of SECRET_PATTERNS) text = text.replace(re, (_m, name) => name + '=***')
  text = text.replace(LONG_TOKEN, '***')
  // 换行/制表压成单个空格:设置页只有一行位置
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE)
}

/**
 * 记一条失败。
 * @param {string} action 哪个动作失败(如 'secret.add' / 'import.run' / 'tick')
 * @param {unknown} error  错误对象或一句话
 */
export function recordError(action, error) {
  const message = redact(error && error.message ? error.message : error)
  if (!message) return
  ring.push({ at: Date.now(), action: redact(String(action || 'unknown')).slice(0, 40), message })
  if (ring.length > MAX_ERRORS) ring.splice(0, ring.length - MAX_ERRORS)
}

/** 最近几条(新的在后),只回 at / action / message 三个字段。 */
export function recentErrors(limit = MAX_ERRORS) {
  const n = Math.max(0, Math.min(MAX_ERRORS, Number(limit) || 0))
  return n ? ring.slice(-n).map((e) => ({ at: e.at, action: e.action, message: e.message })) : []
}

/** 测试与「清空」按钮用:清掉缓冲。 */
export function clearErrors() {
  ring.length = 0
}
