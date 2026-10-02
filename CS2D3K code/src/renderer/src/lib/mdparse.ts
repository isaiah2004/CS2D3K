// Lightweight markdown metadata extraction (links, tags, headings, frontmatter, tasks).

/**
 * Version of what `parseMarkdown` / `parseCanvasLinks` produce. Parsed metadata is cached on disk
 * (`.cs2d3k/cache/metadata.json`, see lib/metaCache.ts): bump this whenever a change here could give a different
 * FileMeta for the same file, so every vault's cache is thrown away and re-parsed once.
 */
export const PARSER_VERSION = 1

export interface LinkRef {
  /** link target without subpath/alias, e.g. "Folder/Note" */
  link: string
  /** "#Heading" or "#^block" if present */
  subpath?: string
  display?: string
  line: number
  col: number
  embed: boolean
  /** true for [text](url) markdown links */
  markdown?: boolean
}

export interface HeadingRef {
  level: number
  text: string
  line: number
}

export interface TagRef {
  tag: string // without '#', original casing
  line: number
}

export interface TaskRef {
  line: number
  done: boolean
  text: string
}

export interface FileMeta {
  path: string
  links: LinkRef[]
  tags: TagRef[]
  headings: HeadingRef[]
  frontmatter: Record<string, unknown> | null
  tasks: TaskRef[]
  wordCount: number
}

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g
const MDLINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const TASK = /^\s*[-*+]\s+\[(.)\]\s+(.*)$/

export function splitLinkText(raw: string): { link: string; subpath?: string; display?: string } {
  let display: string | undefined
  let target = raw
  const pipe = raw.indexOf('|')
  if (pipe >= 0) {
    display = raw.slice(pipe + 1).trim()
    target = raw.slice(0, pipe)
  }
  let subpath: string | undefined
  const hash = target.indexOf('#')
  if (hash >= 0) {
    subpath = target.slice(hash)
    target = target.slice(0, hash)
  }
  return { link: target.trim(), subpath, display }
}

/** Parse simple YAML frontmatter (scalars, inline lists, dash lists). */
export function parseFrontmatter(src: string): { data: Record<string, unknown> | null; endLine: number; endOffset: number } {
  if (!src.startsWith('---')) return { data: null, endLine: -1, endOffset: 0 }
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src)
  if (!m) return { data: null, endLine: -1, endOffset: 0 }
  const body = m[1]
  const data: Record<string, unknown> = {}
  let currentKey: string | null = null
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as unknown[]) : []
      arr.push(parseScalar(listItem[1]))
      data[currentKey] = arr
      continue
    }
    const kv = /^([^:#]+?):\s*(.*)$/.exec(line)
    if (kv) {
      currentKey = kv[1].trim()
      const v = kv[2].trim()
      if (v === '') data[currentKey] = null
      else if (v.startsWith('[') && v.endsWith(']'))
        data[currentKey] = v
          .slice(1, -1)
          .split(',')
          .map((s) => parseScalar(s.trim()))
          .filter((s) => s !== '')
      else data[currentKey] = parseScalar(v)
    }
  }
  const endLine = m[0].split(/\r?\n/).length - (m[2] ? 1 : 0) - 1
  return { data, endLine, endOffset: m[0].length }
}

function parseScalar(v: string): unknown {
  const s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

export function parseMarkdown(path: string, src: string): FileMeta {
  const meta: FileMeta = { path, links: [], tags: [], headings: [], frontmatter: null, tasks: [], wordCount: 0 }
  const fm = parseFrontmatter(src)
  meta.frontmatter = fm.data
  if (fm.data) {
    const t = fm.data.tags ?? fm.data.tag
    const list = Array.isArray(t) ? t : typeof t === 'string' ? t.split(/[,\s]+/) : []
    for (const x of list) if (typeof x === 'string' && x) meta.tags.push({ tag: x.replace(/^#/, ''), line: 0 })
  }
  const lines = src.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''
  let words = 0
  for (let i = fm.endLine + 1; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) inFence = false
      continue
    }
    if (inFence) continue
    words += (line.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length

    const h = HEADING.exec(line)
    if (h) meta.headings.push({ level: h[1].length, text: h[2].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2'), line: i })

    const task = TASK.exec(line)
    if (task) meta.tasks.push({ line: i, done: task[1] !== ' ', text: task[2] })

    // strip inline code before scanning links / tags
    const scan = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
    let m: RegExpExecArray | null
    WIKILINK.lastIndex = 0
    while ((m = WIKILINK.exec(scan))) {
      const parts = splitLinkText(m[2])
      meta.links.push({ ...parts, line: i, col: m.index, embed: m[1] === '!' })
    }
    MDLINK.lastIndex = 0
    while ((m = MDLINK.exec(scan))) {
      const url = m[3]
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue
      let target: string
      try {
        target = decodeURIComponent(url)
      } catch {
        target = url
      }
      const parts = splitLinkText(target)
      meta.links.push({ link: parts.link, subpath: parts.subpath, display: m[2], line: i, col: m.index, embed: m[1] === '!', markdown: true })
    }
    TAG.lastIndex = 0
    // ignore headings' leading #s (they're followed by a space so regex won't match them) and link urls like (#anchor)
    const tagScan = scan.replace(/\]\([^)\s]*\)/g, (u) => ' '.repeat(u.length))
    while ((m = TAG.exec(tagScan))) meta.tags.push({ tag: m[2], line: i })
  }
  meta.wordCount = words
  return meta
}

/** Links contained in a .canvas file (file nodes + wikilinks inside text nodes) */
export function parseCanvasLinks(path: string, src: string): FileMeta {
  const meta: FileMeta = { path, links: [], tags: [], headings: [], frontmatter: null, tasks: [], wordCount: 0 }
  try {
    const data = JSON.parse(src) as { nodes?: Array<{ type: string; file?: string; text?: string; fields?: Record<string, unknown> }> }
    const scan = (text: string): void => {
      const sub = parseMarkdown(path, text)
      meta.links.push(...sub.links.map((l) => ({ ...l, line: 0 })))
      meta.tags.push(...sub.tags.map((t) => ({ ...t, line: 0 })))
    }
    for (const n of Array.isArray(data?.nodes) ? data.nodes : []) {
      if (!n || typeof n !== 'object') continue
      if (n.type === 'file' && n.file) meta.links.push({ link: n.file, line: 0, col: 0, embed: true, markdown: true })
      // text cards and form-map cards (body + any [[link]] in text fields)
      if ((n.type === 'text' || n.type === 'form') && n.text) scan(n.text)
      if (n.type === 'form' && n.fields)
        for (const v of Object.values(n.fields)) if (typeof v === 'string' && v.includes('[[')) scan(v)
    }
  } catch {
    /* invalid canvas json */
  }
  return meta
}

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}
