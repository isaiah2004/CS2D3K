// Vault file watcher.
// chokidar creates one native watcher per file and directory; on Windows each costs ~1–2 ms of blocking work in
// the main process, so opening a 32k-note vault froze the main process (and with it every IPC call, including the
// initial file listing) for tens of seconds. Windows and macOS have native recursive watching (one OS handle for
// the whole tree), so there a single recursive fs.watch is used and chokidar's events are reconstructed from it:
// add / change / unlink / addDir / unlinkDir with absolute paths, after the initial scan ("ready"), with changes
// reported once the file stopped changing (like chokidar's awaitWriteFinish). Elsewhere chokidar is used as before.
import { EventEmitter } from 'events'
import { watch as fsWatch, promises as fsp, type FSWatcher as NodeWatcher, type Stats } from 'fs'
import { join, sep } from 'path'
import { watch as chokidarWatch } from 'chokidar'

export type WatchEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface TreeWatcher {
  on(event: 'all', cb: (ev: WatchEvent, path: string) => void): this
  on(event: 'error', cb: (e: unknown) => void): this
  once(event: 'ready', cb: () => void): this
  close(): Promise<void>
}

export interface TreeWatcherOptions {
  /** absolute path → skip it (and, for folders, everything inside) */
  ignored: (abs: string) => boolean
  /** a file is reported once it was quiet this long (chokidar's awaitWriteFinish.stabilityThreshold) */
  stabilityMs?: number
  /** size / mtime poll interval while waiting for a write to finish */
  pollMs?: number
}

export function createTreeWatcher(root: string, opts: TreeWatcherOptions): TreeWatcher {
  if (process.platform === 'win32' || process.platform === 'darwin') return new NativeTreeWatcher(root, opts)
  return chokidarWatch(root, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: opts.stabilityMs ?? 80, pollInterval: opts.pollMs ?? 30 },
    ignored: opts.ignored
  }) as unknown as TreeWatcher
}

export class NativeTreeWatcher extends EventEmitter implements TreeWatcher {
  private readonly root: string
  private readonly ignored: (abs: string) => boolean
  private readonly stabilityMs: number
  private readonly pollMs: number
  private fsw: NodeWatcher | null
  /** every known entry below the root: absolute path → is a folder */
  private known = new Map<string, boolean>()
  private timers = new Map<string, NodeJS.Timeout>()
  /** paths being checked; true = another check was requested meanwhile */
  private checking = new Map<string, boolean>()
  /** raw events that arrived during the initial scan */
  private queued: Set<string> | null = new Set()
  private closed = false

  constructor(root: string, opts: TreeWatcherOptions) {
    super()
    this.root = root
    this.ignored = opts.ignored
    this.stabilityMs = opts.stabilityMs ?? 80
    this.pollMs = opts.pollMs ?? 30
    // start watching before scanning so nothing that happens during the scan is missed
    this.fsw = fsWatch(root, { recursive: true }, (_type, name) => this.raw(name))
    this.fsw.on('error', (e) => !this.closed && this.emit('error', e))
    void this.scan(root, false).then(() => {
      if (this.closed) return
      const queued = this.queued!
      this.queued = null
      this.emit('ready')
      for (const p of queued) this.schedule(p)
    })
  }

  async close(): Promise<void> {
    this.closed = true
    this.fsw?.close()
    this.fsw = null
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  private raw(name: string | Buffer | null): void {
    if (this.closed) return
    if (name == null) {
      // the OS dropped events (buffer overflow): reconcile with a rescan
      void this.resync()
      return
    }
    const abs = join(this.root, name.toString())
    if (this.ignored(abs)) return
    if (this.queued) this.queued.add(abs)
    else this.schedule(abs)
  }

  private schedule(abs: string): void {
    const t = this.timers.get(abs)
    if (t) clearTimeout(t)
    this.timers.set(
      abs,
      setTimeout(() => {
        this.timers.delete(abs)
        void this.check(abs)
      }, this.stabilityMs)
    )
  }

  private async check(abs: string): Promise<void> {
    if (this.checking.has(abs)) {
      this.checking.set(abs, true)
      return
    }
    this.checking.set(abs, false)
    try {
      await this.reconcile(abs)
    } finally {
      const again = this.checking.get(abs)
      this.checking.delete(abs)
      if (again && !this.closed) this.schedule(abs)
    }
  }

  /** compare the path with what is known and emit the difference */
  private async reconcile(abs: string): Promise<void> {
    const st = await stat(abs)
    if (this.closed) return
    const was = this.known.get(abs)
    if (!st) {
      if (was === true) this.removeDir(abs)
      else if (was === false) {
        this.known.delete(abs)
        this.emit('all', 'unlink', abs)
      }
      return
    }
    if (st.isDirectory()) {
      if (was === true) return
      if (was === false) {
        this.known.delete(abs)
        this.emit('all', 'unlink', abs)
      }
      this.known.set(abs, true)
      this.emit('all', 'addDir', abs)
      // a folder moved or copied in: report its contents too
      await this.scan(abs, true)
      return
    }
    if (was === true) this.removeDir(abs)
    // wait until the write finished: size and mtime unchanged over one poll interval
    let prev = st
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, this.pollMs))
      const cur = await stat(abs)
      if (this.closed) return
      if (!cur) return this.reconcile(abs)
      if (cur.size === prev.size && cur.mtimeMs === prev.mtimeMs) break
      prev = cur
    }
    const known = this.known.get(abs) === false
    this.known.set(abs, false)
    this.emit('all', known ? 'change' : 'add', abs)
  }

  private removeDir(abs: string): void {
    const prefix = abs + sep
    const inside = [...this.known.keys()].filter((p) => p.startsWith(prefix)).sort((a, b) => b.length - a.length)
    for (const p of inside) {
      const dir = this.known.get(p)
      this.known.delete(p)
      this.emit('all', dir ? 'unlinkDir' : 'unlink', p)
    }
    this.known.delete(abs)
    this.emit('all', 'unlinkDir', abs)
  }

  /** register everything below `dir`; `report` emits add / addDir for it (folders moved in) */
  private async scan(dir: string, report: boolean): Promise<void> {
    let items: import('fs').Dirent[]
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of items) {
      if (this.closed) return
      const abs = join(dir, d.name)
      if (this.ignored(abs) || this.known.has(abs)) continue
      let isDir = d.isDirectory()
      if (d.isSymbolicLink()) isDir = !!(await stat(abs))?.isDirectory()
      this.known.set(abs, isDir)
      if (report) this.emit('all', isDir ? 'addDir' : 'add', abs)
      // symlinked folders are listed but not descended into (the OS watcher does not follow them either)
      if (isDir && !d.isSymbolicLink()) await this.scan(abs, report)
    }
  }

  private async resync(): Promise<void> {
    if (this.queued) return
    const before = new Map(this.known)
    this.known.clear()
    await this.scan(this.root, false)
    if (this.closed) return
    for (const [p, dir] of before) if (!this.known.has(p)) this.emit('all', dir ? 'unlinkDir' : 'unlink', p)
    for (const [p, dir] of this.known) if (!before.has(p)) this.emit('all', dir ? 'addDir' : 'add', p)
  }
}

async function stat(abs: string): Promise<Stats | null> {
  try {
    return await fsp.stat(abs)
  } catch {
    return null
  }
}
