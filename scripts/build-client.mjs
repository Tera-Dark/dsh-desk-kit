/**
 * 把 src/client/*.js 按文件名顺序拼成 client.js。
 *
 * 为什么需要「拼接」而不是直接 import:宿主只认 package.json 里的
 * `exports["./client"]` 一个文件(__ModuleLoader__ 单文件 bundle),
 * 浏览器侧没有打包器,也不能改成 ESM。所以源码拆分 + 构建拼接,
 * 换来可维护性,不引入任何运行时依赖。
 *
 * 用法:
 *   node scripts/build-client.mjs           # 生成 client.js
 *   node scripts/build-client.mjs --check    # 只校验「生成物 == 源码」,CI 用
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')
const OUT = join(ROOT, 'client.js')

const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()
if (!files.length) {
  console.error('src/client/ 里没有文件')
  process.exit(1)
}
// 版本号单一来源:源码用 __DK_VERSION__ 占位,构建时注入 package.json 的 version,
// 避免 package.json / index.js / client 三处各写一份、发版时漏改。
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const built = files
  .map((f) => readFileSync(join(SRC, f), 'utf8'))
  .join('')
  .replaceAll('__DK_VERSION__', version)

const check = process.argv.includes('--check')
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== built) {
    console.error('client.js 与 src/client/ 不一致。跑 `npm run build` 重新生成后再提交。')
    // 给出第一处差异,省得人工 diff 大文件
    let i = 0
    while (i < current.length && i < built.length && current[i] === built[i]) i++
    const line = built.slice(0, i).split('\n').length
    console.error('第一处差异在第 ' + line + ' 行附近')
    process.exit(1)
  }
  console.log('✓ client.js 与 ' + files.length + ' 个源文件一致(' + Math.round(built.length / 1024) + 'KB)')
} else {
  writeFileSync(OUT, built)
  console.log('✓ 已生成 client.js:' + files.length + ' 个文件 → ' + Math.round(built.length / 1024) + 'KB')
}
