/**
 * dsh-desk-kit · 一句话解析器
 * 把用户随口一句中文判成 提醒 / 便签 / 保险库,并抽出时间、标题、账号密码。
 * 纯函数,不依赖 DSH。
 */

const CN_NUM = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const WEEK_CHARS = '日一二三四五六'
const WEEK_CLASS = '[日一二三四五六天]'

function cnToNum(text) {
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.length === 2 && text[0] === '十') return 10 + (CN_NUM[text[1]] ?? 0)
  if (text.length === 2 && text[1] === '十') return (CN_NUM[text[0]] ?? 0) * 10
  if (text.length === 3 && text[1] === '十') return (CN_NUM[text[0]] ?? 0) * 10 + (CN_NUM[text[2]] ?? 0)
  return CN_NUM[text] ?? null
}

export function localYmd(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function weekdayIndex(ch) {
  if (ch === '日' || ch === '天') return 0
  const i = WEEK_CHARS.indexOf(ch)
  return i < 0 ? null : i
}

/** 抽时间:10点 / 10:30 / 晚上9点 / 8点半 / 下午3点一刻 → {h,m} 或 null。 */
export function parseClock(text) {
  const m = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[:：点时]\s*(半|一刻|三刻|\d{1,2})?/.exec(text)
  if (!m) return null
  let h = cnToNum(m[2])
  if (h === null || h > 24) return null
  let mi = 0
  const tail = m[3]
  if (tail === '半') mi = 30
  else if (tail === '一刻') mi = 15
  else if (tail === '三刻') mi = 45
  else if (tail) mi = Number(tail)
  if (!Number.isFinite(mi) || mi > 59) mi = 0
  const period = m[1] || ''
  if ((period === '下午' || period === '傍晚' || period === '晚上') && h < 12) h += 12
  if (period === '中午' && h < 12) h = 12
  if (period === '凌晨' && h === 12) h = 0
  if (h >= 24) h = h % 24
  return { h, m: mi }
}

/** 中文数字/「半」→ 数字;认不出返回 null。 */
function numOrHalf(text) {
  if (text === '半') return 0.5
  const n = cnToNum(text)
  return n === null ? null : n
}

/**
 * 相对时间:「10 分钟后」「半小时后」「一个半小时后」「2 小时后」「90 分钟内」。
 * 这是口语里最常见的说法,以前一律落成便签。
 * @returns {{date:string,time:string,at:number}|null}
 */
export function parseRelative(text, now = new Date()) {
  const t = String(text || '')
  const m = /(\d{1,3}|半|[一两二三四五六七八九十]{1,3})\s*个?\s*(?:半\s*)?(分钟|分|小时|钟头)\s*(?:之?后|以后|之内|以内)/.exec(t)
  if (!m) return null
  let n = numOrHalf(m[1])
  if (n === null) return null
  // 「一个半小时」= 1.5 小时
  const halfAfter = /个?\s*半\s*(?:分钟|分|小时|钟头)/.test(m[0])
  const unit = m[2] === '分钟' || m[2] === '分' ? 60000 : 3600000
  if (halfAfter) n = Math.floor(n) + 0.5
  const at = new Date(now.getTime() + Math.round(n * unit))
  return {
    date: localYmd(at),
    time: String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0'),
    at: at.getTime(),
  }
}

/** 抽日期/重复:{date?, weekdays, repeat, monthly?}。 */
export function parseWhen(text, now = new Date()) {
  // 「下周三」按「下一个自然周的周三」算(周一为一周之始),不是「最近的周三」
  const nextWeek = /下(?:个)?(?:周|星期)([日一二三四五六天])/.exec(text)
  if (nextWeek) {
    const idx = weekdayIndex(nextWeek[1])
    if (idx !== null) {
      const mondayDelta = ((8 - now.getDay()) % 7) || 7
      const offsetInWeek = idx === 0 ? 6 : idx - 1
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayDelta + offsetInWeek)
      return { date: localYmd(d), weekdays: [], repeat: false, monthly: null }
    }
  }

  // 「每月 1 号」「每个月 15 日」
  const monthlyAt = /每(?:个)?月\s*(\d{1,2})\s*[号日]/.exec(text)
  if (monthlyAt) {
    const day = Number(monthlyAt[1])
    if (day >= 1 && day <= 31) return { date: null, weekdays: [], repeat: true, monthly: day }
  }

  const weekdays = []
  let repeat = /每[天日晚]|每日|天天/.test(text)
  if (/工作日/.test(text)) weekdays.push(1, 2, 3, 4, 5)

  const range = /周([日一二三四五六天])\s*(?:到|至|-|~)\s*周?([日一二三四五六天])/.exec(text)
  if (range) {
    const a = weekdayIndex(range[1])
    const b = weekdayIndex(range[2])
    if (a !== null && b !== null) {
      if (a <= b) for (let i = a; i <= b; i++) weekdays.push(i)
      else { for (let i = a; i <= 6; i++) weekdays.push(i); for (let i = 0; i <= b; i++) weekdays.push(i) }
    }
  } else {
    const single = /(?:周|星期)([日一二三四五六天])/.exec(text)
    if (single) {
      const idx = weekdayIndex(single[1])
      if (idx !== null) weekdays.push(idx)
      repeat = true
    }
  }

  let date = null
  if (!repeat && !weekdays.length) {
    let offset = null
    if (/大后天/.test(text)) offset = 3
    else if (/后天/.test(text)) offset = 2
    else if (/明天|明日/.test(text)) offset = 1
    else if (/今天|今日/.test(text)) offset = 0
    if (offset !== null) {
      date = localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
    }
  }
  const uniq = [...new Set(weekdays)].sort((a, b) => a - b)
  return { date, weekdays: uniq, repeat, monthly: null }
}

/** 去掉口语祈使词,留事项本体。 */
export function cleanTitle(text) {
  return String(text)
    .replace(/^\s*(?:请|帮我|麻烦你?|你)?\s*(?:提醒我|提醒一下|提醒|记得|别忘记|别忘了|叫我|记一下|记下|帮我记一下|帮我记|记|存一下|存起来|保存一下)\s*[:：,，]?\s*/g, '')
    .replace(/^\s*(?:请|帮我)\s*/g, '')
    .replace(/\s*(?:的时候|时)?\s*(?:提醒我|提醒一下|提醒|叫我|别忘了|记得)\s*我?\s*$/g, '')
    .replace(/[。!！~～\s]+$/g, '')
    .trim()
}

/** 「账号 demo_user」「密码:abc」这种取值;用 indexOf 避免动态正则转义。 */
/** 抽生日:支持「5月3日」「五月三号」「农历八月十五」。 */
export function parseBirthday(text, now = new Date()) {
  if (!/生日|诞辰|满月酒|周岁/.test(text)) return null
  const lunar = /农历|阴历|旧历/.test(text)
  let m = /(\d{1,2})\s*[月\-\/]\s*(\d{1,2})\s*[日号]?/.exec(text)
  if (m) {
    const mo = Number(m[1])
    const da = Number(m[2])
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return { lunar, month: mo, day: da, name: birthdayName(text) }
    }
  }
  const cn = /([一二三四五六七八九十]{1,3})\s*月\s*([一二三四五六七八九十]{1,3})\s*[日号]?/.exec(text)
  if (cn) {
    const mo = cnToNum(cn[1])
    const da = cnToNum(cn[2])
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 30) {
      return { lunar: true, month: mo, day: da, name: birthdayName(text) }
    }
  }
  return null
}

/** 从「X 的生日」里抠出人名。 */
function birthdayName(text) {
  const m = /(?:是|给)?\s*([^,，。\s]{1,12}?)\s*(?:的)?\s*(?:生日|诞辰)/.exec(text)
  if (m && m[1] && !/^\d+$/.test(m[1])) return m[1]
  return ''
}

function pickValue(text, names) {
  const lower = text.toLowerCase()
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase())
    if (idx < 0) continue
    const rest = text.slice(idx + name.length).replace(/^[\s:：=]+/, '')
    const value = rest.split(/[\s,，;；、|]/)[0]
    if (value && !/^(是|为|的)$/.test(value)) return value.replace(/[。!！~～]+$/, '')
  }
  return ''
}

const SECRET_WORDS = ['密码', '密钥', '口令', 'token', 'api key', 'apikey', '卡号', '身份证', '账号', '账户', '用户名', 'username', '登录']

/**
 * 从一串网址里认出站点名(用于提醒标题)。
 * api.example.org → example ; new.example.dev → example ; example.com → example
 */
export function siteTitle(url) {
  let host = ''
  try { host = new URL(url).hostname } catch { host = String(url).replace(/^https?:\/\//, '').split('/')[0] }
  host = host.toLowerCase().replace(/^www\./, '')
  const parts = host.split('.')
  // 常见子域前缀不值得当名字
  const junk = new Set(['api', 'up', 'new', 'console', 'dashboard', 'app', 'panel', 'www', 'm', 'profile'])
  let name = parts[0]
  if (junk.has(name) && parts.length > 2) name = parts[1]
  if (!name) name = host
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * 多站点批量签到:一句话里出现 ≥2 个网址 + 「签到/打卡/每天」时,
 * 拆成多条每日提醒,而不是原封不动存成一条便签。
 * @returns {{kind:'multi',sites:{url,title}[]}|null}
 */
export function parseMultiSite(text) {
  const raw = String(text || '')
  const urls = []
  const re = /https?:\/\/[^\s,，、;；"'<>)\]]+/gi
  let m
  while ((m = re.exec(raw)) !== null) {
    const u = m[0].replace(/[)。，,；;]+$/, '')
    if (!urls.includes(u)) urls.push(u)
  }
  if (urls.length < 2) return null
  if (!/签到|打卡|每日|每天|天天|daily/i.test(raw)) return null
  return { kind: 'multi', sites: urls.map((url) => ({ url, title: siteTitle(url) + ' 签到' })) }
}

/**
 * 便签正文:去掉口语前缀,但整句都是前缀时原样保留。
 * 以前「记一下:周末去修耳机」会把「记一下:」一起存进去,几百条之后搜什么都命中。
 */
export function stripNotePrefix(text) {
  const raw = String(text || '')
  const out = raw
    .replace(/^\s*(?:请|帮我|麻烦你?|你)?\s*(?:记一下|记下|记录一下|记录|存一下|存起来|保存一下|保存|存档|备忘(?:一下)?|备注一下)\s*[:：,，]?\s*/, '')
    .replace(/^\s*(?:请|帮我|麻烦你?)\s*/, '')
    .trim()
  return out || raw.trim()
}

/** 一句话 → 分类 + 字段。 */
export function parseCapture(raw, now = new Date()) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('说点什么再提交吧')

  // 0) 多站点批量签到:优先于一切(「这些站每天签到」这类)
  const multi = parseMultiSite(text)
  if (multi) return multi

  const clock = parseClock(text)
  const rel = parseRelative(text, now)
  const when = parseWhen(text, now)
  const link = (/(https?:\/\/[^\s,，]+)/i.exec(text) || [])[1] || ''
  const birthday = parseBirthday(text, now)
  const wantsReminder = /提醒|叫我|记得|别忘|签到|打卡|上课|开会|交(费|表|作业)|截止|deadline|要交|吃药|复习/.test(text)
  const wantsSecret = SECRET_WORDS.some((w) => text.toLowerCase().includes(w))

  // 0) 生日:每年重复,公历或农历
  if (birthday) {
    const who = birthday.name || cleanTitle(text) || '生日'
    return {
      kind: 'reminder',
      title: who.includes('生日') ? who : who + ' 的生日',
      time: clock ? String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0') : '09:00',
      lunar: birthday.lunar ? { month: birthday.month, day: birthday.day, isLeap: false } : undefined,
      annual: birthday.lunar ? undefined : String(birthday.month).padStart(2, '0') + '-' + String(birthday.day).padStart(2, '0'),
      weekdays: [],
      leadMin: 4320,
      yearly: true,
      calendar: birthday.lunar ? 'lunar' : 'solar',
      note: birthday.lunar ? '农历' + birthday.month + '月' + birthday.day + '日' : birthday.month + '月' + birthday.day + '日',
      raw: text,
    }
  }

  // 1) 保险库
  if (wantsSecret) {
    const password = pickValue(text, ['密码', '口令', 'password', 'pwd', '密钥', 'token', 'api key', 'apikey'])
    const username = pickValue(text, ['账号', '账户', '用户名', 'username', 'user', '手机号'])
    const url = (/(https?:\/\/[^\s,，]+)/.exec(text) || [])[1] || ''
    if (password || username || url) {
      const title = text
        .replace(/(账号|账户|用户名|username|user|密码|口令|password|pwd|密钥|token|api key|apikey|卡号|身份证|登陆|登录)(\s*[:：=]?\s*[^\s,，;；、|]+)?/gi, '')
        .replace(/(请|帮我|麻烦|把|存一下|存起来|保存|记一下|记下|记)/g, '')
        .replace(/[。!！~～\s]+$/g, '')
        .trim()
      return { kind: 'secret', title: (title || '未命名条目').slice(0, 40), username, password, url, note: text }
    }
  }

  // 2) 提醒:有明确时间点、相对时间、或「明天/周三/每月几号」这类有日期的说法
  const hasClock = !!clock
  const hasDate = !!rel || !!when.date || !!when.monthly || when.weekdays.length > 0
  const scheduled = hasClock || hasDate
  if (scheduled && (wantsReminder || (hasClock && (when.repeat || when.weekdays.length)) || when.monthly || rel)) {
    const stripped = text
      .replace(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[:：点时]\s*(半|一刻|三刻|\d{1,2})?/g, '')
      .replace(/(每天|每日|天天|工作日|大后天|后天|明天|明日|今天|今日)/g, '')
      .replace(/下(?:个)?(?:周|星期)[日一二三四五六天]/g, '')
      .replace(/周[日一二三四五六天](?:\s*(?:到|至|-|~)\s*周?[日一二三四五六天])?/g, '')
      .replace(/https?:\/\/[^\s,，]+/gi, '')
      .replace(/星期[日一二三四五六天]/g, '')
      .replace(/(\d{1,3}|半|[一两二三四五六七八九十]{1,3})\s*个?\s*(?:半\s*)?(?:分钟|分|小时|钟头)\s*(?:之?后|以后|之内|以内)/g, '')
      .replace(/下(?:个)?(?:周|星期)[日一二三四五六天]/g, '')
      .replace(/每(?:个)?月\s*\d{1,2}\s*[号日]/g, '')
    // 没给钟点(「明天提醒我打电话」「周三复盘」)默认上午 9 点,总比掉进便签强
    const time = clock
      ? String(clock.h).padStart(2, '0') + ':' + String(clock.m).padStart(2, '0')
      : (rel ? rel.time : '09:00')
    return {
      kind: 'reminder',
      title: cleanTitle(stripped) || '提醒',
      time,
      date: rel ? rel.date : when.date,
      weekdays: when.weekdays,
      monthly: when.monthly || undefined,
      leadMin: rel ? 0 : 30,
      url: link,
      note: '',
      raw: text,
      dateGuessed: !clock && !rel,
    }
  }

  if (wantsReminder && !scheduled) return { kind: 'note', text: stripNotePrefix(text), raw: text, missingTime: true }

  // 3) 便签:去掉「记一下 / 存档」这类前缀,但保留原话
  return { kind: 'note', text: stripNotePrefix(text), raw: text }
}

/** 给用户看的一句回执。 */
export function describeCapture(parsed) {
  if (parsed.kind === 'multi') {
    return '已整理成 ' + parsed.sites.length + ' 条每日签到提醒:' + parsed.sites.map((s) => s.title.replace(' 签到', '')).join('、')
  }
  if (parsed.kind === 'secret') {
    const bits = [parsed.username && '账号 ' + parsed.username, parsed.password && '密码已加密', parsed.url && '网址已存'].filter(Boolean)
    return '已进保险库:' + parsed.title + (bits.length ? '(' + bits.join(' · ') + ')' : '')
  }
  if (parsed.kind === 'reminder' && parsed.yearly) {
    const when = parsed.lunar
      ? '农历' + parsed.lunar.month + '月' + parsed.lunar.day + '日'
      : (parsed.annual || '')
    return '已排成每年提醒:' + parsed.title + ' · ' + when
  }
  if (parsed.kind === 'reminder' && parsed.monthly) {
    return '已排成每月提醒:' + parsed.title + ' · 每月 ' + parsed.monthly + ' 号 ' + parsed.time
      + (parsed.dateGuessed ? '(没说几点,先按 ' + parsed.time + ')' : '')
  }
  if (parsed.kind === 'reminder') {
    const when = parsed.date
      ? parsed.date
      : parsed.weekdays.length
        ? '周' + parsed.weekdays.map((d) => WEEK_CHARS[d]).join('、周')
        : '每天'
    // 只说了哪天、没说几点:得让人知道 9 点是我替你补的,不然到点没反应会以为没存上
    const tail = parsed.dateGuessed ? ' · 没说几点,先按 ' + parsed.time : ' ' + parsed.time
    return '已排成提醒:' + parsed.title + ' · ' + when + tail
  }
  return '已记成便签'
}
