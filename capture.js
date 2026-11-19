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

/**
 * 用户明确说了「提前 X 分钟/小时」才提前;没说就 0(到点提醒)。
 * 以前的默认 30 分钟是替用户做决定,生日/签到都被提前,和记录习惯冲突。
 */
export function parseLeadMin(text) {
  const m = /提前\s*(\d{1,4}|半|[一两二三四五六七八九十]{1,3})\s*个?\s*(分钟|分|小时|钟头)/.exec(String(text || ''))
  if (!m) return 0
  const n = numOrHalf(m[1])
  if (n === null) return 0
  const unit = m[2] === '分钟' || m[2] === '分' ? 1 : 60
  return Math.max(0, Math.min(10080, Math.round(n * unit)))
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
    .replace(/^[\s,，。；:：、\-—]+/g, '')
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
    const rest = text.slice(idx + name.length).replace(/^[\s:：=是为]+/, '')
    const value = rest.split(/[\s,，;；、|]/)[0]
    // 「账号还没注册」「密码忘了」不是凭据值:以前会把「还没注册」当成用户名存进保险库
    const notValue = /^(是|为|的|没|未|无|不|还|暂|待|空|等|忘|待定|不知道)/
    if (value && !notValue.test(value) && value.length <= 64) return value.replace(/[。!！~～]+$/, '')
  }
  return ''
}

const SECRET_WORDS = ['密码', '密钥', '口令', 'token', 'api key', 'apikey', '卡号', '身份证', '账号', '账户', '用户名', 'username', '登录']

/**
 * 一句话里能认出来的「额外凭据字段」。
 * 只认账号/密码的话,「GitHub 账号 x 密码 y 备用码 Z」会把备用码塞进标题,
 * 而那正是两步验证丢了最想找的一串。统一收进 fields['备用码'](加密)。
 */
const EXTRA_SECRET_NAMES = ['备用码', '备份码', '恢复码', '救援码', '二次验证码', '两步验证码', '动态验证码', 'totp', '2fa']

export function pickExtraSecrets(text) {
  for (const name of EXTRA_SECRET_NAMES) {
    const value = pickValue(text, [name])
    if (value) return { name: '备用码', value }
  }
  return null
}

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
  return { kind: 'multi', sites: urls.map((url) => ({ url, title: siteTitle(url) + ' 打卡' })) }
}

// 「收藏/书签」是明确指令;「网站不错/可以用来/推荐」是在介绍一个站,也算网页
const LINK_WORDS = /网页|书签|收藏|网址|入口|常用站|收藏夹|网站|站点|平台|工具站|资源站|推荐|不错|好用|挺好|适合|可以用来|能用来|可以|能做|可以做|加进|放进/i

/**
 * 文件名后缀不算域名。
 * 「IMG_2043.jpg 修图备注」这类句子里的 jpg 长得像顶级域,认成网页就把便签弄丢了。
 */
const FILE_TLD = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'tif', 'tiff', 'raw',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v',
  'mp3', 'wav', 'flac', 'm4a', 'aac',
  'pdf', 'txt', 'md', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  'exe', 'msi', 'dmg', 'apk', 'iso',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'sh', 'bat', 'ps1',
  'log', 'bak', 'tmp', 'db', 'sqlite', 'ipynb',
])

/** 句子开头就是一个裸域名(没写 http://)—— 这通常就是「我要存这个站」的意思。 */
function bareDomainLead(raw) {
  const m = /^\s*((?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,})(?=\s|$|[,，。；;：:、)）\/])/i.exec(raw)
  if (!m) return ''
  const tld = m[1].split('.').pop().toLowerCase()
  return FILE_TLD.has(tld) ? '' : m[1]
}

/**
 * 「收藏这个网页」这类说法 → 网页收藏(手机桌面那种格子)。
 * 只认带网址的句子:没网址的话仍交给便签,别把「收藏这句话」当网页。
 * @returns {{kind:'link',title:string,url:string,group:string,raw:string}|null}
 */
export function parseLink(text, now = new Date()) {
  const raw = String(text || '')
  const urlIn = /(https?:\/\/[^\s,，、;；"'<>)\]]+)/i.exec(raw) || /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,，、;；]*)?)/i.exec(raw)
  if (!urlIn) return null
  let url = urlIn[1].replace(/[)。，,；;]+$/, '')
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  // 说了「收藏/网页/书签/入口」才算网页;光贴一个链接还是便签(可能只是备忘)。
  // 但**开头就写裸域名**是例外:「douban.com 豆瓣电影,查影评」是在说一个站,
  // 不是随手贴的链接 —— 这种句子以前会掉进便签,用户还得自己加分类。
  if (!LINK_WORDS.test(raw) && !bareDomainLead(raw)) return null
  // 取分类:分类:xxx / 放到「xxx」/ 放进 xxx 分组
  let group = ''
  const gm = /(?:分类|分组|组)[:：\s]*[「"']?([^」"'\s,，。；]{1,24})/.exec(raw)
    || /(?:放到|放进|加到|存放在)[「"']([^」"']{1,24})[」"']/.exec(raw)
  if (gm) group = gm[1]
  const LINK_FILLER = /(?:收藏|书签|网页|网址|网站|存成|存一下|存起来|保存|记一下|记下|添加到|加到|放进|放到|放入|加入|这个|那个|一下|给我|帮我|麻烦|请|吧|呢|里|中|的|把|到|了|叫|叫做|名叫|命名)/g
  const title = raw
    // 一句里贴了两个网址时,只收第一个;剩下的网址不能留在标题里
    .replace(/https?:\/\/[^\s,，、;；"'<>)\]]+/gi, ' ')
    .replace(urlIn[0], ' ')
    // 分类说明整段拿掉(「分类:设计」「放进「工具」」),别混进名字
    .replace(/(?:分类|分组|组)(?:\s*[:：]?\s*[「"']?[^」"'\s,，。；]{1,24}[」"']?)?/g, ' ')
    .replace(/[「"'][^」"']{1,24}[」"']/g, ' ')
    .replace(LINK_FILLER, ' ')
    .replace(/缺少|^[,，。；:：\-—]+|[,，。；:：\-—]+$/g, ' ')
    .replace(/[()（）\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 只剩一两个字(「当」「看」)说明用户没起名,用域名更清楚
  let nice = title.length >= 2 ? title : siteTitle(url)
  // 「这站不错,可以用来查资料」不是名字,是说明:名字用域名,说明进备注
  const looksDesc = /[，。、；:：]/.test(nice) || /不错|好用|挺好|合适|适合|可以用|可以用来|能用来|可以做|推荐|值得|登录|注册/.test(nice) || nice.length > 14
  const desc = raw
    .replace(/https?:\/\/[^\s,，、;；"'<>)\]]+/gi, ' ')
    .replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/(?:分类|分组|组)\s*[:：]?\s*[「"']?[^」"'\s,，。；]{1,24}[」"']?/g, ' ')
    .replace(/[「"'][^」"']{1,24}[」"']/g, ' ')
    .replace(/^(?:请|帮我|麻烦|把|给我)\s*/, '')
    .replace(/^[,，。；:：\-—\s]+|[,，。；:：\-—\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (looksDesc) nice = siteTitle(url)
  // 多贴的网址不静默吞掉,回执里要说一声
  const urls = raw.match(/https?:\/\/[^\s,，、;；"'<>)\]]+/gi) || []
  const extra = Math.max(0, urls.filter((u, i) => urls.indexOf(u) === i).length - 1)
  // 用途说明留进备注:「这站不错,可以用来查资料」→ note=查资料
  const note = raw
    .replace(/https?:\/\/[^\s,，、;；"'<>)\]]+/gi, ' ')
    .replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, ' ')
    .replace(/(?:分类|分组|组)(?:\s*[:：]?\s*[「"']?[^」"'\s,，。；]{1,24}[」"']?)?/g, ' ')
    .replace(/[「"'][^」"']{1,24}[」"']/g, ' ')
    .replace(LINK_FILLER, ' ')
    .replace(/^(?:这|那)(?:个|家)?(?:网站|站点|平台)?/g, ' ')
    .replace(/^[,，。；:：\-—\s]+|[,，。；:：\-—\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { kind: 'link', title: nice.slice(0, 40), note: looksDesc ? desc.slice(0, 300) : '', url, group, raw, extra }
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
      leadMin: parseLeadMin(text) || 4320,
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
    let url = (/(https?:\/\/[^\s,，]+)/.exec(text) || [])[1] || ''
    // 「example.org 的 api 密钥」这类只说域名的,也补成能点的网址
    if (!url) {
      const bare = /(?:^|[\s「(（])((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\s/」)）]|$)/i.exec(text)
      if (bare && /密钥|token|api|apikey|后台|站点|网站/i.test(text)) url = 'https://' + bare[1]
    }
    // 「这网站登录之后能干嘛」也会命中「登录」,但凭据得真有账号或密码。
    // 只有网址没有凭据 = 在说一个网站,交给下面的网页分支。
    if (password || username) {
      const extra = pickExtraSecrets(text)
      const title = text
        .replace(/(账号|账户|用户名|username|user|密码|口令|password|pwd|密钥|token|api key|apikey|卡号|身份证|登陆|登录|备用码|备份码|恢复码|救援码|二次验证码|两步验证码|动态验证码|totp|2fa)(\s*[:：=]?\s*[^\s,，;；、|]+)?/gi, '')
        .replace(/(网址|链接|地址)\s*[:：]?\s*\S*/gi, '')
        .replace(/(请|帮我|麻烦|把|存一下|存起来|保存|记一下|记下|记)/g, '')
        .replace(/^[,，。；:：\-—\s]+|[,，。；!！~～\s]+$/g, '')
        .trim()
      // 标题取「看得懂的那个」:自己写的名字 → 网址主机名 → 账号名 → 兜底
      const host = url ? String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] : ''
      const fallback = username ? username + ' 的账号' : '一组凭据'
      // 只贴了个链接时,标题用主机名,别让整条 URL 占满列表
      let cleaned = String(title || '').replace(/https?:\/\/\S+/gi, '')
      // 密码/账号的值会残留在标题里(「密码是 abc」→「的 abc」),先摘掉
      for (const v of [password, username]) if (v) cleaned = cleaned.split(v).join(' ')
      if (extra) cleaned = cleaned.split(extra.value).join(' ')
      cleaned = cleaned
        .replace(/^[\s的是为和了给把,，。；:：\-—]+/, '')
        .replace(/[。!！~～\s]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      return {
        kind: 'secret',
        title: (cleaned.length >= 2 ? cleaned : host || fallback).slice(0, 40),
        username,
        password,
        url,
        // 额外凭据(备用码/恢复码):当作保险库字段存,别混进标题
        fields: extra ? { [extra.name]: extra.value } : undefined,
        extra,
        note: text,
      }
    }
  }

  // 1.5) 网页收藏:带网址 + 「收藏/网页/书签」这类词
  const asLink = parseLink(text, now)
  if (asLink) return asLink

  // 2) 提醒:有明确时间点、相对时间、或「明天/周三/每月几号」这类有日期的说法
  const hasClock = !!clock
  const hasDate = !!rel || !!when.date || !!when.monthly || when.weekdays.length > 0
  const scheduled = hasClock || hasDate
  // 「每月 15 号还信用卡」这种话里不会出现「提醒」两个字,但「每月几号」本身就是排期。
  // 以前只认钟点/相对时间,于是它被降级成便签(口语里「几号」远比「几点」常见)。
  // 只要给了明确钟点(「明天下午四点喂猫粮」),就按提醒处理;
  // 不再要求句子里必须有「提醒/记得」——用户说「帮我记一下 + 时间」就是在排提醒。
  if (scheduled && (wantsReminder || hasClock || rel || when.monthly)) {
    const stripped = text
      .replace(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[:：点时]\s*(半|一刻|三刻|\d{1,2})?/g, '')
      .replace(/提前\s*(\d{1,4}|半|[一两二三四五六七八九十]{1,3})\s*个?\s*(分钟|分|小时|钟头)/g, '')
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
      // 「23:59 提醒我」这种没别的信息:叫「提醒」等于没名字,给个诚实的占位
      title: cleanTitle(stripped) || '未命名提醒',
      time,
      date: rel ? rel.date : when.date,
      weekdays: when.weekdays,
      monthly: when.monthly || undefined,
      leadMin: rel ? 0 : parseLeadMin(text),
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
    return '已整理成 ' + parsed.sites.length + ' 条每日打卡提醒:' + parsed.sites.map((s) => s.title.replace(' 打卡', '')).join('、')
  }
  if (parsed.kind === 'secret') {
    const bits = [
      parsed.username && '账号 ' + parsed.username,
      parsed.password && '密码已加密',
      parsed.fields && parsed.fields['备用码'] && '备用码已加密',
      parsed.url && '网址已存',
    ].filter(Boolean)
    return '已进保险库:' + parsed.title + (bits.length ? '(' + bits.join(' · ') + ')' : '')
  }
  if (parsed.kind === 'link') {
    return '已收进网页:' + parsed.title + ' · ' + parsed.url + (parsed.group ? '(分类:' + parsed.group + ')' : '')
      + (parsed.note ? ' · 备注:' + String(parsed.note).slice(0, 24) : '')
      + (parsed.extra ? ';另外 ' + parsed.extra + ' 个网址没存,要的话单独再说一次' : '')
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
