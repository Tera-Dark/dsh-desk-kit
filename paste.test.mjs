/**
 * 粘贴图片的地址校验契约。
 *
 * 为什么单独测:这一段是唯一会「按用户给的地址出网」的地方,
 * 拦不住就是 SSRF(读内网服务、云元数据)。这里的每条断言都对应一种绕过写法。
 * 只跑离线规则,不发请求。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { publicImageUrl, isPrivateIp, imageNameFrom } from './paste.js'

test('IPv4/IPv6:内网、回环、保留段一律认出来', () => {
  const blocked = [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.1',
    '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fc00::abcd', 'fe80::1', 'ff02::1',
    '2001:db8::1', '::ffff:127.0.0.1',
  ]
  for (const ip of blocked) assert.equal(isPrivateIp(ip), true, ip + ' 应该被当成内网')
  const open = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']
  for (const ip of open) assert.equal(isPrivateIp(ip), false, ip + ' 是公网地址')
})

test('fake-IP 代理不被误伤', () => {
  // Clash/Surge 的 fake-IP 段:本机所有域名都解析到 198.18/15。
  // 拦了它等于「所有图片都下不了」,而真实连接是代理去连的,拦也没有安全收益。
  assert.equal(isPrivateIp('198.18.0.151'), false, '198.18/15 是代理假地址,不能拦')
})

test('地址校验:只放行公网 http/https', () => {
  assert.equal(publicImageUrl('https://example.com/a.png').hostname, 'example.com')
  assert.equal(publicImageUrl('http://example.com/a.png').protocol, 'http:')
  const bad = [
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'ftp://example.com/a.png',
    'http://localhost/a.png',
    'http://foo.localhost/a.png',
    'https://foo.local/a.png',
    'http://a.internal/a.png',
    'http://metadata.google.internal/x',
    'http://192.168.1.5/x.png',
    'http://[::1]/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'https://user:pass@example.com/a.png',
    '',
    'not a url',
  ]
  for (const u of bad) assert.throws(() => publicImageUrl(u), /./, '应该拒绝:' + u)
})

test('文件名:取不到就用时间戳,不留路径和非法字符', () => {
  assert.equal(imageNameFrom('https://ex.com/a/b/cat.png', 'image/png'), 'cat.png')
  const weird = imageNameFrom('https://ex.com/a/%2e%2e%5ccon%3a.png', 'image/png')
  assert.ok(!/[/\\:]/.test(weird), '文件名里不能有路径字符:' + weird)
  assert.ok(weird.length <= 80)
  assert.ok(/\.(png|jpg|jpeg|gif|webp)$/i.test(imageNameFrom('https://ex.com', 'image/webp')))
})
