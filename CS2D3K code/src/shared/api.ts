import type {
  FileEntry,
  FsEvent,
  RecentVault,
  RunRequest,
  RunResult,
  SearchOptions,
  SearchResult,
  TerminalCreateOptions,
  TextFile,
  ThemeInfo,
  VaultInfo
} from './types'

/** The API exposed on `window.api` by the preload script. */
export interface Cs2d3kApi {
  /** true when launched by the test suite (CS2D3K_TEST=1) — exposes window.__cs2d3k */
  testMode: boolean
  platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'

  app: {
    getRecentVaults(): Promise<RecentVault[]>
    removeRecentVault(path: string): Promise<void>
    /** native folder picker; returns absolute path or null */
    pickFolder(title?: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    getLastVault(): Promise<string | null>
    getVersion(): Promise<string>
    toggleDevTools(): Promise<void>
    reload(): Promise<void>
    /** recolor the native window-controls overlay (Windows/Linux) */
    setTitleBarOverlay(color: string, symbolColor: string): void
  }

  vault: {
    /** Opens (and creates if needed) a vault at absolute path. */
    open(absPath: string): Promise<VaultInfo>
    /** Creates a new vault folder `name` inside `parentAbs` and opens it. */
    create(parentAbs: string, name: string): Promise<VaultInfo>
    close(): Promise<void>
    current(): Promise<VaultInfo | null>
  }

  fs: {
    /** Flat list of every (non-hidden) file and folder in the vault. */
    list(): Promise<FileEntry[]>
    readText(path: string): Promise<string>
    writeText(path: string, content: string): Promise<FileEntry>
    /** Creates file; fails if exists. Parent folders created automatically. */
    createFile(path: string, content?: string): Promise<FileEntry>
    mkdir(path: string): Promise<FileEntry>
    /** Rename or move. */
    rename(from: string, to: string): Promise<void>
    /** Moves to OS trash. */
    trash(path: string): Promise<void>
    copy(from: string, to: string): Promise<void>
    exists(path: string): Promise<boolean>
    stat(path: string): Promise<FileEntry | null>
    /** Reads all files with the given extensions (used for indexing). */
    readAll(exts: string[]): Promise<TextFile[]>
    /** Reads a batch of text files; null for files that vanished, are unreadable or too big. Same order as `paths`. */
    readMany(paths: string[]): Promise<(string | null)[]>
    search(opts: SearchOptions): Promise<SearchResult[]>
    /** Absolute filesystem path for a vault path. */
    absPath(path: string): Promise<string>
    /** URL usable in <img src> etc. */
    resourceUrl(path: string): string
    showInFolder(path: string): Promise<void>
    openWithDefaultApp(path: string): Promise<void>
    /** Subscribe to file system changes. Returns unsubscribe. */
    onChange(cb: (events: FsEvent[]) => void): () => void
  }

  config: {
    /** Reads `.cs2d3k/<name>.json`; returns null if missing. */
    read<T = unknown>(name: string): Promise<T | null>
    write(name: string, data: unknown): Promise<void>
    listThemes(): Promise<ThemeInfo[]>
    listSnippets(): Promise<ThemeInfo[]>
    readCss(path: string): Promise<string>
    /** Opens `.cs2d3k/<sub>` in the OS file manager (creating it). */
    openFolder(sub: string): Promise<void>
    /** Fires when anything under .cs2d3k/themes or /snippets changes. */
    onCssChange(cb: () => void): () => void
  }

  /** Disposable per-vault caches in `.cs2d3k/cache/<name>.json` (e.g. the parsed metadata index). */
  cache: {
    /** the cache file's text, or null if there is none */
    read(name: string): Promise<string | null>
    /** replaces the cache file atomically */
    write(name: string, text: string): Promise<void>
  }

  term: {
    create(opts: TerminalCreateOptions): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
  }

  runner: {
    run(req: RunRequest): Promise<RunResult>
    kill(runId: string): void
    /** streamed output while a run is in progress */
    onOutput(cb: (runId: string, stream: 'stdout' | 'stderr', data: string) => void): () => void
    /** Pre-generated run id so callers can subscribe before run() resolves */
    newRunId(): string
  }
}

declare global {
  interface Window {
    api: Cs2d3kApi
  }
}
