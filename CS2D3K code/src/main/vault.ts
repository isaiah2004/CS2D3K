import { promises as fsp, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'fs'
import { join, resolve, relative, sep, basename, dirname, extname } from 'path'
import { shell } from 'electron'
import { createTreeWatcher, type TreeWatcher } from './watcher'
import { statMany, STAT_FIELDS } from './statMany'
import type { FileEntry, FsEvent, SearchOptions, SearchResult, TextFile, ThemeInfo } from '@shared/types'
import { CONFIG_DIR, MAX_TEXT_SIZE } from '@shared/types'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.cs2d3k', '.obsidian', '.trash', '__pycache__', '.venv', 'target', '.next', 'out', 'dist'])
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svgz', 'pdf', 'zip', 'gz', 'tar', '7z', 'rar', 'exe', 'dll', 'so',
  'dylib', 'bin', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'class', 'jar',
  'pyc', 'o', 'a', 'lib', 'obj', 'pdb', 'node', 'wasm', 'psd', 'sqlite', 'db'
])
/** parallel file reads in readAll (enough to saturate the disk, far below the open-file limit) */
const READ_CONCURRENCY = 64
async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([fsp.stat(a, { bigint: true }), fsp.stat(b, { bigint: true })])
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

const JOURNAL_SUFFIX = '.cs2d3k-journal'

async function writeSynced(file: string, content: string): Promise<void> {
  const fh = await fsp.open(file, 'w')
  try {
    await fh.writeFile(content, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** hidden journal file that holds a complete copy of `file`'s new content while it is being written */
export function journalPath(file: string): string {
  return join(dirname(file), `.${basename(file)}${JOURNAL_SUFFIX}`)
}

/**
 * Crash-safe save that keeps the file's identity (created time, hard links, ACLs):
 *  1. write the new content to a temp file, fsync, and rename it to the journal — the journal only ever exists complete
 *  2. write the target in place (fsync)
 *  3. delete the journal
 * If the app dies during step 2, `recoverJournal` restores the target from the journal on the next vault open.
 * Hidden (dot-prefixed) journal/temp names are ignored by the explorer and the watcher.
 */
export async function durableWrite(file: string, content: string): Promise<void> {
  const journal = journalPath(file)
  const tmp = `${journal}.tmp`
  await writeSynced(tmp, content)
  await fsp.rename(tmp, journal)
  await writeSynced(file, content)
  await fsp.rm(journal, { force: true })
}

/** Finishes or discards an interrupted `durableWrite`. `name` is the hidden file's name inside `dir`. */
export async function recoverJournal(dir: string, name: string): Promise<'restored' | 'discarded' | null> {
  const abs = join(dir, name)
  if (name.endsWith(`${JOURNAL_SUFFIX}.tmp`)) {
    // crashed before the journal was complete: the target was never touched
    await fsp.rm(abs, { force: true })
    return 'discarded'
  }
  if (!name.startsWith('.') || !name.endsWith(JOURNAL_SUFFIX)) return null
  const target = join(dir, name.slice(1, -JOURNAL_SUFFIX.length))
  await writeSynced(target, await fsp.readFile(abs, 'utf8'))
  await fsp.rm(abs, { force: true })
  return 'restored'
}

export class Vault {
  readonly root: string
  readonly name: string
  private watcher: TreeWatcher | null = null
  private pending: FsEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private listeners: [(events: FsEvent[]) => void, () => void] | null = null
  /** tail of the mutation queue (see `serial`) */
  private ops: Promise<unknown> = Promise.resolve()
  /** file list / cache reads started right when the vault opened, handed to the renderer's first request */
  private prefetched: { list: Promise<FileEntry[]> | null; caches: Map<string, Promise<string | null>> } = { list: null, caches: new Map() }

  constructor(root: string) {
    this.root = resolve(root)
    this.name = basename(this.root)
    // migrate config from the app's previous names
    for (const old of ['.cs2dek', '.vaultide']) {
      const legacy = join(this.root, old)
      if (!existsSync(legacy) || existsSync(join(this.root, CONFIG_DIR))) continue
      try {
        renameSync(legacy, join(this.root, CONFIG_DIR))
      } catch {
        /* keep going with a fresh config folder */
      }
    }
    mkdirSync(join(this.root, CONFIG_DIR, 'themes'), { recursive: true })
    mkdirSync(join(this.root, CONFIG_DIR, 'snippets'), { recursive: true })
  }

  /** vault path -> absolute path, refusing anything that escapes the vault */
  abs(p: string): string {
    const a = resolve(this.root, p || '.')
    // a drive root (C:\ or /) already ends with the separator
    const base = this.root.endsWith(sep) ? this.root : this.root + sep
    if (a !== this.root && !a.startsWith(base)) throw new Error(`Path escapes vault: ${p}`)
    return a
  }

  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/')
  }

  /**
   * Mutations run one at a time in call (= IPC arrival) order, so a save sent right before a
   * rename / delete / vault switch lands first instead of racing it (and resurrecting the old path).
   */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(fn, fn)
    this.ops = run.catch(() => {})
    return run
  }

  /** Resolves once every queued write / rename / delete has finished. */
  idle(): Promise<void> {
    return this.ops.then(() => {})
  }

  private async entryFor(abs: string, st?: import('fs').Stats): Promise<FileEntry> {
    st = st ?? (await fsp.stat(abs))
    const name = basename(abs)
    const isDir = st.isDirectory()
    return {
      path: this.rel(abs),
      name,
      isDir,
      ext: isDir ? '' : extname(name).slice(1).toLowerCase(),
      mtime: st.mtimeMs,
      ctime: st.birthtimeMs || st.ctimeMs,
      size: st.size
    }
  }

  static isHidden(name: string): boolean {
    return name.startsWith('.') || IGNORED_DIRS.has(name)
  }

  /**
   * Finishes saves that were interrupted by a crash (see `durableWrite`). Run once when the vault opens, before
   * anything reads files. Returns the vault paths that were restored.
   */
  async recoverInterruptedWrites(): Promise<string[]> {
    const restored: string[] = []
    const seen = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
      let items: import('fs').Dirent[]
      try {
        const real = await fsp.realpath(dir)
        if (seen.has(real)) return
        seen.add(real)
        items = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      await Promise.all(
        items.map(async (d) => {
          if (d.isDirectory()) {
            // config lives in a hidden folder but is written the same way
            if (d.name === CONFIG_DIR || !Vault.isHidden(d.name)) await walk(join(dir, d.name))
            return
          }
          if (!d.name.includes(JOURNAL_SUFFIX)) return
          try {
            if ((await recoverJournal(dir, d.name)) === 'restored') restored.push(this.rel(join(dir, d.name.slice(1, -JOURNAL_SUFFIX.length))))
          } catch (e) {
            console.error('could not recover', join(dir, d.name), e)
          }
        })
      )
    }
    await walk(this.root)
    return restored
  }

  /** Every (non-hidden) file and folder of the vault: the folders are walked first, then everything is stat'ed at once. */
  async list(): Promise<FileEntry[]> {
    const paths: string[] = []
    // real paths of visited folders: a symlink pointing at an ancestor must not recurse forever
    const seen = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
      let items: import('fs').Dirent[]
      try {
        const real = await fsp.realpath(dir)
        if (seen.has(real)) return
        seen.add(real)
        items = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      await Promise.all(
        items.map(async (d) => {
          if (Vault.isHidden(d.name)) return
          const abs = join(dir, d.name)
          paths.push(abs)
          let isDir = d.isDirectory()
          // symlinks (and entries of unknown type) are folders if what they point to is one
          if (!isDir && !d.isFile()) isDir = !!(await fsp.stat(abs).catch(() => null))?.isDirectory()
          if (isDir) await walk(abs)
        })
      )
    }
    await walk(this.root)
    const st = await statMany(paths)
    const out: FileEntry[] = []
    for (let i = 0; i < paths.length; i++) {
      const o = i * STAT_FIELDS
      if (Number.isNaN(st[o])) continue // vanished
      const isDir = st[o + 3] === 1
      const name = basename(paths[i])
      out.push({
        path: this.rel(paths[i]),
        name,
        isDir,
        ext: isDir ? '' : extname(name).slice(1).toLowerCase(),
        mtime: st[o],
        ctime: st[o + 1],
        size: st[o + 2]
      })
    }
    return out
  }

  async readText(p: string): Promise<string> {
    return fsp.readFile(this.abs(p), 'utf8')
  }

  writeText(p: string, content: string): Promise<FileEntry> {
    return this.serial(async () => {
      const a = this.abs(p)
      await fsp.mkdir(dirname(a), { recursive: true })
      await durableWrite(a, content)
      return this.entryFor(a)
    })
  }

  createFile(p: string, content = ''): Promise<FileEntry> {
    return this.serial(async () => {
      const a = this.abs(p)
      if (existsSync(a)) throw new Error(`File already exists: ${p}`)
      await fsp.mkdir(dirname(a), { recursive: true })
      await fsp.writeFile(a, content, { encoding: 'utf8', flag: 'wx' })
      return this.entryFor(a)
    })
  }

  mkdir(p: string): Promise<FileEntry> {
    return this.serial(async () => {
      const a = this.abs(p)
      await fsp.mkdir(a, { recursive: true })
      return this.entryFor(a)
    })
  }

  rename(from: string, to: string): Promise<void> {
    return this.serial(() => this.doRename(from, to))
  }

  private async doRename(from: string, to: string): Promise<void> {
    const a = this.abs(from)
    const b = this.abs(to)
    if (a === b) return
    // allow case-only renames on case-insensitive file systems (target is then the source itself)
    if (existsSync(b) && !(a.toLowerCase() === b.toLowerCase() && (await sameFile(a, b))))
      throw new Error(`Target already exists: ${to}`)
    await fsp.mkdir(dirname(b), { recursive: true })
    await this.unlocked(() => fsp.rename(a, b))
  }

  trash(p: string): Promise<void> {
    return this.serial(() => this.doTrash(p))
  }

  private async doTrash(p: string): Promise<void> {
    const a = this.abs(p)
    if (a === this.root) throw new Error('Refusing to delete the vault root')
    const remove = async (): Promise<void> => {
      try {
        await shell.trashItem(a)
      } catch {
        await fsp.rm(a, { recursive: true, force: true })
      }
    }
    if ((await fsp.stat(a)).isDirectory()) await this.paused(remove)
    else await remove()
  }

  private async unlocked<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (!this.watcher || (code !== 'EPERM' && code !== 'EBUSY')) throw e
      return this.paused(fn)
    }
  }

  private async paused<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.watcher) return fn()
    await this.watcher.close()
    this.watcher = null
    try {
      return await fn()
    } finally {
      if (this.listeners) {
        this.startWatching(...this.listeners)
        await new Promise<void>((r) => this.watcher?.once('ready', () => r()))
      }
    }
  }

  copy(from: string, to: string): Promise<void> {
    return this.serial(async () => {
      const b = this.abs(to)
      if (existsSync(b)) throw new Error(`Target already exists: ${to}`)
      await fsp.cp(this.abs(from), b, { recursive: true })
    })
  }

  async exists(p: string): Promise<boolean> {
    return existsSync(this.abs(p))
  }

  async stat(p: string): Promise<FileEntry | null> {
    try {
      return await this.entryFor(this.abs(p))
    } catch {
      return null
    }
  }

  async readAll(exts: string[]): Promise<TextFile[]> {
    const set = new Set(exts.map((e) => e.toLowerCase()))
    const files = (await this.list()).filter((f) => !f.isDir && set.has(f.ext) && f.size <= MAX_TEXT_SIZE)
    // bounded concurrency: tens of thousands of simultaneous reads exhaust the process' file handles (EMFILE),
    // and those files used to be skipped silently (a 32k-note vault only got a quarter of its notes indexed)
    const out: (TextFile | null)[] = new Array(files.length).fill(null)
    let next = 0
    const reader = async (): Promise<void> => {
      while (next < files.length) {
        const f = files[next++]
        const i = next - 1
        try {
          out[i] = { path: f.path, content: await this.readText(f.path), mtime: f.mtime }
        } catch {
          /* vanished or unreadable */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, reader))
    return out.filter((x): x is TextFile => !!x)
  }

  /**
   * Reads a batch of text files (the renderer indexes a vault in batches like this, so it can show progress and
   * parse while the next batch is read). null for files that vanished, can't be read or are too big.
   */
  async readMany(paths: string[]): Promise<(string | null)[]> {
    const out: (string | null)[] = new Array(paths.length).fill(null)
    let next = 0
    const reader = async (): Promise<void> => {
      while (next < paths.length) {
        const i = next++
        try {
          const text = await this.readText(paths[i])
          if (text.length <= MAX_TEXT_SIZE) out[i] = text
        } catch {
          /* vanished, unreadable or outside the vault */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, reader))
    return out
  }

  // ---------- prefetch (startup) ----------

  /**
   * Starts listing the vault and reading its caches right away, so the work overlaps with the window and the
   * renderer starting up. The first `takeList` / `takeCache` gets the prefetched result, later calls read fresh.
   */
  prefetch(caches: string[]): void {
    const list = this.list()
    list.catch(() => {})
    this.prefetched.list = list
    for (const name of caches) {
      // read right away (synchronously): asynchronously it would queue behind the listing's stat calls, and the
      // renderer decodes the cache while the listing is still running
      let text: string | null = null
      try {
        text = readFileSync(this.cacheFile(name), 'utf8')
      } catch {
        /* none yet */
      }
      this.prefetched.caches.set(name, Promise.resolve(text))
    }
  }

  takeList(): Promise<FileEntry[]> {
    const p = this.prefetched.list
    this.prefetched.list = null
    return p ?? this.list()
  }

  takeCache(name: string): Promise<string | null> {
    const p = this.prefetched.caches.get(name)
    this.prefetched.caches.delete(name)
    return p ?? this.readCache(name)
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const { query, caseSensitive = false, regex = false, maxResults = 500 } = opts
    if (!query.trim()) return []
    let re: RegExp
    try {
      const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      re = new RegExp(src, caseSensitive ? 'g' : 'gi')
    } catch {
      return []
    }
    const extSet = opts.exts ? new Set(opts.exts) : null
    const files = (await this.list())
      .filter((f) => !f.isDir && f.size <= MAX_TEXT_SIZE && !BINARY_EXTS.has(f.ext) && (!extSet || extSet.has(f.ext)))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
    const results: SearchResult[] = []
    let total = 0
    // file name matches first
    for (const f of files) {
      if (total >= maxResults) break
      let content: string
      try {
        content = await fsp.readFile(this.abs(f.path), 'utf8')
      } catch {
        continue
      }
      if (content.includes('\u0000')) continue
      const lines = content.split(/\r?\n/)
      const matches: SearchResult['matches'] = []
      for (let i = 0; i < lines.length && matches.length < 50; i++) {
        re.lastIndex = 0
        const m = re.exec(lines[i])
        if (m) {
          let text = lines[i]
          let start = m.index
          // trim very long lines around the match
          if (text.length > 240) {
            const from = Math.max(0, start - 80)
            text = (from > 0 ? '…' : '') + text.slice(from, from + 240)
            start = start - from + (from > 0 ? 1 : 0)
          }
          matches.push({ line: i, text, start, end: start + Math.max(1, m[0].length) })
        }
      }
      const nameHit = (() => {
        re.lastIndex = 0
        return re.test(f.name)
      })()
      if (matches.length || nameHit) {
        results.push({ path: f.path, matches })
        total += Math.max(1, matches.length)
      }
    }
    return results
  }

  // ---------- config (.cs2d3k) ----------

  /** absolute path inside the config folder, refusing anything that escapes it */
  configPath(...parts: string[]): string {
    const base = join(this.root, CONFIG_DIR)
    const p = resolve(base, ...parts)
    if (p !== base && !p.startsWith(base + sep)) throw new Error(`Path escapes the config folder: ${parts.join('/')}`)
    return p
  }

  /** `.cs2d3k/<name>.json`; names are plain identifiers like "app" or "workspace" */
  private configFile(name: string): string {
    if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid config name: ${name}`)
    return this.configPath(`${name}.json`)
  }

  async readConfig<T>(name: string): Promise<T | null> {
    const file = this.configFile(name)
    let text: string
    try {
      // small files, read synchronously: while a vault opens the async file system queue is full of the listing's
      // stat calls, and settings / layout reads would wait behind them
      text = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    try {
      return JSON.parse(text) as T
    } catch {
      // unreadable (hand-edited, half-written…): keep a copy before the app saves defaults over it
      await fsp.copyFile(file, `${file}.bak`).catch(() => {})
      return null
    }
  }

  writeConfig(name: string, data: unknown): Promise<void> {
    return this.serial(async () => {
      const file = this.configFile(name)
      await fsp.mkdir(this.configPath(), { recursive: true })
      await durableWrite(file, JSON.stringify(data, null, 2))
    })
  }

  // ---------- caches (.cs2d3k/cache) ----------

  private cacheFile(name: string): string {
    if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid cache name: ${name}`)
    return this.configPath('cache', `${name}.json`)
  }

  async readCache(name: string): Promise<string | null> {
    try {
      return await fsp.readFile(this.cacheFile(name), 'utf8')
    } catch {
      return null
    }
  }

  /** Replaces a cache file atomically (temp file + rename): readers see the old or the new cache, never half of one. */
  writeCache(name: string, text: string): Promise<void> {
    return this.serial(async () => {
      const file = this.cacheFile(name)
      const dir = dirname(file)
      await fsp.mkdir(dir, { recursive: true })
      // caches are machine-local and rebuilt on demand: keep them out of version control
      const ignore = join(dir, '.gitignore')
      if (!existsSync(ignore)) await fsp.writeFile(ignore, '*\n').catch(() => {})
      const tmp = `${file}.${process.pid}.tmp`
      try {
        await fsp.writeFile(tmp, text, 'utf8')
        await fsp.rename(tmp, file)
      } catch (e) {
        await fsp.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
    })
  }

  private async listCss(sub: 'themes' | 'snippets'): Promise<ThemeInfo[]> {
    const dir = this.configPath(sub)
    const out: ThemeInfo[] = []
    try {
      // synchronous for the same reason as readConfig
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isFile() && d.name.endsWith('.css')) {
          out.push({ name: d.name.replace(/\.css$/, ''), path: `${CONFIG_DIR}/${sub}/${d.name}` })
        } else if (d.isDirectory() && existsSync(join(dir, d.name, 'theme.css'))) {
          out.push({ name: d.name, path: `${CONFIG_DIR}/${sub}/${d.name}/theme.css` })
        }
      }
    } catch {
      /* none */
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  listThemes(): Promise<ThemeInfo[]> {
    return this.listCss('themes')
  }

  listSnippets(): Promise<ThemeInfo[]> {
    return this.listCss('snippets')
  }

  async readCss(p: string): Promise<string> {
    const a = this.abs(p)
    if (!a.endsWith('.css')) throw new Error('Not a css file')
    return readFileSync(a, 'utf8')
  }

  // ---------- watching ----------

  startWatching(onEvents: (events: FsEvent[]) => void, onCss: () => void): void {
    this.listeners = [onEvents, onCss]
    this.watcher = createTreeWatcher(this.root, {
      stabilityMs: 80,
      pollMs: 30,
      ignored: (p: string) => {
        const r = this.rel(p)
        if (!r) return false
        const parts = r.split('/')
        // keep watching .cs2d3k/themes and .cs2d3k/snippets
        if (parts[0] === CONFIG_DIR) return !(parts.length === 1 || parts[1] === 'themes' || parts[1] === 'snippets')
        return parts.some((s) => Vault.isHidden(s))
      }
    })
    const push = async (type: FsEvent['type'], abs: string): Promise<void> => {
      const path = this.rel(abs)
      if (path.startsWith(CONFIG_DIR + '/') || path === CONFIG_DIR) {
        if (path.endsWith('.css') || type === 'unlinkDir' || type === 'addDir') onCss()
        return
      }
      const ev: FsEvent = { type, path }
      if (type === 'add' || type === 'change' || type === 'addDir') {
        try {
          ev.entry = await this.entryFor(abs)
        } catch {
          return
        }
      }
      this.pending.push(ev)
      if (!this.flushTimer)
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null
          const evs = this.pending
          this.pending = []
          onEvents(evs)
        }, 60)
    }
    this.watcher.on('all', (ev, p) => {
      if (ev === 'add' || ev === 'change' || ev === 'unlink' || ev === 'addDir' || ev === 'unlinkDir') void push(ev, p)
    })
    this.watcher.on('error', (e) => console.error('watcher error', e))
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.listeners = null
    await this.watcher?.close()
    this.watcher = null
  }
}
