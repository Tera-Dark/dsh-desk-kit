/**
 * 粘贴图片的宿主半侧:浏览器有跨域限制,网页上的图片交给 Node 下载。
 *
 * 只做三件事:
 *   1. 校验地址(只允许公网 http/https,挡 SSRF);
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

/** 下载网页图片。重定向最多 4 跳,每一跳都重新做公网校验。 */
export async function downloadImage(raw, maxBytes = 24 * 1024 * 1024) {
  let current = publicImageUrl(raw)
  for (let hop = 0; hop < 4; hop++) {
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
