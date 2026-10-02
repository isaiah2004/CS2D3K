// Generates a real Bible vault: King James Version text + OpenBible.info cross references.
//
//   node scripts/gen-bible.mjs [outDir]          (default: vaults/Bible (KJV))
//
// Data (downloaded once into bench/.cache/data):
//   KJV text            — public domain (thiagobodruk/bible en_kjv.json)
//   cross references    — OpenBible.info, CC-BY (https://www.openbible.info/labs/cross-references/)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const DATA = join(ROOT, 'bench', '.cache', 'data')
const OUT = process.argv[2] ?? join(ROOT, 'vaults', 'Bible (KJV)')

// canonical order: English name, OSIS code used by OpenBible.info, short label for references
const BOOKS = [
  ['Genesis', 'Gen', 'Gen'], ['Exodus', 'Exod', 'Exod'], ['Leviticus', 'Lev', 'Lev'], ['Numbers', 'Num', 'Num'],
  ['Deuteronomy', 'Deut', 'Deut'], ['Joshua', 'Josh', 'Josh'], ['Judges', 'Judg', 'Judg'], ['Ruth', 'Ruth', 'Ruth'],
  ['1 Samuel', '1Sam', '1 Sam'], ['2 Samuel', '2Sam', '2 Sam'], ['1 Kings', '1Kgs', '1 Kgs'], ['2 Kings', '2Kgs', '2 Kgs'],
  ['1 Chronicles', '1Chr', '1 Chr'], ['2 Chronicles', '2Chr', '2 Chr'], ['Ezra', 'Ezra', 'Ezra'], ['Nehemiah', 'Neh', 'Neh'],
  ['Esther', 'Esth', 'Esth'], ['Job', 'Job', 'Job'], ['Psalms', 'Ps', 'Ps'], ['Proverbs', 'Prov', 'Prov'],
  ['Ecclesiastes', 'Eccl', 'Eccl'], ['Song of Solomon', 'Song', 'Song'], ['Isaiah', 'Isa', 'Isa'], ['Jeremiah', 'Jer', 'Jer'],
  ['Lamentations', 'Lam', 'Lam'], ['Ezekiel', 'Ezek', 'Ezek'], ['Daniel', 'Dan', 'Dan'], ['Hosea', 'Hos', 'Hos'],
  ['Joel', 'Joel', 'Joel'], ['Amos', 'Amos', 'Amos'], ['Obadiah', 'Obad', 'Obad'], ['Jonah', 'Jonah', 'Jonah'],
  ['Micah', 'Mic', 'Mic'], ['Nahum', 'Nah', 'Nah'], ['Habakkuk', 'Hab', 'Hab'], ['Zephaniah', 'Zeph', 'Zeph'],
  ['Haggai', 'Hag', 'Hag'], ['Zechariah', 'Zech', 'Zech'], ['Malachi', 'Mal', 'Mal'], ['Matthew', 'Matt', 'Matt'],
  ['Mark', 'Mark', 'Mark'], ['Luke', 'Luke', 'Luke'], ['John', 'John', 'John'], ['Acts', 'Acts', 'Acts'],
  ['Romans', 'Rom', 'Rom'], ['1 Corinthians', '1Cor', '1 Cor'], ['2 Corinthians', '2Cor', '2 Cor'], ['Galatians', 'Gal', 'Gal'],
  ['Ephesians', 'Eph', 'Eph'], ['Philippians', 'Phil', 'Phil'], ['Colossians', 'Col', 'Col'], ['1 Thessalonians', '1Thess', '1 Thess'],
  ['2 Thessalonians', '2Thess', '2 Thess'], ['1 Timothy', '1Tim', '1 Tim'], ['2 Timothy', '2Tim', '2 Tim'], ['Titus', 'Titus', 'Titus'],
  ['Philemon', 'Phlm', 'Phlm'], ['Hebrews', 'Heb', 'Heb'], ['James', 'Jas', 'Jas'], ['1 Peter', '1Pet', '1 Pet'],
  ['2 Peter', '2Pet', '2 Pet'], ['1 John', '1John', '1 John'], ['2 John', '2John', '2 John'], ['3 John', '3John', '3 John'],
  ['Jude', 'Jude', 'Jude'], ['Revelation', 'Rev', 'Rev']
]
const OT_BOOKS = 39

// ---------------------------------------------------------------- data

function ensureData() {
  mkdirSync(DATA, { recursive: true })
  const kjv = join(DATA, 'kjv.json')
  const xref = join(DATA, 'cross_references.txt')
  if (!existsSync(kjv)) execSync(`curl -sSL -o "${kjv}" https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json`)
  if (!existsSync(xref)) {
    const zip = join(DATA, 'cross-references.zip')
    execSync(`curl -sSL -o "${zip}" https://a.openbible.info/data/cross-references.zip`)
    execSync(`unzip -o -q "${zip}" -d "${DATA}"`)
  }
  return { kjv, xref }
}

const { kjv, xref } = ensureData()
const bible = JSON.parse(readFileSync(kjv, 'utf8').replace(/^﻿/, ''))
if (bible.length !== 66) throw new Error(`expected 66 books, got ${bible.length}`)
const byOsis = new Map(BOOKS.map(([name, osis, short], i) => [osis, { name, osis, short, index: i }]))

const chapterName = (b, c) => `${BOOKS[b][0]} ${c}`
const verseName = (b, c, v) => `${BOOKS[b][0]} ${c}-${v}`
const versePath = (b, c, v) => `${BOOKS[b][0]}/${c}/${verseName(b, c, v)}.md`
const chapterPath = (b, c) => `${BOOKS[b][0]}/${chapterName(b, c)}.md`
const verseText = (b, c, v) => bible[b].chapters[c - 1]?.[v - 1]

// "Gen.1.1" → {b, c, v}
function parseRef(s) {
  const [osis, c, v] = s.split('.')
  const book = byOsis.get(osis)
  if (!book) return null
  const r = { b: book.index, c: Number(c), v: Number(v) }
  return verseText(r.b, r.c, r.v) === undefined ? null : r
}

// cross references: from → [{ to, end, votes }]
const xrefs = new Map()
let refCount = 0
let skipped = 0
for (const line of readFileSync(xref, 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue
  const [from, to, votes] = line.split('\t')
  const a = parseRef(from)
  const [start, end] = to.split('-')
  const t = parseRef(start)
  const e = end ? parseRef(end) : null
  if (!a || !t) {
    skipped++
    continue
  }
  const key = `${a.b}.${a.c}.${a.v}`
  let list = xrefs.get(key)
  if (!list) xrefs.set(key, (list = []))
  list.push({ t, e, votes: Number(votes) })
  refCount++
}

// ---------------------------------------------------------------- write

const files = []
const label = (r, e) => {
  const base = `${BOOKS[r.b][2]} ${r.c}:${r.v}`
  if (!e) return base
  return e.b === r.b && e.c === r.c ? `${base}–${e.v}` : e.b === r.b ? `${base}–${e.c}:${e.v}` : `${base} – ${BOOKS[e.b][2]} ${e.c}:${e.v}`
}

const testament = (b) => (b < OT_BOOKS ? 'old-testament' : 'new-testament')
const bookTag = (b) => BOOKS[b][0].toLowerCase().replace(/\s+/g, '-')

files.push([
  'Bible (KJV).md',
  `# The Holy Bible — King James Version\n\n## Old Testament\n${BOOKS.slice(0, OT_BOOKS).map(([n]) => `- [[${n}]]`).join('\n')}\n\n## New Testament\n${BOOKS.slice(OT_BOOKS)
    .map(([n]) => `- [[${n}]]`)
    .join('\n')}\n\nSee [[About this vault]].\n`
])
files.push([
  'About this vault.md',
  `# About this vault\n\n- **Text:** King James Version (1769 Oxford standard), public domain.\n- **Cross references:** [OpenBible.info](https://www.openbible.info/labs/cross-references/), licensed [CC-BY](https://creativecommons.org/licenses/by/4.0/). ${refCount.toLocaleString('en-US')} references, sorted by votes; ranges link to their first verse.\n- **Structure:** 66 books → 1,189 chapters → 31,102 verses. Chapter notes contain the full chapter text with linked verse numbers; verse notes hold the verse, navigation and its cross references.\n- File names use \`Book C-V\` because \`:\` is not allowed in file names (e.g. [[John 3-16]] is John 3:16).\n\nGenerated by \`scripts/gen-bible.mjs\`.\n`
])

for (let b = 0; b < 66; b++) {
  const name = BOOKS[b][0]
  const chapters = bible[b].chapters
  files.push([
    `${name}/${name}.md`,
    `---\ntags: [${testament(b)}, book]\nchapters: ${chapters.length}\n---\n# ${name}\n\n${chapters.map((_, i) => `[[${chapterName(b, i + 1)}|${i + 1}]]`).join(' · ')}\n\n[[Bible (KJV)|↑ Bible]]\n`
  ])
  for (let c = 1; c <= chapters.length; c++) {
    const verses = chapters[c - 1]
    const prev = c > 1 ? `[[${chapterName(b, c - 1)}|← ${chapterName(b, c - 1)}]]` : b > 0 ? `[[${chapterName(b - 1, bible[b - 1].chapters.length)}|← ${chapterName(b - 1, bible[b - 1].chapters.length)}]]` : ''
    const next = c < chapters.length ? `[[${chapterName(b, c + 1)}|${chapterName(b, c + 1)} →]]` : b < 65 ? `[[${chapterName(b + 1, 1)}|${chapterName(b + 1, 1)} →]]` : ''
    const body = verses.map((t, i) => `[[${verseName(b, c, i + 1)}|${i + 1}]] ${t}`).join('\n')
    files.push([chapterPath(b, c), `---\ntags: [${testament(b)}, chapter, ${bookTag(b)}]\nbook: ${name}\nchapter: ${c}\nverses: ${verses.length}\n---\n# ${chapterName(b, c)}\n\n${prev} | [[${name}]] | ${next}\n\n${body}\n`])
    for (let v = 1; v <= verses.length; v++) {
      const refs = (xrefs.get(`${b}.${c}.${v}`) ?? []).sort((x, y) => y.votes - x.votes)
      const nav = `${v > 1 ? `[[${verseName(b, c, v - 1)}|← ${v - 1}]] · ` : ''}[[${chapterName(b, c)}]]${v < verses.length ? ` · [[${verseName(b, c, v + 1)}|${v + 1} →]]` : ''}`
      // the strongest references show their text; the long tail stays compact so the vault stays light
      const link = (r) => `[[${verseName(r.t.b, r.t.c, r.t.v)}|${label(r.t, r.e)}]]`
      const refLines = refs.slice(0, 10).map((r) => `- ${link(r)} — ${verseText(r.t.b, r.t.c, r.t.v)}`)
      if (refs.length > 10) refLines.push(`- More: ${refs.slice(10).map(link).join(' · ')}`)
      files.push([
        versePath(b, c, v),
        `---\naliases: ["${BOOKS[b][0]} ${c}:${v}"]\nbook: ${name}\nchapter: ${c}\nverse: ${v}\ncross_references: ${refs.length}\n---\n> ${verses[v - 1]}\n> — **${BOOKS[b][0]} ${c}:${v}** (KJV)\n\n${nav}\n${refLines.length ? `\n## Cross references\n${refLines.join('\n')}\n` : ''}`
      ])
    }
  }
}

rmSync(OUT, { recursive: true, force: true })
const made = new Set()
for (const [rel, content] of files) {
  const p = join(OUT, rel)
  const dir = join(p, '..')
  if (!made.has(dir)) {
    mkdirSync(dir, { recursive: true })
    made.add(dir)
  }
  writeFileSync(p, content)
}
console.log(`wrote ${files.length} notes to ${OUT} (${refCount} cross references, ${skipped} unparsable)`)
