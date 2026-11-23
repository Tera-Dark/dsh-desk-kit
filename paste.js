import { lookup } from 'node:dns/promises'

/**
 * 粘贴图片的宿主半侧:浏览器有跨域限制,网页上的图片交给 Node 下载。
 *
 * 只做三件事:
 *   1. 校验地址(只允许公网 http/https,挡 SSRF),包括 DNS 解析出来的 IP;
 *   2. 手动跟重定向,每一跳重新校验;
 *   3. 限制大小和类型,返回 Buffer + mime,落盘交给 DeskStore.addFile。
 */

/** 地址不合法时直接抛人话,路由层统一回 400。 */
export function publicImageUrl(raw) {
  let url
  try { url = new URL(String(raw || '')) } catch { throw new Error('图片地址不合法') }
  if (!/^https?:$/.test(url.protocol)) throw new Error('只支持 http/https 图片')
  if (url.username || url.password) throw new Error('图片地址里不能带账号密码')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('不下载本机地址的图片')
  }
  // 内网常见后缀:名字解析到 192.168/10.x 的站点不该被「粘个链接」带着访问
  if (/\.(internal|intranet|lan|home|home.arpa|corp|private)$/.test(host) || host === 'metadata.google.internal') {
    throw new Error('不下载内网地址的图片')
  }
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:')) {
    throw new Error('不下载内网地址的图片')
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const private4 = a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
    if (private4) throw new Error('不下载内网地址的图片')
  }
  return url
}

/**
 * 这个 IP 是不是内网/回环/保留段。
 * 光看字面量不够:域名可以指向 127.0.0.1(DNS 绕行),所以解析结果也要过这一关。
 */
export function isPrivateIp(raw) {
  const ip = String(raw || '').replace(/^\[\|\]\]$/g, '').trim().toLowerCase()
  if (!ip) return true
  if (ip.includes('.')) {
    // ::ffff:127.0.0.1 / 64:ff9b::7f00:1 这类映射写法:取最后一段 v4 再判
    const v4 = ip.slice(ip.lastIndexOf(':') + 1)
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
    if (!m) return true
    const a = Number(m[1])
    const b = Number(m[2])
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      // 198.18/15 故意不拦:本机装了 fake-IP 代理(Clash/Surge)时所有域名都解析到这个段,真实连接由代理去连
      || a >= 224
  }
  return ip === '::' || ip === '::1'
    || ip.startsWith('fc') || ip.startsWith('fd')   // 唯一本地地址 fc00::/7
    || /^fe[89ab]/.test(ip)                          // 链路本地 fe80::/10
    || ip.startsWith('ff')                           // 组播
    || ip.startsWith('64:ff9b:')                     // NAT64 映射
    || ip.startsWith('2001:db8')                     // 文档保留段
}

/** 域名解析出来的每个地址都必须是公网 —— 挡住「域名指向内网」的绕法。 */
async function assertPublicHost(url) {
  const host = url.hostname.replace(/^\[\|\]\]$/g, '')
  let list = []
  try {
    list = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('域名解析不了:' + host)
  }
  if (!list.length) throw new Error('域名解析不了:' + host)
  for (const one of list) {
    if (isPrivateIp(one.address)) throw new Error('这个域名指向内网地址,不下载')
  }
}

/** 下载网页图片。重定向最多 4 跳,每一跳都重新做公网校验(含 DNS)。 */
export async function downloadImage(raw, maxBytes = 24 * 1024 * 1024) {
  let current = publicImageUrl(raw)
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(current)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    let res
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'dsh-desk-kit image paste' },
      })
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('下载图片超时了')
      throw error
    } finally { clearTimeout(timer) }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('图片地址重定向但没有目标')
      current = publicImageUrl(new URL(loc, current).toString())
      continue
    }
    if (!res.ok) throw new Error('下载图片失败 HTTP ' + res.status)
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!/^image\//.test(mime)) throw new Error('这个链接不是图片')
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > maxBytes) {
      const error = new Error('图片太大,上限 ' + Math.round(maxBytes / 1048576) + 'MB')
      error.code = 'E_TOO_BIG'
      throw error
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > maxBytes) {
      const error = new Error('图片太大,上限 ' + Math.round(maxBytes / 1048576) + 'MB')
      error.code = 'E_TOO_BIG'
      throw error
    }
    return { buffer, mime, url: current }
  }
  throw new Error('图片地址重定向太多')
}

/** 从地址里取一个像样的文件名;取不到就用时间戳,别叫 image.png。 */
export function imageNameFrom(url, mime) {
  const ext = ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  })[mime] || 'png'
  let base = ''
  try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch { base = '' }
  base = String(base).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80)
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : '粘贴图片 ' + Date.now() + '.' + ext
}
