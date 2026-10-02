// Types shared between main, preload and renderer.
// All vault paths are vault-relative and use forward slashes ("folder/note.md").
// The vault root itself is "".

export const CONFIG_DIR = '.cs2d3k'

/** text files above this size are not read for indexing or search */
export const MAX_TEXT_SIZE = 2 * 1024 * 1024

export interface FileEntry {
  path: string
  name: string
  isDir: boolean
  /** lowercase extension without dot, '' for folders / no extension */
  ext: string
  mtime: number
  ctime: number
  size: number
}

export type FsEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FsEvent {
  type: FsEventType
  path: string
  entry?: FileEntry
}

export interface VaultInfo {
  path: string
  name: string
}

export interface RecentVault {
  path: string
  name: string
  lastOpened: number
}

export interface SearchMatch {
  line: number
  /** the full line text (trimmed to a sane length) */
  text: string
  /** column offsets of match inside `text` */
  start: number
  end: number
}

export interface SearchResult {
  path: string
  matches: SearchMatch[]
}

export interface SearchOptions {
  query: string
  caseSensitive?: boolean
  regex?: boolean
  /** restrict to these extensions; default = all text files */
  exts?: string[]
  maxResults?: number
}

export interface TextFile {
  path: string
  content: string
  mtime: number
}

export interface TerminalCreateOptions {
  cwd?: string
  shell?: string
  cols: number
  rows: number
}

export interface RunRequest {
  /** optional id (from runner.newRunId) so output can be streamed */
  runId?: string
  /** language id, e.g. "js", "python" */
  lang: string
  code: string
  /** absolute cwd; defaults to vault root */
  cwd?: string
  /** override command template, e.g. "python {file}" */
  command?: string
  /** extension for temp file */
  ext?: string
}

export interface RunResult {
  runId: string
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
  error?: string
}

export interface ThemeInfo {
  name: string
  /** vault relative path to css */
  path: string
}
