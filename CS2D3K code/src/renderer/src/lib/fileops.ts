// High level file operations used by explorer, commands, editors.
import { useVault, fileExists } from '@/store/vault'
import { useWorkspace, getActiveFile } from '@/store/workspace'
import { useMetadata, resolveLink, linkTextFor, stampMetadata } from '@/store/metadata'
import { getSettings } from '@/store/settings'
import { notice, confirmDialog } from '@/store/ui'
import { basename, dirname, extname, isChildOf, join, stem, uniquePath } from './path'
import { splitLinkText } from './mdparse'
import { useBookmarks } from '@/store/bookmarks'

/** Files parsed into the metadata index (links, tags…) */
export const INDEXED_EXTS = ['md', 'canvas', 'formmap']
export function isIndexedPath(path: string): boolean {
  return INDEXED_EXTS.includes(extname(path))
}

// ------------------------------------------------------------- self-write tracking

/** last content we wrote per path, so watcher echoes can be ignored */
const lastWritten = new Map<string, string>()
const externalListeners = new Map<string, Set<(content: string) => void>>()

/**
 * Contents written in the last few seconds per path. A watcher event for an earlier save can be read back
 * after a newer save was sent; that stale echo must not be taken for an external edit (it would roll the
 * editor back and cancel the pending save of what the user typed since).
 */
const recentWrites = new Map<string, { content: string; at: number }[]>()
const ECHO_MS = 3000

function rememberWrite(path: string, content: string): void {
  const now = Date.now()
  const list = (recentWrites.get(path) ?? []).filter((w) => now - w.at < ECHO_MS).slice(-4)
  list.push({ content, at: now })
  recentWrites.set(path, list)
}

function isRecentWrite(path: string, content: string): boolean {
  const now = Date.now()
  return !!recentWrites.get(path)?.some((w) => w.content === content && now - w.at < ECHO_MS)
}

export async function saveFile(path: string, content: string): Promise<void> {
  lastWritten.set(path, content)
  rememberWrite(path, content)
  const entry = await window.api.fs.writeText(path, content)
  useVault.getState().upsert(entry)
  if (isIndexedPath(path)) {
    useMetadata.getState().updateContent(path, content)
    stampMetadata(path, entry)
  }
}

export async function readFile(path: string): Promise<string> {
  const c = await window.api.fs.readText(path)
  lastWritten.set(path, c)
  return c
}

/** Subscribe to changes of a file made outside this view (other app, other tab, link updater). */
export function onExternalChange(path: string, cb: (content: string) => void): () => void {
  let set = externalListeners.get(path)
  if (!set) externalListeners.set(path, (set = new Set()))
  set.add(cb)
  return () => {
    set!.delete(cb)
  }
}

/** Called by the fs watcher bridge for 'change' events. */
export async function notifyFileChanged(path: string): Promise<void> {
  const listeners = externalListeners.get(path)
  const isIndexed = isIndexedPath(path)
  if (!listeners?.size && !isIndexed) return
  let content: string
  try {
    content = await window.api.fs.readText(path)
  } catch {
    return
  }
  // our own save (possibly an older one, read back late): the editor and the index already have newer content
  if (lastWritten.get(path) === content || isRecentWrite(path, content)) return
  if (isIndexed) useMetadata.getState().updateContent(path, content)
  lastWritten.set(path, content)
  listeners?.forEach((cb) => cb(content))
}

/** Broadcast new content to other views of the same file (e.g. two tabs). */
export function broadcastContent(path: string, content: string, except?: (content: string) => void): void {
  externalListeners.get(path)?.forEach((cb) => {
    if (cb !== except) cb(content)
  })
}

// ------------------------------------------------------------- flush on exit

const flushers = new Set<() => void>()

/** Register a function that flushes pending (debounced) saves; called before the window unloads. */
export function registerFlusher(fn: () => void): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

export function flushAll(): void {
  flushers.forEach((fn) => {
    try {
      fn()
    } catch (e) {
      console.error('flush failed', e)
    }
  })
}

// ------------------------------------------------------------- creation

function newNoteFolder(): string {
  const s = getSettings()
  if (s.newNoteLocation === 'folder') return s.newNoteFolder
  if (s.newNoteLocation === 'current') {
    const active = getActiveFile()
    return active ? dirname(active) : ''
  }
  return ''
}

export async function createNote(folder?: string, name = 'Untitled', content = '', open: 'tab' | 'replace' | false = 'replace'): Promise<string> {
  const dir = folder ?? newNoteFolder()
  const path = uniquePath(join(dir, `${name}.md`), fileExists)
  const entry = await window.api.fs.createFile(path, content)
  useVault.getState().upsert(entry)
  useMetadata.getState().updateContent(path, content)
  stampMetadata(path, entry)
  if (open) useWorkspace.getState().openFile(path, { target: open === 'tab' ? 'tab' : undefined, state: { mode: getSettings().defaultViewMode === 'reading' ? 'live' : undefined, focusTitle: true } })
  return path
}

export async function createCanvas(folder?: string, name = 'Untitled'): Promise<string> {
  const dir = folder ?? newNoteFolder()
  const path = uniquePath(join(dir, `${name}.canvas`), fileExists)
  const content = JSON.stringify({ nodes: [], edges: [] }, null, '\t')
  const entry = await window.api.fs.createFile(path, content)
  useVault.getState().upsert(entry)
  useWorkspace.getState().openFile(path)
  return path
}

/** New .formmap — opens on the template picker (empty content). */
export async function createFormMap(folder?: string, name = 'Untitled form-map', content = ''): Promise<string> {
  const dir = folder ?? newNoteFolder()
  const path = uniquePath(join(dir, `${name}.formmap`), fileExists)
  const entry = await window.api.fs.createFile(path, content)
  useVault.getState().upsert(entry)
  useWorkspace.getState().openFile(path)
  return path
}

/** Copies a .canvas into a new .formmap next to it (the original canvas is kept). */
export async function convertCanvasToFormMap(canvasPath: string): Promise<string | null> {
  try {
    const raw = await window.api.fs.readText(canvasPath)
    const data = raw.trim() ? JSON.parse(raw) : { nodes: [], edges: [] }
    data.formmap = { version: 1, template: 'converted' }
    return await createFormMap(dirname(canvasPath), stem(canvasPath), JSON.stringify(data, null, '	'))
  } catch (e) {
    notice(`Could not convert: ${(e as Error).message}`, 'error')
    return null
  }
}

export async function createFile(folder: string, name: string, content = '', open = true): Promise<string> {
  const path = uniquePath(join(folder, name), fileExists)
  const entry = await window.api.fs.createFile(path, content)
  useVault.getState().upsert(entry)
  if (path.endsWith('.md')) useMetadata.getState().updateContent(path, content)
  if (open) useWorkspace.getState().openFile(path)
  return path
}

export async function createFolder(parent = '', name = 'Untitled'): Promise<string> {
  const path = uniquePath(join(parent, name), fileExists)
  const entry = await window.api.fs.mkdir(path)
  useVault.getState().upsert(entry)
  return path
}

/** Opens link text from a note; creates the note if unresolved. */
export async function openLinkText(linktext: string, sourcePath: string, newTab = false): Promise<void> {
  const { link, subpath } = splitLinkText(linktext)
  const target = resolveLink(link, sourcePath)
  const target2 = target ?? (link ? null : sourcePath)
  const state = subpath ? { subpath } : undefined
  if (target2) {
    useWorkspace.getState().openFile(target2, { target: newTab ? 'tab' : undefined, state })
    return
  }
  // create new note for unresolved link
  const folder = link.includes('/') ? dirname(link) : newNoteFolder()
  const name = basename(link).replace(/\.md$/i, '')
  const path = join(folder, `${name}.md`)
  if (!fileExists(path)) {
    try {
      const entry = await window.api.fs.createFile(path, '')
      useVault.getState().upsert(entry)
    } catch (e) {
      // e.g. [[Why?]] on Windows, where ? : * " < > | are not allowed in file names
      notice(`Couldn't create "${path}": ${(e as Error).message}`, 'error')
      return
    }
    useMetadata.getState().updateContent(path, '')
    useMetadata.getState().reresolve()
  }
  useWorkspace.getState().openFile(path, { target: newTab ? 'tab' : undefined, state })
}

// ------------------------------------------------------------- rename / move

/** Relative path from folder `fromDir` to vault path `to`, e.g. "../x/y.md" */
function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : []
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

/** Rewrites links in `content` (file `oldSrc`, now at `src`) whose target or source moved. */
function rewriteLinks(content: string, src: string, oldSrc: string, moved: Map<string, string>, oldResolve: Map<string, string | null>): string {
  const isCanvas = src.endsWith('.canvas') || src.endsWith('.formmap')
  const rewriteWiki = (text: string): string =>
    text.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (full, bang: string, inner: string) => {
      const { link, subpath, display } = splitLinkText(inner)
      const old = oldResolve.get(link)
      if (!old || !moved.has(old)) return full
      const nt = linkTextFor(moved.get(old)!)
      return `${bang}[[${nt}${subpath ?? ''}${display !== undefined ? '|' + display : ''}]]`
    })
  const rewriteMd = (text: string): string =>
    text.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (full, bang: string, label: string, url: string, title?: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return full
      let dec = url
      try {
        dec = decodeURIComponent(url)
      } catch {
        /* keep */
      }
      const { link } = splitLinkText(dec)
      const old = oldResolve.get(link)
      if (!old) return full
      const np = moved.get(old) ?? old
      // links that resolved relative to the linking file stay relative (portable markdown)
      const relOld = join(dirname(oldSrc), link)
      const wasRelative = relOld === old || relOld + '.md' === old
      if (np === old && (!wasRelative || src === oldSrc)) return full
      const out = wasRelative ? relativePath(dirname(src), np) : np
      const rawSub = url.includes('#') ? url.slice(url.indexOf('#')) : ''
      return `${bang}[${label}](${encodeURI(out)}${rawSub}${title ?? ''})`
    })
  if (isCanvas) {
    try {
      const data = JSON.parse(content)
      let changed = false
      const fix = (text: string): string => {
        const next = rewriteMd(rewriteWiki(text))
        if (next !== text) changed = true
        return next
      }
      for (const n of data.nodes ?? []) {
        if (n.type === 'file' && n.file && moved.has(n.file)) {
          n.file = moved.get(n.file)
          changed = true
        }
        // text cards and form-map cards (body + linking fields), cf. parseCanvasLinks
        if ((n.type === 'text' || n.type === 'form') && typeof n.text === 'string') n.text = fix(n.text)
        if (n.type === 'form' && n.fields && typeof n.fields === 'object')
          for (const [k, v] of Object.entries(n.fields)) if (typeof v === 'string') n.fields[k] = fix(v)
      }
      return changed ? JSON.stringify(data, null, '\t') : content
    } catch {
      return content
    }
  }
  return rewriteMd(rewriteWiki(content))
}

export async function renamePath(from: string, to: string): Promise<boolean> {
  if (from === to) return true
  if (fileExists(to) && from.toLowerCase() !== to.toLowerCase()) {
    notice(`"${to}" already exists`, 'error')
    return false
  }
  // make sure open editors have written their latest edits before links are captured / rewritten
  flushAll()
  await new Promise((r) => setTimeout(r, 50))
  const vault = useVault.getState()
  // everything that moves
  const moved = new Map<string, string>()
  for (const p of Object.keys(vault.files)) if (isChildOf(p, from)) moved.set(p, to + p.slice(from.length))

  // capture link resolution before the move
  const meta = useMetadata.getState()
  const affected: { src: string; resolve: Map<string, string | null> }[] = []
  if (getSettings().updateLinksOnRename) {
    for (const [src, targets] of Object.entries(meta.resolved)) {
      // sources linking to a moved file, and moved sources (their relative links may need fixing)
      if (!moved.has(src) && !Object.keys(targets).some((t) => moved.has(t))) continue
      const m = new Map<string, string | null>()
      // skip heading-only links ([[#H]]): they point at the file itself and never need rewriting
      for (const l of meta.metas[src]?.links ?? []) if (l.link) m.set(l.link, resolveLink(l.link, src))
      affected.push({ src, resolve: m })
    }
  }

  try {
    await window.api.fs.rename(from, to)
  } catch (e) {
    notice(`Rename failed: ${(e as Error).message}`, 'error')
    return false
  }
  // the watcher reports moved files as new: keep their last known content so that echo isn't taken for an
  // external edit (which would overwrite what the user typed into the renamed note in the meantime)
  for (const [o, n] of moved) {
    const known = lastWritten.get(o)
    lastWritten.delete(o)
    if (known !== undefined) lastWritten.set(n, known)
  }
  vault.renameLocal(from, to)
  useWorkspace.getState().onRename(from, to)
  useBookmarks.getState().onRename(from, to)
  // move metadata entries
  const metas = { ...useMetadata.getState().metas }
  for (const [o, n] of moved) {
    if (metas[o]) {
      metas[n] = { ...metas[o], path: n }
      delete metas[o]
    }
  }
  useMetadata.setState({ metas })

  let updatedFiles = 0
  for (const a of affected) {
    const srcNow = moved.get(a.src) ?? a.src
    try {
      const content = await window.api.fs.readText(srcNow)
      const next = rewriteLinks(content, srcNow, a.src, moved, a.resolve)
      if (next !== content) {
        await saveFile(srcNow, next)
        broadcastContent(srcNow, next)
        updatedFiles++
      }
    } catch (e) {
      console.warn('link update failed for', srcNow, e)
    }
  }
  useMetadata.getState().reresolve()
  if (updatedFiles) notice(`Updated links in ${updatedFiles} file${updatedFiles > 1 ? 's' : ''}`)
  return true
}

export async function moveToFolder(path: string, folder: string): Promise<boolean> {
  if (dirname(path) === folder || isChildOf(folder, path)) return false
  return renamePath(path, join(folder, basename(path)))
}

export async function deletePath(path: string, confirm = true): Promise<boolean> {
  const f = useVault.getState().files[path]
  if (!f) return false
  if (confirm && getSettings().confirmDelete) {
    const ok = await confirmDialog({
      title: f.isDir ? 'Delete folder' : 'Delete file',
      message: `Are you sure you want to delete "${f.name}"${f.isDir ? ' and everything in it' : ''}? It will be moved to the system trash.`,
      okLabel: 'Delete',
      danger: true
    })
    if (!ok) return false
  }
  // write pending edits first: an editor closed by the delete would otherwise save and recreate the file
  flushAll()
  try {
    await window.api.fs.trash(path)
  } catch (e) {
    notice(`Delete failed: ${(e as Error).message}`, 'error')
    return false
  }
  useWorkspace.getState().onDelete(path)
  useVault.getState().removeLocal(path)
  const metas = useMetadata.getState().metas
  for (const p of Object.keys(metas)) if (isChildOf(p, path)) useMetadata.getState().remove(p)
  useMetadata.getState().reresolve()
  return true
}

export async function deletePaths(paths: string[]): Promise<void> {
  if (paths.length === 1) {
    await deletePath(paths[0])
    return
  }
  if (getSettings().confirmDelete) {
    const ok = await confirmDialog({
      title: 'Delete files',
      message: `Are you sure you want to delete ${paths.length} items? They will be moved to the system trash.`,
      okLabel: 'Delete',
      danger: true
    })
    if (!ok) return
  }
  for (const p of paths) await deletePath(p, false)
}

export async function duplicatePath(path: string): Promise<string | null> {
  const ext = extname(path)
  const target = uniquePath(join(dirname(path), `${stem(path)} copy${ext ? '.' + ext : ''}`), fileExists)
  try {
    await window.api.fs.copy(path, target)
    const st = await window.api.fs.stat(target)
    if (st) useVault.getState().upsert(st)
    if (ext === 'md') useMetadata.getState().updateContent(target, await window.api.fs.readText(target))
    return target
  } catch (e) {
    notice(`Duplicate failed: ${(e as Error).message}`, 'error')
    return null
  }
}
