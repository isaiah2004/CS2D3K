// Persistent metadata cache: the parsed FileMeta of every indexed file, keyed by path + mtime + size, so opening a
// vault only re-reads and re-parses files that changed since it was last open (`.cs2d3k/cache/metadata.json`).
//
// Format: newline-delimited JSON, so it can be decoded in time slices instead of one long JSON.parse.
//   line 0   {"format":1,"parser":PARSER_VERSION,"paths":[…every file and folder of the vault, folders end in "/"…]}
//   line 1…  [path, mtime, size, links, tags, headings, frontmatter, tasks, wordCount, resolved, unresolved]
// Links, tags, headings and tasks are stored as compact arrays (see encodeMeta). `resolved` lists the link targets as
// [index into `paths`, count, …]: link resolution only depends on the set of paths, so as long as that set did not
// change in a way that matters for a file's links (see `changedNames` / `linksAffected`), the stored resolution is
// still right and the whole "linking" pass can be skipped for that file.
import type { FileEntry } from '@shared/types'
import { PARSER_VERSION, type FileMeta, type LinkRef } from './mdparse'
import { TimeSlicer } from './timeSlice'

export const CACHE_NAME = 'metadata'
/** bump when the file layout below changes */
export const CACHE_FORMAT = 1

export type LinkCounts = Record<string, number>

/** one indexed file as stored in the cache */
export interface CachedFile {
  path: string
  mtime: number
  size: number
  meta: FileMeta
  /** link resolution against the cache's path set; null = resolve on load */
  res: LinkCounts | null
  unres: LinkCounts | null
}

export interface CacheData {
  /** vault entries the resolutions were computed against (folders end in "/") */
  paths: string[]
  files: Map<string, CachedFile>
}

/** "path" for files, "path/" for folders — the identity used for the path set */
export const entryKey = (f: Pick<FileEntry, 'path' | 'isDir'>): string => (f.isDir ? f.path + '/' : f.path)

// ------------------------------------------------------------------ meta <-> arrays

const EMBED = 1
const MARKDOWN = 2
/** the link object has (possibly undefined) `subpath` / `display` keys, like the wikilink parser produces */
const SPLIT_KEYS = 4

type LinkRow = [string, number, number, number, (string | null)?, (string | null)?]
type MetaRow = [
  path: string,
  mtime: number,
  size: number,
  links: LinkRow[],
  tags: (string | number)[],
  headings: (string | number)[],
  frontmatter: Record<string, unknown> | null,
  tasks: (string | number)[],
  wordCount: number,
  res: number[] | null,
  unres: LinkCounts | null
]

function encodeLink(l: LinkRef): LinkRow {
  const flags = (l.embed ? EMBED : 0) | (l.markdown ? MARKDOWN : 0) | ('subpath' in l || 'display' in l ? SPLIT_KEYS : 0)
  const row: LinkRow = [l.link, l.line, l.col, flags]
  if (l.subpath !== undefined) row.push(l.display ?? null, l.subpath)
  else if (l.display !== undefined) row.push(l.display)
  return row
}

function decodeLink(r: LinkRow): LinkRef {
  const flags = r[3]
  const l: LinkRef = { link: r[0], line: r[1], col: r[2], embed: (flags & EMBED) !== 0 }
  if (flags & SPLIT_KEYS) {
    l.subpath = r[5] ?? undefined
    l.display = r[4] ?? undefined
  } else {
    if (r[4] != null) l.display = r[4]
    if (r[5] != null) l.subpath = r[5]
  }
  if (flags & MARKDOWN) l.markdown = true
  return l
}

/** One cache line for a file (without the trailing newline). `index` maps vault paths to their position in `paths`. */
export function encodeFile(f: CachedFile, index: Map<string, number>): string {
  const m = f.meta
  const tags: (string | number)[] = []
  for (const t of m.tags) tags.push(t.tag, t.line)
  const headings: (string | number)[] = []
  for (const h of m.headings) headings.push(h.level, h.text, h.line)
  const tasks: (string | number)[] = []
  for (const t of m.tasks) tasks.push(t.line, t.done ? 1 : 0, t.text)
  let res: number[] | null = null
  if (f.res && f.unres) {
    res = []
    for (const [target, count] of Object.entries(f.res)) {
      const i = index.get(target)
      if (i === undefined) {
        // not part of the stored path set: resolve again on load
        res = null
        break
      }
      res.push(i, count)
    }
  }
  const row: MetaRow = [f.path, f.mtime, f.size, m.links.map(encodeLink), tags, headings, m.frontmatter, tasks, m.wordCount, res, res ? f.unres : null]
  return JSON.stringify(row)
}

function decodeFile(row: MetaRow, paths: string[]): CachedFile {
  const [path, mtime, size, links, tags, headings, frontmatter, tasks, wordCount, resRow, unres] = row
  const meta: FileMeta = { path, links: links.map(decodeLink), tags: [], headings: [], frontmatter, tasks: [], wordCount }
  for (let i = 0; i < tags.length; i += 2) meta.tags.push({ tag: tags[i] as string, line: tags[i + 1] as number })
  for (let i = 0; i < headings.length; i += 3)
    meta.headings.push({ level: headings[i] as number, text: headings[i + 1] as string, line: headings[i + 2] as number })
  for (let i = 0; i < tasks.length; i += 3) meta.tasks.push({ line: tasks[i] as number, done: tasks[i + 1] === 1, text: tasks[i + 2] as string })
  let res: LinkCounts | null = null
  if (resRow && unres) {
    res = {}
    for (let i = 0; i < resRow.length; i += 2) {
      const p = paths[resRow[i]]
      if (p === undefined) {
        res = null
        break
      }
      res[p.endsWith('/') ? p.slice(0, -1) : p] = resRow[i + 1]
    }
  }
  return { path, mtime, size, meta, res, unres: res ? unres : null }
}

// ------------------------------------------------------------------ whole cache

/** Serialized cache. Lines are memoized per CachedFile object (`lines`), so re-saving after a few changes is cheap. */
export async function encodeCache(paths: string[], files: Iterable<CachedFile>, lines: WeakMap<CachedFile, string>): Promise<string> {
  const index = new Map<string, number>()
  paths.forEach((p, i) => index.set(p.endsWith('/') ? p.slice(0, -1) : p, i))
  const out = [JSON.stringify({ format: CACHE_FORMAT, parser: PARSER_VERSION, paths })]
  const slice = new TimeSlicer(8)
  for (const f of files) {
    let line = lines.get(f)
    if (line === undefined) lines.set(f, (line = encodeFile(f, index)))
    out.push(line)
    if (slice.due) await slice.yield()
  }
  return out.join('\n')
}

/**
 * Parses a cache file. Returns null when it is missing, corrupt or from another format / parser version (the
 * caller then indexes everything). Broken lines are skipped: those files are simply read again.
 * `onFile` sees every decoded file (the loading screen draws the cached graph from them while the vault is listed).
 */
export async function decodeCache(
  text: string | null,
  onFile?: (f: CachedFile) => void,
  onHeader?: (paths: string[]) => void
): Promise<CacheData | null> {
  if (!text) return null
  const nl = text.indexOf('\n')
  let header: { format?: unknown; parser?: unknown; paths?: unknown }
  try {
    header = JSON.parse(nl < 0 ? text : text.slice(0, nl))
  } catch {
    return null
  }
  if (!header || header.format !== CACHE_FORMAT || header.parser !== PARSER_VERSION || !Array.isArray(header.paths)) return null
  const paths = header.paths as string[]
  onHeader?.(paths)
  const files = new Map<string, CachedFile>()
  if (nl < 0) return { paths, files }
  const slice = new TimeSlicer(8)
  let start = nl + 1
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    try {
      const row = JSON.parse(text.slice(start, end)) as MetaRow
      if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number' && typeof row[2] === 'number') {
        const f = decodeFile(row, paths)
        files.set(f.path, f)
        onFile?.(f)
      }
    } catch {
      /* corrupt line: that file gets re-read */
    }
    start = end + 1
    if (slice.due) await slice.yield()
  }
  return { paths, files }
}

// ------------------------------------------------------------------ path set changes

/**
 * Lower-cased names a link could be looked up by that were added or removed between two path sets (files, folders
 * and — for notes — the name without ".md"). Link resolution only ever ends at an entry whose name matches the
 * link's last segment, so links whose last segment is not in this set resolve exactly as before.
 */
export function changedNames(before: string[], after: Iterable<string>): Set<string> {
  const names = new Set<string>()
  const add = (key: string): void => {
    const isDir = key.endsWith('/')
    const p = isDir ? key.slice(0, -1) : key
    const name = p.slice(p.lastIndexOf('/') + 1).toLowerCase()
    names.add(name)
    if (!isDir && name.endsWith('.md')) names.add(name.slice(0, -3))
  }
  const old = new Set(before)
  for (const k of after) {
    if (old.has(k)) old.delete(k)
    else add(k)
  }
  for (const k of old) add(k)
  return names
}

/** Could resolving any of these links give a different result after entries with `names` were added / removed? */
export function linksAffected(links: LinkRef[], names: Set<string>): boolean {
  if (!names.size) return false
  for (const l of links) {
    if (!l.link) continue
    const s = l.link.replace(/\\/g, '/')
    const last = s.slice(s.lastIndexOf('/') + 1).toLowerCase()
    // "folder/", "..", "." resolve relative to something else: always redo
    if (!last || last === '.' || last === '..') return true
    if (names.has(last) || names.has(last + '.md')) return true
  }
  return false
}
