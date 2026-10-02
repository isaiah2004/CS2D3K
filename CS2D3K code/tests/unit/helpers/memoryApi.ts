// In-memory implementation of window.api for renderer unit tests.
// Files live in a Map; every call is async like the real IPC bridge.
import type { Cs2d3kApi } from '@shared/api'
import type { FileEntry, FsEvent, SearchOptions, SearchResult, TextFile } from '@shared/types'

export interface MemoryVault {
  api: Cs2d3kApi
  files: Map<string, string>
  dirs: Set<string>
  config: Map<string, unknown>
  /** `.cs2d3k/cache/<name>.json` files (window.api.cache) */
  caches: Map<string, string>
  /** paths read through fs.readText / fs.readMany / fs.readAll, in order */
  reads: string[]
  /** last-modified time per file (bumped by every write through the api; set it to simulate an external edit) */
  mtimes: Map<string, number>
  /** every write performed through the api, in order */
  writes: { path: string; content: string }[]
  /** simulate a watcher event batch (e.g. an external edit) */
  emitFs(events: FsEvent[]): void
  reset(files?: Record<string, string>): void
}

const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const ext = (p: string): string => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase()
}

export function createMemoryVault(initial: Record<string, string> = {}): MemoryVault {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const config = new Map<string, unknown>()
  const caches = new Map<string, string>()
  const reads: string[] = []
  const mtimes = new Map<string, number>()
  const writes: { path: string; content: string }[] = []
  const fsListeners = new Set<(e: FsEvent[]) => void>()
  let clock = 1_700_000_000_000

  const ensureDirs = (p: string): void => {
    let d = dirname(p)
    while (d) {
      dirs.add(d)
      d = dirname(d)
    }
  }
  const entry = (p: string): FileEntry => {
    const isDir = dirs.has(p)
    const mtime = mtimes.get(p) ?? clock
    return { path: p, name: basename(p), isDir, ext: isDir ? '' : ext(p), mtime, ctime: mtime, size: isDir ? 0 : (files.get(p)?.length ?? 0) }
  }
  const reset = (init: Record<string, string> = {}): void => {
    files.clear()
    dirs.clear()
    config.clear()
    caches.clear()
    reads.length = 0
    mtimes.clear()
    writes.length = 0
    for (const [p, c] of Object.entries(init)) {
      files.set(p, c)
      mtimes.set(p, clock)
      ensureDirs(p)
    }
  }
  reset(initial)

  const notFound = (p: string): never => {
    throw new Error(`ENOENT: ${p}`)
  }
  const noop = (): (() => void) => () => {}

  const api: Cs2d3kApi = {
    testMode: true,
    platform: 'win32',
    app: {
      getRecentVaults: async () => [],
      removeRecentVault: async () => {},
      pickFolder: async () => null,
      openExternal: async () => {},
      getLastVault: async () => null,
      getVersion: async () => '0.0.0-test',
      toggleDevTools: async () => {},
      reload: async () => {},
      setTitleBarOverlay: () => {}
    },
    vault: {
      open: async (p) => ({ path: p, name: basename(p) }),
      create: async (parent, name) => ({ path: `${parent}/${name}`, name }),
      close: async () => {},
      current: async () => ({ path: '/vault', name: 'vault' })
    },
    fs: {
      list: async () => [...[...dirs].map(entry), ...[...files.keys()].map(entry)],
      readText: async (p) => {
        reads.push(p)
        return files.has(p) ? files.get(p)! : notFound(p)
      },
      writeText: async (p, c) => {
        clock++
        files.set(p, c)
        mtimes.set(p, clock)
        ensureDirs(p)
        writes.push({ path: p, content: c })
        return entry(p)
      },
      createFile: async (p, c = '') => {
        if (files.has(p)) throw new Error(`File already exists: ${p}`)
        clock++
        files.set(p, c)
        mtimes.set(p, clock)
        ensureDirs(p)
        writes.push({ path: p, content: c })
        return entry(p)
      },
      mkdir: async (p) => {
        dirs.add(p)
        ensureDirs(p)
        return entry(p)
      },
      rename: async (from, to) => {
        if (files.has(from)) {
          if (files.has(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`Target already exists: ${to}`)
          files.set(to, files.get(from)!)
          files.delete(from)
          mtimes.set(to, mtimes.get(from) ?? clock)
          mtimes.delete(from)
          ensureDirs(to)
          return
        }
        if (!dirs.has(from)) notFound(from)
        for (const [p, c] of [...files]) {
          if (p.startsWith(from + '/')) {
            files.delete(p)
            files.set(to + p.slice(from.length), c)
            mtimes.set(to + p.slice(from.length), mtimes.get(p) ?? clock)
          }
        }
        for (const d of [...dirs]) if (d === from || d.startsWith(from + '/')) {
          dirs.delete(d)
          dirs.add(to + d.slice(from.length))
        }
        ensureDirs(to)
      },
      trash: async (p) => {
        files.delete(p)
        for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f)
        for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d)
      },
      copy: async (from, to) => {
        if (files.has(to)) throw new Error(`Target already exists: ${to}`)
        files.set(to, files.get(from) ?? notFound(from))
        mtimes.set(to, ++clock)
      },
      exists: async (p) => files.has(p) || dirs.has(p),
      stat: async (p) => (files.has(p) || dirs.has(p) ? entry(p) : null),
      readAll: async (exts) =>
        [...files].filter(([p]) => exts.includes(ext(p))).map(([path, content]): TextFile => {
          reads.push(path)
          return { path, content, mtime: mtimes.get(path) ?? clock }
        }),
      readMany: async (paths) =>
        paths.map((p) => {
          reads.push(p)
          return files.get(p) ?? null
        }),
      search: async (opts: SearchOptions): Promise<SearchResult[]> => {
        const q = opts.caseSensitive ? opts.query : opts.query.toLowerCase()
        const out: SearchResult[] = []
        for (const [path, content] of files) {
          const matches = content.split('\n').flatMap((text, line) => {
            const hay = opts.caseSensitive ? text : text.toLowerCase()
            const i = hay.indexOf(q)
            return i >= 0 ? [{ line, text, start: i, end: i + q.length }] : []
          })
          if (matches.length) out.push({ path, matches })
        }
        return out
      },
      absPath: async (p) => `/vault/${p}`,
      resourceUrl: (p) => `vault://local/${p}`,
      showInFolder: async () => {},
      openWithDefaultApp: async () => {},
      onChange: (cb) => {
        fsListeners.add(cb)
        return () => fsListeners.delete(cb)
      }
    },
    config: {
      read: async <T,>(n: string) => (config.has(n) ? (structuredClone(config.get(n)) as T) : null),
      write: async (n, d) => {
        config.set(n, structuredClone(d))
      },
      listThemes: async () => [],
      listSnippets: async () => [],
      readCss: async () => '',
      openFolder: async () => {},
      onCssChange: noop
    },
    cache: {
      read: async (n) => caches.get(n) ?? null,
      write: async (n, t) => {
        caches.set(n, t)
      }
    },
    term: {
      create: async () => 't1',
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: noop,
      onExit: noop
    },
    runner: {
      run: async (req) => ({ runId: req.runId ?? 'r1', code: 0, stdout: '', stderr: '', durationMs: 1 }),
      kill: () => {},
      onOutput: noop,
      newRunId: () => `r${++clock}`
    }
  }

  return {
    api,
    files,
    dirs,
    config,
    caches,
    reads,
    mtimes,
    writes,
    emitFs: (events) => fsListeners.forEach((cb) => cb(events)),
    reset
  }
}
