// Loading, saving, external sync and undo/redo history for a .canvas file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFile, saveFile, onExternalChange, broadcastContent, registerFlusher } from '@/lib/fileops'
import { debounce } from '@/lib/util'
import { notice } from '@/store/ui'
import { parseCanvas, serializeCanvas, type CanvasData } from './model'

const MAX_HISTORY = 200
const COALESCE_MS = 1500

export interface UpdateOptions {
  /** false = no undo entry; string = coalesce consecutive updates with the same key */
  history?: boolean | string
}

export interface CanvasDoc {
  data: CanvasData
  loaded: boolean
  /** the file on disk could not be parsed (shown empty, never overwritten unless edited) */
  invalid: boolean
  /** apply a change; returns nothing. fn must return a new object (or the same one for no-op) */
  update(fn: (d: CanvasData) => CanvasData, opts?: UpdateOptions): void
  /** push the current state as an undo entry (used at the start of drags) */
  checkpoint(): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  flush(): void
  /** bumps when data is replaced from outside (file reload / undo) */
  externalVersion: number
}

/** `normalize` repairs loaded data in memory (e.g. form-map shapes); the file is untouched until edited. */
export function useCanvasDoc(path: string, normalize?: (d: CanvasData) => CanvasData): CanvasDoc {
  const normalizeRef = useRef(normalize)
  normalizeRef.current = normalize
  const parse = (text: string): { data: CanvasData; valid: boolean } => {
    const r = parseCanvas(text)
    return r.valid && normalizeRef.current ? { data: normalizeRef.current(r.data), valid: true } : r
  }
  const pathRef = useRef(path)
  pathRef.current = path
  const [data, setData] = useState<CanvasData>({ nodes: [], edges: [] })
  const [loaded, setLoaded] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [, setHistVersion] = useState(0)
  const [externalVersion, setExternalVersion] = useState(0)
  const dataRef = useRef(data)
  const lastSaved = useRef<string | null>(null)
  const undoStack = useRef<CanvasData[]>([])
  const redoStack = useRef<CanvasData[]>([])
  const coalesce = useRef<{ key: string; t: number } | null>(null)
  const listenerRef = useRef<(c: string) => void>(() => {})

  const commit = useCallback((next: CanvasData) => {
    dataRef.current = next
    setData(next)
  }, [])

  const save = useMemo(
    () =>
      debounce(() => {
        const s = serializeCanvas(dataRef.current)
        if (s === lastSaved.current) return
        lastSaved.current = s
        const p = pathRef.current
        saveFile(p, s)
          .then(() => broadcastContent(p, s, listenerRef.current))
          .catch((e) => {
            // tell the user (read-only file, disk full…) and let the next change retry the same content
            if (lastSaved.current === s) lastSaved.current = null
            notice(`Couldn't save "${p}": ${(e as Error).message}`, 'error')
          })
      }, 500),
    []
  )

  const pushUndo = useCallback((snapshot: CanvasData) => {
    undoStack.current.push(snapshot)
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
    setHistVersion((v) => v + 1)
  }, [])

  const update = useCallback(
    (fn: (d: CanvasData) => CanvasData, opts?: UpdateOptions) => {
      const prev = dataRef.current
      const next = fn(prev)
      if (next === prev) return
      const h = opts?.history ?? true
      if (h !== false) {
        const key = typeof h === 'string' ? h : null
        const now = Date.now()
        const c = coalesce.current
        if (!(key && c && c.key === key && now - c.t < COALESCE_MS)) pushUndo(prev)
        coalesce.current = key ? { key, t: now } : null
      }
      commit(next)
      setInvalid(false)
      save()
    },
    [commit, save, pushUndo]
  )

  const checkpoint = useCallback(() => {
    coalesce.current = null
    pushUndo(dataRef.current)
  }, [pushUndo])

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(dataRef.current)
    coalesce.current = null
    commit(prev)
    setHistVersion((v) => v + 1)
    setExternalVersion((v) => v + 1)
    save()
  }, [commit, save])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(dataRef.current)
    coalesce.current = null
    commit(next)
    setHistVersion((v) => v + 1)
    setExternalVersion((v) => v + 1)
    save()
  }, [commit, save])

  // initial load
  useEffect(() => {
    let cancelled = false
    readFile(pathRef.current)
      .then((text) => {
        if (cancelled) return
        const { data: d, valid } = parse(text)
        // saves only happen after user edits, so invalid files are never overwritten until then
        lastSaved.current = valid ? serializeCanvas(d) : null
        setInvalid(!valid)
        commit(d)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        // unreadable (locked, permissions, vanished): treat like an invalid file so it isn't silently replaced
        lastSaved.current = null
        setInvalid(true)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // external changes (other app, link updater, another tab)
  useEffect(() => {
    const cb = (content: string): void => {
      const { data: d, valid } = parse(content)
      if (!valid) return
      setInvalid(false)
      const s = serializeCanvas(d)
      if (s === serializeCanvas(dataRef.current)) {
        lastSaved.current = s
        return
      }
      save.cancel()
      undoStack.current.push(dataRef.current)
      lastSaved.current = s
      commit(d)
      setExternalVersion((v) => v + 1)
      setHistVersion((v) => v + 1)
    }
    listenerRef.current = cb
    return onExternalChange(path, cb)
  }, [path, commit, save])

  // flush pending save on unmount / window close / vault close
  useEffect(() => {
    const unregister = registerFlusher(() => save.flush())
    return () => {
      unregister()
      save.flush()
    }
  }, [save])

  return {
    data,
    loaded,
    invalid,
    update,
    checkpoint,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    flush: save.flush,
    externalVersion
  }
}
