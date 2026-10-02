// Aggregates source-map-explorer output into "ours" vs each third-party package.
// Usage: npx electron-vite build --outDir out-stats --sourcemap
//        npx source-map-explorer "out-stats/**/*.js" --json --no-border-checks > out-stats/sme.json
//        node scripts/bundle-origin.mjs out-stats/sme.json
import { readFileSync } from 'fs'

const data = JSON.parse(readFileSync(process.argv[2] ?? 'out-stats/sme.json', 'utf8'))
const byPkg = new Map()
let ours = 0
let other = 0
let total = 0
for (const r of data.results) {
  for (const [src, info] of Object.entries(r.files)) {
    const size = info.size
    total += size
    const m = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(src)
    if (m) byPkg.set(m[1].replace('\\', '/'), (byPkg.get(m[1].replace('\\', '/')) ?? 0) + size)
    else if (/(^|[\\/])src[\\/]/.test(src) || src.includes('package.json')) ours += size
    else other += size // bundler runtime, unmapped bytes, whitespace
  }
}
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB'
const pct = (n) => ((n / total) * 100).toFixed(1) + '%'
console.log(`total mapped bundle: ${mb(total)}`)
console.log(`  ours (src/)      : ${mb(ours)}  ${pct(ours)}`)
console.log(`  libraries        : ${mb(total - ours - other)}  ${pct(total - ours - other)}`)
console.log(`  bundler/unmapped : ${mb(other)}  ${pct(other)}`)
console.log('\nlargest libraries:')
for (const [p, s] of [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${p.padEnd(32)} ${mb(s).padStart(9)}  ${pct(s)}`)
