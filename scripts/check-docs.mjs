#!/usr/bin/env node
/**
 * 文档一致性门禁。
 *
 * 为什么要有:版本号在 package.json / README / AGENTS.md 三处各写一遍,
 * 已经漂移过两次(README 停在 1.29.0、AGENTS 停在 1.29.0)。靠人记不住,
 * 就让脚本记住。纯文件检查,不联网、不跑测试,毫秒级。
 *
 *   node scripts/check-docs.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const problems = []
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8') } catch { problems.push(rel + ': 读不到'); return '' }
}

// 1) 版本号:README / AGENTS.md 必须写到当前版本
for (const rel of ['README.md', 'AGENTS.md']) {
  const text = read(rel)
  if (!text) continue
  const hits = [...text.matchAll(/(\d+\.\d+\.\d+)/g)].map((m) => m[1])
  if (!hits.includes(pkg.version)) {
    problems.push(rel + ': 没有提到当前版本 ' + pkg.version + '(找到:' + (hits.slice(0, 5).join(', ') || '无') + ')')
  }
}

// 2) docs 必备文件
for (const f of ['docs/ARCHITECTURE.md', 'docs/DESIGN.md', 'docs/SECURITY.md', 'docs/ISSUES.md']) {
  if (!existsSync(join(ROOT, f))) problems.push(f + ': 缺失')
}

// 3) 本地 Markdown 链接必须指得到
const mdFiles = ['README.md', 'AGENTS.md', 'PRODUCT.md', 'CHANGELOG.md',
  'docs/ARCHITECTURE.md', 'docs/DESIGN.md', 'docs/SECURITY.md', 'docs/ISSUES.md']
let links = 0
for (const rel of mdFiles) {
  const text = read(rel)
  if (!text) continue
  for (const m of text.matchAll(/\]\(([^)\s]+?)(?:#[^)]*)?\)/g)) {
    const target = m[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    links++
    const abs = resolve(ROOT, dirname(rel), target)
    if (!existsSync(abs)) problems.push(rel + ': 死链 -> ' + target)
  }
}

// 4) 测试脚本必须覆盖所有 *.test.mjs
const script = String(pkg.scripts && pkg.scripts.test || '')
const testFiles = readdirSync(ROOT).filter((f) => f.endsWith('.test.mjs'))
for (const f of testFiles) {
  if (!script.includes(f)) problems.push('package.json test: 漏了 ' + f)
}

if (problems.length) {
  console.error('✗ 文档一致性检查失败(' + problems.length + ' 项):')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('✓ 文档一致:版本 ' + pkg.version + ' · ' + links + ' 个本地链接 · ' + testFiles.length + ' 个测试文件都已纳入 test')
