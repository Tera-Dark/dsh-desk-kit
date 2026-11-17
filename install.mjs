#!/usr/bin/env node
/**
 * 把本插件装进 DSH profile。
 *
 *   node install.mjs            复制安装(推荐:宿主提供 defineTool,参数校验完整)
 *   node install.mjs --link     建 junction(源码即生效,改完不用重装)
 *
 * 两种方式都能用:插件对 '@deepseek-ai/dsh-tools' 的导入有本地兜底,
 * 所以就算以后被 pnpm 改回符号链接也不会再启动失败。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/+$/, '')
const profileDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop')
const target = join(profileDir, 'node_modules', 'dsh-desk-kit')
const mode = process.argv.includes('--link') ? 'link' : 'copy'
const files = ['index.js', 'client.js', 'store.js', 'tool.js', 'capture.js', 'lunar.js', 'package.json', 'cordis.patch.yml', 'README.md']

mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
try { if (lstatSync(target)) rmSync(target, { recursive: true, force: true }) } catch { }

if (mode === 'link') {
  symlinkSync(here, target, 'junction')
  console.log('junction ->', here)
} else {
  mkdirSync(target, { recursive: true })
  for (const f of files) copyFileSync(join(here, f), join(target, f))
  console.log('copied', files.length, 'files ->', target)
}

// 1) profile package.json: dependencies + bundles
const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
pkg.dependencies = pkg.dependencies || {}
// 两种模式都用 link: 记录源码位置:被 pnpm 改回符号链接也能加载(插件内有本地 defineTool 兜底)
pkg.dependencies['dsh-desk-kit'] = 'link:' + here
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!bundles.includes('dsh-desk-kit')) bundles.push('dsh-desk-kit')
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
console.log('profile package.json 已更新: dependencies=' + pkg.dependencies['dsh-desk-kit'] + ', bundles 共 ' + bundles.length + ' 项')
console.log('\n重启 DSH 后生效。自检: 访问 http://127.0.0.1:<端口>/desk-kit-api 应返回 JSON;')
console.log('或看 ' + join(homedir(), '.dsh', 'desk-kit', 'boot.log') + ' 是否新增一行 apply ok。')
