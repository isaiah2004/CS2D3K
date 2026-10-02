import { create } from 'zustand'
import { parseMarkdown, parseCanvasLinks, type FileMeta } from '@/lib/mdparse'
import { useVault, allFiles } from './vault'
import { basename, dirname, extname, join, stem } from '@/lib/path'
import { MAX_TEXT_SIZE, type FileEntry } from '@shared/types'
import { CACHE_NAME, changedNames, decodeCache, encodeCache, entryKey, linksAffected, type CachedFile, type LinkCounts } from '@/lib/metaCache'
import { TimeSlicer } from '@/lib/timeSlice'

/**
 * Metadata index for the vault: parsed links / tags / headings for every
 * markdown and canvas file, plus resolved link graph.
 */
interface MetadataStore {
  metas: Record<string, FileMeta>
  /** source path -> target path -> count */
  resolved: Record<string, Record<string, number>>
  /** source path -> unresolved link text -> count */
  unresolved: Record<string, Record<string, number>>
  version: number
  ready: boolean
  /**
   * Indexes the vault (its file list must be loaded, or be loading: see `IndexOptions.files`). Files whose
   * path + mtime + size match the persistent metadata cache are taken from it; the rest are read and parsed in
   * batches, yielding to the event loop in between so the UI stays responsive, and reporting progress.
   */
  indexAll(opts?: IndexOptions): Promise<void>
  /** re-parse given content (from editor or watcher) */
  updateContent(path: string, content: string): void
  remove(path: string): void
  /** recompute link resolution after files were added/removed/renamed */
  reresolve(): void
}

export type IndexStage = 'scanning' | 'reading' | 'linking'

export interface IndexProgress {
  stage: IndexStage
  /** notes indexed so far (from the cache + read) */
  done: number
  /** notes to index; 0 until the vault is listed */
  total: number
  /** notes taken from the metadata cache */
  cached: number
  /** notes read from disk so far */
  read: number
  /** notes read and parsed per second */
  rate: number
}

/** a note as it gets indexed, with the vault paths its links resolve to */
export interface IndexedNote {
  path: string
  targets: string[]
}

export interface IndexOptions {
  /** the metadata cache's text, if reading it already started (default: read it now) */
  cache?: Promise<string | null>
  /** resolves when the vault's file list is loaded; lets decoding the cache overlap with listing the vault */
  files?: Promise<unknown>
  onProgress?(p: IndexProgress): void
  /**
   * Notes as they are indexed (cached ones first), e.g. to grow the loading screen's graph. `expected` estimates
   * how many notes will arrive in total (0 = not known yet).
   */
  onNotes?(notes: IndexedNote[], expected: number): void
}

export interface IndexStats {
  /** indexable notes in the vault */
  total: number
  /** taken from the metadata cache */
  cached: number
  /** read from disk */
  read: number
  /** listed but unreadable */
  failed: number
  /** a valid cache file was found */
  cacheFound: boolean
  ms: number
}

/** what the last `indexAll` did (test hooks, benchmarks) */
export let lastIndexStats: IndexStats | null = null

const INDEXED = new Set(['md', 'canvas', 'formmap'])
/** files read concurrently by the main process per request, and requests kept in flight */
const READ_INFLIGHT = 4
const PROGRESS_MS = 60

let nameIndex: Map<string, string[]> = new Map()
let nameIndexVersion = -1

function buildNameIndex(): Map<string, string[]> {
  const v = useVault.getState().version
  if (v === nameIndexVersion) return nameIndex
  nameIndex = new Map()
  for (const f of allFiles()) {
    const keys = [f.name.toLowerCase()]
    if (f.ext === 'md') keys.push(stem(f.name).toLowerCase())
    for (const k of keys) {
      const arr = nameIndex.get(k)
      if (arr) arr.push(f.path)
      else nameIndex.set(k, [f.path])
    }
  }
  // shortest paths first (Obsidian prefers closest to root)
  for (const arr of nameIndex.values()) arr.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)
  nameIndexVersion = v
  return nameIndex
}

/**
 * Resolves link text (e.g. "Note", "folder/Note", "img.png", "../x.md") to a vault path.
 * Returns null if not found.
 */
export function resolveLink(link: string, sourcePath = ''): string | null {
  if (!link) return sourcePath || null
  const files = useVault.getState().files
  let l = link.replace(/\\/g, '/').replace(/^\.\//, '')
  if (l.startsWith('/')) l = l.slice(1)
  const tryPath = (p: string): string | null => {
    if (files[p] && !files[p].isDir) return p
    if (!extname(p) || !files[p]) {
      const md = p + '.md'
      if (files[md]) return md
    }
    return null
  }
  // relative to source folder
  const plain = isPlainPath(l)
  const dir = dirname(sourcePath)
  const rel = tryPath(plain ? (dir ? dir + '/' + l : l) : join(dir, l))
  if (rel) return rel
  // absolute from vault root
  const abs = tryPath(plain ? l : join(l))
  if (abs) return abs
  // by name anywhere
  const idx = buildNameIndex()
  const name = basename(l).toLowerCase()
  const cands = idx.get(name) ?? idx.get(name + '.md')
  if (!cands?.length) return null
  if (l.includes('/')) {
    // match whole path segments only ("folder/note" must not match "xfolder/note.md")
    const suffix = '/' + l.toLowerCase()
    const hit = cands.find((c) => ('/' + c.toLowerCase()).endsWith(suffix) || ('/' + c.toLowerCase()).endsWith(suffix + '.md'))
    if (hit) return hit
  }
  return cands[0]
}

/** no "." / ".." / empty segments: joining it onto a folder is plain concatenation (the hot path of indexing) */
function isPlainPath(l: string): boolean {
  return l !== '' && l[0] !== '/' && !l.includes('./') && !l.includes('//') && !l.endsWith('/') && !l.endsWith('/.') && !l.endsWith('/..') && l !== '.' && l !== '..'
}

/** Shortest link text that uniquely resolves to `target` (for generating links). */
export function linkTextFor(target: string): string {
  const idx = buildNameIndex()
  const isMd = extname(target) === 'md'
  const name = isMd ? stem(target) : basename(target)
  const cands = idx.get(name.toLowerCase()) ?? []
  if (cands.length <= 1 || cands[0] === target) return name
  return isMd ? target.slice(0, -3) : target
}

function computeLinks(meta: FileMeta): { res: LinkCounts; unres: LinkCounts } {
  const res: LinkCounts = {}
  const unres: LinkCounts = {}
  for (const l of meta.links) {
    if (!l.link) continue
    const t = resolveLink(l.link, meta.path)
    if (t) res[t] = (res[t] ?? 0) + 1
    else unres[l.link] = (unres[l.link] ?? 0) + 1
  }
  return { res, unres }
}

function parseFile(path: string, content: string): FileMeta {
  return extname(path) === 'canvas' || extname(path) === 'formmap' ? parseCanvasLinks(path, content) : parseMarkdown(path, content)
}

// ------------------------------------------------------------------ indexing

/** bumped by every indexAll: a newer run (vault switch) makes older ones stop */
let indexRun = 0

/** batches progress callbacks (at most one per PROGRESS_MS, plus every stage change) */
function progressReporter(cb: IndexOptions['onProgress']): (p: IndexProgress, force?: boolean) => void {
  let last = 0
  let stage = ''
  return (p, force) => {
    if (!cb) return
    const now = performance.now()
    if (!force && p.stage === stage && now - last < PROGRESS_MS) return
    last = now
    stage = p.stage
    cb({ ...p })
  }
}

interface NoteSink {
  expected: number
  push(path: string, res: LinkCounts | null): void
  flush(): void
}

/** buffers `onNotes` calls into chunks */
function noteSink(cb: IndexOptions['onNotes']): NoteSink {
  let buf: IndexedNote[] = []
  const flush = (): void => {
    if (!buf.length || !cb) return
    const out = buf
    buf = []
    cb(out, sink.expected)
  }
  const sink: NoteSink = {
    expected: 0,
    push(path, res) {
      if (!cb) return
      buf.push({ path, targets: res ? Object.keys(res) : [] })
      if (buf.length >= 512) flush()
    },
    flush
  }
  return sink
}

const isIndexedName = (p: string): boolean => INDEXED.has(extname(p))

async function indexVault(opts: IndexOptions): Promise<Pick<MetadataStore, 'metas' | 'resolved' | 'unresolved'> | null> {
  const run = ++indexRun
  const t0 = performance.now()
  cancelCacheSave()
  const stale = (): boolean => run !== indexRun
  const report = progressReporter(opts.onProgress)
  const notes = noteSink(opts.onNotes)
  const progress: IndexProgress = { stage: 'scanning', done: 0, total: 0, cached: 0, read: 0, rate: 0 }
  report(progress, true)

  // 1. the cache (usually read by the main process while the window opened). Decoding it overlaps with listing the
  //    vault, and the loading screen can already draw the cached graph meanwhile.
  let cacheText: string | null = null
  try {
    cacheText = await (opts.cache ?? window.api.cache.read(CACHE_NAME))
  } catch {
    /* no cache */
  }
  const cache = await decodeCache(
    cacheText,
    (f) => notes.push(f.path, f.res),
    (paths) => (notes.expected = paths.filter(isIndexedName).length)
  )
  cacheText = null
  notes.flush()
  if (opts.files) await opts.files
  if (stale()) return null

  // 2. which notes the cache still describes (same path, mtime and size)
  const vault = useVault.getState()
  const entries = Object.values(vault.files)
  const indexable = entries.filter((f) => !f.isDir && INDEXED.has(f.ext) && f.size <= MAX_TEXT_SIZE)
  const hits: CachedFile[] = []
  const toRead: FileEntry[] = []
  for (const f of indexable) {
    const c = cache?.files.get(f.path)
    if (c && c.mtime === f.mtime && c.size === f.size) hits.push(c)
    else toRead.push(f)
  }
  const indexed = new Map<string, CachedFile>()
  notes.expected = indexable.length
  progress.stage = 'reading'
  progress.total = indexable.length
  progress.cached = progress.done = hits.length
  if (toRead.length) report(progress, true)

  // 3. read, parse and resolve the others in batches. Several batches are in flight, so the main process keeps
  //    reading while this thread parses; parsing yields every few ms so the loading screen keeps animating.
  const batch = Math.max(32, Math.min(256, Math.ceil(toRead.length / 100)))
  const queue: { files: FileEntry[]; texts: Promise<(string | null)[]> }[] = []
  let next = 0
  const fill = (): void => {
    while (queue.length < READ_INFLIGHT && next < toRead.length) {
      const files = toRead.slice(next, next + batch)
      next += files.length
      const texts = window.api.fs.readMany(files.map((f) => f.path))
      texts.catch(() => {})
      queue.push({ files, texts })
    }
  }
  fill()
  const slice = new TimeSlicer(10)
  const tRead = performance.now()
  let failed = 0
  while (queue.length) {
    const b = queue.shift()!
    const texts = await b.texts
    if (stale()) return null
    fill()
    for (let i = 0; i < b.files.length; i++) {
      const f = b.files[i]
      const text = texts[i]
      progress.read++
      progress.done++
      if (text == null) failed++
      else {
        const meta = parseFile(f.path, text)
        const { res, unres } = computeLinks(meta)
        indexed.set(f.path, { path: f.path, mtime: f.mtime, size: f.size, meta, res, unres })
        notes.push(f.path, res)
      }
      if (slice.due) {
        progress.rate = (progress.read * 1000) / Math.max(1, performance.now() - tRead)
        report(progress)
        notes.flush()
        await slice.yield()
        if (stale()) return null
      }
    }
    progress.rate = (progress.read * 1000) / Math.max(1, performance.now() - tRead)
    report(progress)
  }
  notes.flush()

  // 4. link the cached notes: their stored resolution still holds unless files their links could point to were
  //    added or removed since the cache was written
  progress.stage = 'linking'
  report(progress, true)
  const names = cache ? changedNames(cache.paths, entries.map(entryKey)) : new Set<string>()
  let relinked = 0
  for (const c of hits) {
    if (!c.res || !c.unres || linksAffected(c.meta.links, names)) {
      const { res, unres } = computeLinks(c.meta)
      c.res = res
      c.unres = unres
      relinked++
    }
    indexed.set(c.path, c)
    if (slice.due) {
      await slice.yield()
      if (stale()) return null
    }
  }

  // 5. the index, in file-list order (like a full re-index)
  const metas: Record<string, FileMeta> = {}
  const resolved: Record<string, LinkCounts> = {}
  const unresolved: Record<string, LinkCounts> = {}
  for (const f of indexable) {
    const c = indexed.get(f.path)
    if (!c) continue
    metas[f.path] = c.meta
    resolved[f.path] = c.res!
    unresolved[f.path] = c.unres!
  }

  // 6. remember what is on disk for the next start
  snapshot = { vault: vault.info?.path ?? null, paths: entries.map(entryKey), files: indexed, lines: new WeakMap() }
  if (!cache || toRead.length > 0 || relinked > 0 || cache.files.size !== hits.length || names.size > 0) {
    snapshotDirty = true
    scheduleCacheSave(SAVE_AFTER_INDEX_MS)
  }
  lastIndexStats = {
    total: indexable.length,
    cached: hits.length,
    read: toRead.length - failed,
    failed,
    cacheFound: !!cache,
    ms: Math.round(performance.now() - t0)
  }
  return { metas, resolved, unresolved }
}

export const useMetadata = create<MetadataStore>((set, get) => ({
  metas: {},
  resolved: {},
  unresolved: {},
  version: 0,
  ready: false,
  async indexAll(opts = {}) {
    const result = await indexVault(opts)
    if (!result) return
    set({ ...result, version: get().version + 1, ready: true })
  },
  updateContent(path, content) {
    const meta = parseFile(path, content)
    const { res, unres } = computeLinks(meta)
    const s = get()
    set({
      metas: { ...s.metas, [path]: meta },
      resolved: { ...s.resolved, [path]: res },
      unresolved: { ...s.unresolved, [path]: unres },
      version: s.version + 1
    })
  },
  remove(path) {
    const s = get()
    if (!s.metas[path]) return
    const metas = { ...s.metas }
    delete metas[path]
    set({ metas })
    get().reresolve()
  },
  reresolve() {
    const metas = get().metas
    const resolved: Record<string, Record<string, number>> = {}
    const unresolved: Record<string, Record<string, number>> = {}
    for (const m of Object.values(metas)) {
      const { res, unres } = computeLinks(m)
      resolved[m.path] = res
      unresolved[m.path] = unres
    }
    set({ resolved, unresolved, version: get().version + 1 })
  }
}))

// ------------------------------------------------------------------ metadata cache (persisted)

/** wait after indexing before writing the cache, so it doesn't compete with the first render of the workspace */
const SAVE_AFTER_INDEX_MS = 1200
/** debounce for later changes (notes saved in the app) */
const SAVE_DEBOUNCE_MS = 4000

/**
 * What the cache file will contain: every indexed note as it was read from disk (path, mtime, size, meta), with
 * link resolution against `paths`. An entry stays right for its mtime + size, so notes edited later can stay in it
 * (they just won't match next time); notes saved by the app are added with their new mtime + size.
 */
let snapshot: { vault: string | null; paths: string[]; files: Map<string, CachedFile>; lines: WeakMap<CachedFile, string> } | null = null
let snapshotDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()

function cancelCacheSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  snapshot = null
  snapshotDirty = false
}

function scheduleCacheSave(ms: number): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveMetadataCache()
  }, ms)
}

/**
 * Records that `path`, just written by the app, now has `entry`'s mtime + size and the metadata currently in the
 * index, so the next start doesn't need to read it again.
 */
export function stampMetadata(path: string, entry: Pick<FileEntry, 'mtime' | 'size'>): void {
  const s = snapshot
  const meta = useMetadata.getState().metas[path]
  if (!s || !meta || meta.path !== path) return
  s.files.set(path, { path, mtime: entry.mtime, size: entry.size, meta, res: null, unres: null })
  snapshotDirty = true
  scheduleCacheSave(SAVE_DEBOUNCE_MS)
}

/** Writes the metadata cache now if it has unsaved changes (also called before the vault closes). */
export function saveMetadataCache(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  saving = saving.then(async () => {
    const s = snapshot
    const current = (): boolean => snapshot === s && s?.vault === (useVault.getState().info?.path ?? null)
    if (!s || !snapshotDirty || !current()) return
    snapshotDirty = false
    const text = await encodeCache(s.paths, s.files.values(), s.lines)
    // the vault was switched while encoding: this snapshot belongs to the other one
    if (!current()) return
    try {
      await window.api.cache.write(CACHE_NAME, text)
    } catch (e) {
      console.warn('could not write the metadata cache', e)
    }
  })
  return saving
}

export function getBacklinks(target: string): { source: string; count: number }[] {
  const { resolved } = useMetadata.getState()
  const out: { source: string; count: number }[] = []
  for (const [src, targets] of Object.entries(resolved)) {
    if (src !== target && targets[target]) out.push({ source: src, count: targets[target] })
  }
  return out.sort((a, b) => a.source.localeCompare(b.source))
}

/** All tags with counts (case-insensitive merge, keeps first-seen casing). */
export function getAllTags(): { tag: string; count: number; files: string[] }[] {
  const map = new Map<string, { tag: string; count: number; files: Set<string> }>()
  for (const m of Object.values(useMetadata.getState().metas)) {
    for (const t of m.tags) {
      const k = t.tag.toLowerCase()
      let e = map.get(k)
      if (!e) map.set(k, (e = { tag: t.tag, count: 0, files: new Set() }))
      e.count++
      e.files.add(m.path)
    }
  }
  return [...map.values()].map((e) => ({ tag: e.tag, count: e.count, files: [...e.files] }))
}

export function getMeta(path: string): FileMeta | undefined {
  return useMetadata.getState().metas[path]
}
