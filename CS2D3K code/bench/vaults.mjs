// Benchmark vault generators. Vaults are cached in bench/.cache/<name> (regenerate with --fresh).
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

export const CACHE = join(import.meta.dirname, '.cache')

/** deterministic PRNG so every run benchmarks the same vault */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function writeVault(name, files, fresh) {
  const dir = join(CACHE, name)
  if (existsSync(join(dir, '.complete')) && !fresh) return dir
  rmSync(dir, { recursive: true, force: true })
  for (const [rel, content] of files) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
  writeFileSync(join(dir, '.complete'), String(Date.now()))
  return dir
}

/**
 * Synthetic knowledge base: n notes in 40 folders, ~avgLinks links per note with preferential
 * attachment (a few hub notes, long tail — like real vaults), 30 tags, some prose.
 */
export function synthetic(n, { avgLinks = 4, fresh = false } = {}) {
  const r = rng(n)
  const names = Array.from({ length: n }, (_, i) => `Note ${i}`)
  const degree = new Array(n).fill(1)
  let degreeSum = n
  const pick = () => {
    // preferential attachment: probability ∝ degree
    let x = r() * degreeSum
    for (let k = 0; k < 64; k++) {
      const i = Math.floor(r() * n)
      x -= degree[i]
      if (x <= 0 || k === 63) return i
    }
    return Math.floor(r() * n)
  }
  const files = []
  for (let i = 0; i < n; i++) {
    const links = new Set()
    const count = Math.max(0, Math.round(avgLinks + (r() - 0.5) * avgLinks))
    for (let k = 0; k < count; k++) {
      const j = pick()
      if (j !== i) links.add(j)
    }
    for (const j of links) {
      degree[j]++
      degreeSum++
    }
    const tag = `#topic${i % 30}`
    const body = [...links].map((j) => `- relates to [[${names[j]}]]`).join('\n')
    files.push([`area${i % 40}/${names[i]}.md`, `# ${names[i]}\n\nSome thoughts about note ${i}. ${tag}\n\n${body}\n`])
  }
  return writeVault(`synthetic-${n}`, files, fresh)
}

// 66 books with their real chapter counts (1,189 chapters)
const BOOKS = [
  ['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36], ['Deuteronomy', 34], ['Joshua', 24], ['Judges', 21],
  ['Ruth', 4], ['1 Samuel', 31], ['2 Samuel', 24], ['1 Kings', 22], ['2 Kings', 25], ['1 Chronicles', 29], ['2 Chronicles', 36],
  ['Ezra', 10], ['Nehemiah', 13], ['Esther', 10], ['Job', 42], ['Psalms', 150], ['Proverbs', 31], ['Ecclesiastes', 12],
  ['Song of Solomon', 8], ['Isaiah', 66], ['Jeremiah', 52], ['Lamentations', 5], ['Ezekiel', 48], ['Daniel', 12], ['Hosea', 14],
  ['Joel', 3], ['Amos', 9], ['Obadiah', 1], ['Jonah', 4], ['Micah', 7], ['Nahum', 3], ['Habakkuk', 3], ['Zephaniah', 3],
  ['Haggai', 2], ['Zechariah', 14], ['Malachi', 4], ['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21], ['Acts', 28],
  ['Romans', 16], ['1 Corinthians', 16], ['2 Corinthians', 13], ['Galatians', 6], ['Ephesians', 6], ['Philippians', 4],
  ['Colossians', 4], ['1 Thessalonians', 5], ['2 Thessalonians', 3], ['1 Timothy', 6], ['2 Timothy', 4], ['Titus', 3],
  ['Philemon', 1], ['Hebrews', 13], ['James', 5], ['1 Peter', 5], ['2 Peter', 3], ['1 John', 5], ['2 John', 1], ['3 John', 1],
  ['Jude', 1], ['Revelation', 22]
]
const TOTAL_VERSES = 31102

/**
 * The Bible as a vault.
 *  level 'chapter': 66 book notes + 1,189 chapter notes (book link, prev/next chapter, cross-refs between chapters)
 *  level 'verse'  : + 31,102 verse notes (chapter link, prev/next verse) and `crossRefs` verse→verse cross references
 *                   (OpenBible.info's public dataset has ~340k; 'medium' uses ~2.5 per verse ≈ 78k)
 * Verse counts per chapter are distributed around the real average (≈26.2) to total exactly 31,102.
 */
export function bible({ level = 'verse', crossRefs = 78000, fresh = false } = {}) {
  const r = rng(31102 + crossRefs + (level === 'chapter' ? 1 : 0))
  const files = []
  const chapters = []
  for (const [book, count] of BOOKS) for (let c = 1; c <= count; c++) chapters.push({ book, c })
  // verse counts
  const weights = chapters.map(() => 0.4 + r() * 1.2)
  const wsum = weights.reduce((a, b) => a + b, 0)
  let assigned = 0
  chapters.forEach((ch, i) => {
    ch.verses = Math.max(2, Math.round((weights[i] / wsum) * TOTAL_VERSES))
    assigned += ch.verses
  })
  chapters[chapters.length - 1].verses += TOTAL_VERSES - assigned
  const chName = (ch) => `${ch.book} ${ch.c}`
  const verseName = (ch, v) => `${ch.book} ${ch.c}-${v}`

  // all verses (for cross references)
  const verses = []
  if (level === 'verse') for (const ch of chapters) for (let v = 1; v <= ch.verses; v++) verses.push({ ch, v })
  const refs = new Map()
  if (level === 'verse') {
    for (let k = 0; k < crossRefs; k++) {
      const a = Math.floor(r() * verses.length)
      // most cross references stay near (same book / testament), some jump anywhere
      const b = r() < 0.6 ? Math.min(verses.length - 1, Math.max(0, a + Math.floor((r() - 0.5) * 3000))) : Math.floor(r() * verses.length)
      if (a === b) continue
      let list = refs.get(a)
      if (!list) refs.set(a, (list = []))
      list.push(b)
    }
  }

  for (const [book, count] of BOOKS) {
    const list = Array.from({ length: count }, (_, i) => `- [[${book} ${i + 1}]]`).join('\n')
    files.push([`${book}/${book}.md`, `# ${book}\n\n#book\n\n${list}\n`])
  }
  chapters.forEach((ch, i) => {
    const prev = chapters[i - 1]
    const next = chapters[i + 1]
    const nav = `${prev ? `[[${chName(prev)}|← ${chName(prev)}]]` : ''} | [[${ch.book}]] | ${next ? `[[${chName(next)}|${chName(next)} →]]` : ''}`
    let body = `# ${chName(ch)}\n\n${nav}\n\n`
    if (level === 'verse') body += Array.from({ length: ch.verses }, (_, v) => `![[${verseName(ch, v + 1)}]]`).join('\n')
    else {
      // chapter-level cross references (≈3 per chapter)
      for (let k = 0; k < 3; k++) body += `- see [[${chName(chapters[Math.floor(r() * chapters.length)])}]]\n`
    }
    files.push([`${ch.book}/${chName(ch)}.md`, body + '\n'])
  })
  if (level === 'verse') {
    verses.forEach(({ ch, v }, i) => {
      const prev = v > 1 ? `[[${verseName(ch, v - 1)}|←]] ` : ''
      const next = v < ch.verses ? ` [[${verseName(ch, v + 1)}|→]]` : ''
      const xr = (refs.get(i) ?? []).map((j) => `[[${verseName(verses[j].ch, verses[j].v)}]]`).join(', ')
      files.push([
        `${ch.book}/${ch.c}/${verseName(ch, v)}.md`,
        `${prev}[[${chName(ch)}]]${next}\n\nVerse ${v} of ${chName(ch)}.\n${xr ? `\nCross references: ${xr}\n` : ''}`
      ])
    })
  }
  return writeVault(level === 'verse' ? `bible-verses-${crossRefs}` : 'bible-chapters', files, fresh)
}

/** A .canvas with n nodes: text cards (markdown), some groups and code cells; ~1.2 edges per node. */
export function canvasVault(n, { fresh = false } = {}) {
  const r = rng(n * 7)
  const nodes = []
  const cols = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 320
    const y = Math.floor(i / cols) * 220
    if (i % 25 === 0) nodes.push({ id: `n${i}`, type: 'code', language: 'python', code: `print(${i})`, x, y, width: 280, height: 160 })
    else nodes.push({ id: `n${i}`, type: 'text', text: `## Card ${i}\nSome **markdown** with a [[link]] and \`code\`.\n- item\n- item`, x, y, width: 280, height: 160 })
  }
  const edges = []
  for (let i = 0; i < Math.round(n * 1.2); i++) {
    const a = Math.floor(r() * n)
    const b = Math.min(n - 1, Math.max(0, a + Math.floor((r() - 0.5) * cols * 3)))
    if (a !== b) edges.push({ id: `e${i}`, fromNode: `n${a}`, toNode: `n${b}`, toEnd: 'arrow' })
  }
  return writeVault(`canvas-${n}`, [[`Bench ${n}.canvas`, JSON.stringify({ nodes, edges })]], fresh)
}

/** A .formmap with n form cards spread over the product-definition zones, ~1 relation per card. */
export function formmapVault(n, { fresh = false } = {}) {
  const r = rng(n * 13)
  const kinds = ['idea', 'principle', 'goal', 'approach', 'feature', 'feature', 'feature', 'question']
  const zoneSpecs = [
    ['Philosophy', 'principle', {}],
    ['Engineering approach', 'approach', {}],
    ['Final goal', 'goal', { horizon: 'final' }],
    ['Initial features (MVP)', 'feature', { phase: 'mvp' }],
    ['Later features', 'feature', { phase: 'later' }],
    ['Open questions', 'question', {}]
  ]
  const perZone = Math.ceil(n / zoneSpecs.length)
  const zcols = Math.ceil(Math.sqrt(perZone))
  const zoneW = zcols * 300 + 80
  const zoneH = Math.ceil(perZone / zcols) * 190 + 120
  const nodes = zoneSpecs.map(([label, kind, assign], i) => ({
    id: `z${i}`, type: 'zone', label, emoji: '📦', defaultKind: kind, assign, locked: true, order: i + 1,
    x: (i % 3) * (zoneW + 80), y: Math.floor(i / 3) * (zoneH + 80), width: zoneW, height: zoneH
  }))
  for (let i = 0; i < n; i++) {
    const zi = i % zoneSpecs.length
    const z = nodes[zi]
    const k = Math.floor(i / zoneSpecs.length)
    const kind = zoneSpecs[zi][1] === 'feature' ? 'feature' : kinds[Math.floor(r() * kinds.length)]
    nodes.push({
      id: `c${i}`, type: 'form', kind, title: `Card ${i}`, text: `Description of card ${i}.`,
      fields: kind === 'feature' ? { phase: zi === 3 ? 'mvp' : 'later', priority: 'should', effort: 'm', status: 'planned', fun: 3 } : {},
      votes: Math.floor(r() * 4),
      x: z.x + 40 + (k % zcols) * 300, y: z.y + 80 + Math.floor(k / zcols) * 190, width: 280, height: 170
    })
  }
  const edges = []
  for (let i = 0; i < n; i++) {
    const b = Math.floor(r() * n)
    if (b !== i) edges.push({ id: `e${i}`, fromNode: `c${i}`, toNode: `c${b}`, relation: r() < 0.5 ? 'serves' : 'relates', toEnd: 'arrow' })
  }
  return writeVault(`formmap-${n}`, [[`Bench ${n}.formmap`, JSON.stringify({ formmap: { version: 1, mvpBudget: 40 }, nodes, edges })]], fresh)
}
