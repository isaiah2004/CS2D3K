// One Monaco text model per vault file, shared by every tab showing that file.
// Owns saving (auto-save debounce / manual), dirty tracking and external-change reloads.
import * as monaco from 'monaco-editor'
import { saveFile, onExternalChange, broadcastContent } from '@/lib/fileops'
import { monacoLang } from '@/lib/filetypes'
import { basename } from '@/lib/path'
import { getSettings } from '@/store/settings'
import { confirmDialog, notice } from '@/store/ui'
import { dropVaultLib, restoreVaultLib } from './vaultLibs'

const AUTOSAVE_MS = 600

export interface ModelEntry {
  path: string
  model: monaco.editor.ITextModel
  refs: number
  /** alternative version id at the last save/load */
  savedVersion: number
  timer: ReturnType<typeof setTimeout> | null
  applyingExternal: boolean
  listeners: Set<() => void>
  onExternal: (content: string) => void
  /** `keepLib`: hand the content back to the TS worker as an extra lib */
  dispose(keepLib?: boolean): void
}

const entries = new Map<string, ModelEntry>()

export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'file', path: '/' + path })
}

export function getEntry(path: string): ModelEntry | undefined {
  return entries.get(path)
}

export function isDirty(e: ModelEntry): boolean {
  return e.model.getAlternativeVersionId() !== e.savedVersion
}

function notify(e: ModelEntry): void {
  e.listeners.forEach((fn) => fn())
}

/** Subscribe to dirty-state / save changes of an entry. */
export function onEntryChange(e: ModelEntry, fn: () => void): () => void {
  e.listeners.add(fn)
  return () => e.listeners.delete(fn)
}

function cancelTimer(e: ModelEntry): void {
  if (e.timer) clearTimeout(e.timer)
  e.timer = null
}

export async function saveEntry(e: ModelEntry): Promise<void> {
  cancelTimer(e)
  if (e.model.isDisposed()) return
  const content = e.model.getValue()
  const version = e.model.getAlternativeVersionId()
  try {
    await saveFile(e.path, content)
  } catch (err) {
    notice(`Could not save "${basename(e.path)}": ${(err as Error).message}`, 'error')
    return
  }
  e.savedVersion = version
  broadcastContent(e.path, content, e.onExternal)
  notify(e)
}

function scheduleSave(e: ModelEntry): void {
  cancelTimer(e)
  e.timer = setTimeout(() => {
    e.timer = null
    void saveEntry(e)
  }, AUTOSAVE_MS)
}

/** Save now if an auto-save is pending. */
export function flushEntry(e: ModelEntry): void {
  if (e.timer) void saveEntry(e)
}

/** Replace the model content with minimal edits so cursors / scroll positions survive. */
function applyExternal(e: ModelEntry, content: string): void {
  const model = e.model
  const old = model.getValue()
  const next = content.replace(/\r\n?/g, model.getEOL() === '\r\n' ? '\r\n' : '\n')
  if (old !== next) {
    let start = 0
    const max = Math.min(old.length, next.length)
    while (start < max && old.charCodeAt(start) === next.charCodeAt(start)) start++
    let endOld = old.length
    let endNew = next.length
    while (endOld > start && endNew > start && old.charCodeAt(endOld - 1) === next.charCodeAt(endNew - 1)) {
      endOld--
      endNew--
    }
    const a = model.getPositionAt(start)
    const b = model.getPositionAt(endOld)
    e.applyingExternal = true
    try {
      model.pushStackElement()
      model.pushEditOperations([], [{ range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: next.slice(start, endNew) }], () => null)
      model.pushStackElement()
    } finally {
      e.applyingExternal = false
    }
  }
  e.savedVersion = model.getAlternativeVersionId()
  notify(e)
}

function createEntry(path: string, content: string): ModelEntry {
  dropVaultLib(path)
  const uri = modelUri(path)
  const lang = monacoLang(path)
  let model = monaco.editor.getModel(uri)
  if (model) {
    if (model.getValue() !== content) model.setValue(content)
    monaco.editor.setModelLanguage(model, lang)
  } else {
    model = monaco.editor.createModel(content, lang, uri)
  }
  const tabSize = getSettings().tabSize
  model.detectIndentation(true, tabSize)

  let asking = false
  const e: ModelEntry = {
    path,
    model,
    refs: 0,
    savedVersion: model.getAlternativeVersionId(),
    timer: null,
    applyingExternal: false,
    listeners: new Set(),
    onExternal: (text) => {
      if (e.model.isDisposed()) return
      if (text === e.model.getValue()) {
        e.savedVersion = e.model.getAlternativeVersionId()
        notify(e)
        return
      }
      if (!isDirty(e)) {
        applyExternal(e, text)
        return
      }
      if (asking) return
      asking = true
      void confirmDialog({
        title: 'File changed on disk',
        message: `"${basename(e.path)}" was changed outside the editor. Reload it and discard your unsaved changes?`,
        okLabel: 'Reload',
        danger: true
      }).then((ok) => {
        asking = false
        if (ok && !e.model.isDisposed()) {
          cancelTimer(e)
          applyExternal(e, text)
        }
      })
    },
    dispose: () => {}
  }
  const subs = [
    model.onDidChangeContent(() => {
      if (e.applyingExternal) return
      notify(e)
      if (getSettings().codeAutoSave) scheduleSave(e)
    }),
    onExternalChange(path, e.onExternal)
  ]
  e.dispose = (keepLib = true) => {
    cancelTimer(e)
    for (const s of subs) (typeof s === 'function' ? s() : s.dispose())
    e.listeners.clear()
    if (!model.isDisposed()) {
      if (keepLib) restoreVaultLib(e.path, model.getValue())
      model.dispose()
    }
    if (entries.get(e.path) === e) entries.delete(e.path)
  }
  entries.set(path, e)
  return e
}

/** Get (or create) the shared model for a file and take a reference on it. */
export function acquireModel(path: string, content: string): ModelEntry {
  const e = entries.get(path) ?? createEntry(path, content)
  e.refs++
  return e
}

/**
 * Drop a reference. When the last tab goes away, pending or unsaved changes are written
 * (never lose work), then the model is disposed.
 */
export function releaseModel(e: ModelEntry, opts: { save?: boolean } = {}): void {
  e.refs = Math.max(0, e.refs - 1)
  if (opts.save === false) cancelTimer(e)
  if (e.refs > 0) return
  if (opts.save !== false && (e.timer || isDirty(e))) {
    void saveEntry(e).finally(() => {
      if (e.refs === 0) e.dispose()
    })
    return
  }
  e.dispose(opts.save !== false)
}

/**
 * Take a reference on the model for a file's new path after a rename, carrying over content and
 * dirty state. The caller switches its editor to the result, then releases the old entry with
 * `releaseModel(old, { save: false })`.
 */
export function renameModel(e: ModelEntry, newPath: string): ModelEntry {
  const existing = entries.get(newPath)
  if (existing) {
    existing.refs++
    return existing
  }
  const dirty = isDirty(e) || !!e.timer
  cancelTimer(e)
  const next = createEntry(newPath, e.model.getValue())
  next.refs++
  // undo history can't be carried over to a new model URI; keep the dirty flag though
  if (dirty) {
    next.savedVersion = -1
    if (getSettings().codeAutoSave) scheduleSave(next)
  }
  return next
}

/** Re-detect indentation of every open model (tabSize setting changed). */
export function updateIndentation(tabSize: number): void {
  for (const e of entries.values()) e.model.detectIndentation(true, tabSize)
}
