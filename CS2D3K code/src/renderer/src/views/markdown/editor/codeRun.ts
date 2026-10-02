// Running fenced code blocks from the editor: run state, output widget below the block,
// and the header widget (language label, ▶ Run, copy) on the opening fence line.
import { StateEffect, StateField, MapMode, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { RunResult } from '@shared/types'
import { runCode, type RunHandle } from '@/lib/runCode'
import { RUNNABLE_LANGS } from '@/lib/filetypes'
import { emit } from '@/lib/events'
import { notice } from '@/store/ui'
import { formatHotkey } from '@/store/commands'
import { basename } from '@/lib/path'
import { notePath } from './state'

type Listener = (ev: 'chunk' | 'done', stream?: 'stdout' | 'stderr', text?: string) => void

/** Observable state of one code run (survives widget re-creation). */
export class RunRecord {
  status: 'running' | 'done' = 'running'
  chunks: { stream: 'stdout' | 'stderr'; text: string }[] = []
  result: RunResult | null = null
  failure: string | null = null
  /** killed by the user (stop button, re-run, block deleted) */
  stopped = false
  handle: RunHandle | null = null
  readonly started = Date.now()
  private listeners = new Set<Listener>()

  constructor(readonly lang: string) {}

  push(stream: 'stdout' | 'stderr', text: string): void {
    this.chunks.push({ stream, text })
    this.listeners.forEach((l) => l('chunk', stream, text))
  }
  finish(result: RunResult | null, failure?: string): void {
    this.status = 'done'
    this.result = result
    this.failure = failure ?? null
    this.listeners.forEach((l) => l('done'))
  }
  kill(): void {
    if (this.status !== 'running') return
    this.stopped = true
    this.handle?.kill()
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

const setRun = StateEffect.define<{ pos: number; record: RunRecord }>()
const clearRun = StateEffect.define<RunRecord>()

interface RunEntry {
  pos: number
  record: RunRecord
}

/** Finds the FencedCode node at/around `pos`. */
export function fencedCodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    let n: SyntaxNode | null = tree.resolveInner(pos, side)
    while (n && n.name !== 'FencedCode') n = n.parent
    if (n) return n
  }
  return null
}

/** Language + code (with container indentation stripped) of a fenced code block. */
export function codeBlockInfo(state: EditorState, node: SyntaxNode): { lang: string; code: string } {
  const doc = state.doc
  const info = node.getChild('CodeInfo')
  const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : ''
  const begin = doc.lineAt(node.from)
  const end = doc.lineAt(node.to)
  const marks = node.getChildren('CodeMark')
  const closed = marks.length > 1 && end.number > begin.number
  const prefix = begin.text.slice(0, node.from - begin.from)
  const lines: string[] = []
  for (let i = begin.number + 1; i <= (closed ? end.number - 1 : end.number); i++) {
    let text = doc.line(i).text
    if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length)
    else if (/^\s+$/.test(prefix)) text = text.replace(new RegExp(`^\\s{0,${prefix.length}}`), '')
    lines.push(text)
  }
  return { lang, code: lines.join('\n') }
}

/** Runs the fenced code block at `pos`. Returns false when there is no code block there. */
export function runCodeBlockAt(view: EditorView, pos: number): boolean {
  const node = fencedCodeAt(view.state, pos)
  if (!node) return false
  const { lang, code } = codeBlockInfo(view.state, node)
  if (!RUNNABLE_LANGS.has(lang.toLowerCase())) {
    notice(lang ? `Don't know how to run "${lang}" code` : 'Add a language to the code block to run it', 'error')
    return true
  }
  const sourcePath = view.state.facet(notePath)
  const record = new RunRecord(lang)
  try {
    const handle = runCode(lang, code, { sourcePath, onOutput: (stream, data) => record.push(stream, data) })
    record.handle = handle
    handle.done.then(
      (r) => {
        record.finish(r)
        emit('run-output', {
          title: `${lang} (${basename(sourcePath)})`,
          text: r.stdout + (r.stderr ? `\n${r.stderr}` : ''),
          stream: r.code === 0 && !r.error ? 'stdout' : 'stderr'
        })
      },
      (e) => record.finish(null, String((e as Error)?.message ?? e))
    )
  } catch (e) {
    record.finish(null, String((e as Error)?.message ?? e))
  }
  view.dispatch({ effects: setRun.of({ pos: node.from, record }) })
  return true
}

function buildRunDeco(state: EditorState, runs: RunEntry[]): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const r of runs) {
    const node = fencedCodeAt(state, r.pos)
    if (!node || node.from !== r.pos) continue
    out.push(Decoration.widget({ widget: new RunOutputWidget(r.record), block: true, side: 1 }).range(node.to))
  }
  return Decoration.set(out, true)
}

export const codeRunField = StateField.define<{ runs: RunEntry[]; deco: DecorationSet }>({
  create: () => ({ runs: [], deco: Decoration.none }),
  update(value, tr) {
    let runs = value.runs
    let changed = false
    if (tr.docChanged && runs.length) {
      runs = runs.flatMap((r) => {
        // TrackAfter: deleting a block from its first character (e.g. selecting whole lines) must drop its run too
        const pos = tr.changes.mapPos(r.pos, 1, MapMode.TrackAfter)
        if (pos === null) {
          r.record.kill()
          return []
        }
        return [{ pos, record: r.record }]
      })
      changed = true
    }
    for (const e of tr.effects) {
      if (e.is(setRun)) {
        runs = runs.filter((r) => {
          if (r.pos !== e.value.pos) return true
          r.record.kill()
          return false
        })
        runs = [...runs, e.value]
        changed = true
      } else if (e.is(clearRun)) {
        e.value.kill()
        runs = runs.filter((r) => r.record !== e.value)
        changed = true
      }
    }
    if (changed || (runs.length && syntaxTree(tr.state) !== syntaxTree(tr.startState))) return { runs, deco: buildRunDeco(tr.state, runs) }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
})

/** Kill every process started from this editor (on unmount). */
export function killAllRuns(state: EditorState): void {
  state.field(codeRunField, false)?.runs.forEach((r) => r.record.kill())
}

function formatStatus(rec: RunRecord): { text: string; error: boolean } {
  if (rec.status === 'running') return { text: 'Running…', error: false }
  if (rec.failure) return { text: `Error: ${rec.failure}`, error: true }
  const r = rec.result!
  if (r.error) return { text: `Error: ${r.error}`, error: true }
  const killed = r.code === null || rec.stopped
  return { text: `${killed ? 'Stopped' : `Exited with code ${r.code}`} · ${r.durationMs} ms`, error: killed ? false : r.code !== 0 }
}

class RunOutputWidget extends WidgetType {
  private cleanup = new WeakMap<HTMLElement, () => void>()

  constructor(readonly record: RunRecord) {
    super()
  }
  eq(o: RunOutputWidget): boolean {
    return o.record === this.record
  }
  get estimatedHeight(): number {
    return 64
  }
  toDOM(view: EditorView): HTMLElement {
    const rec = this.record
    const el = document.createElement('div')
    el.className = 'cm-code-output'
    const head = document.createElement('div')
    head.className = 'cm-code-output-header'
    const status = document.createElement('span')
    status.className = 'cm-code-output-status'
    const spacer = document.createElement('span')
    spacer.style.flex = '1'
    const stop = document.createElement('button')
    stop.className = 'cm-code-output-btn is-stop'
    stop.textContent = '■ Stop'
    stop.title = 'Stop'
    stop.onclick = () => rec.kill()
    const copy = document.createElement('button')
    copy.className = 'cm-code-output-btn'
    copy.textContent = 'Copy'
    copy.title = 'Copy output'
    copy.onclick = () => {
      void navigator.clipboard.writeText(rec.chunks.map((c) => c.text).join(''))
      copy.textContent = 'Copied!'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    }
    const clear = document.createElement('button')
    clear.className = 'cm-code-output-btn'
    clear.textContent = '✕'
    clear.title = 'Clear output'
    clear.onclick = () => view.dispatch({ effects: clearRun.of(rec) })
    head.append(status, spacer, stop, copy, clear)
    const pre = document.createElement('pre')
    pre.className = 'code-output-text cm-code-output-text'
    el.append(head, pre)

    const append = (stream: 'stdout' | 'stderr', text: string): void => {
      const span = document.createElement('span')
      if (stream === 'stderr') span.className = 'stderr'
      span.textContent = text
      pre.appendChild(span)
    }
    let measureQueued = false
    const measure = (): void => {
      if (measureQueued) return
      measureQueued = true
      requestAnimationFrame(() => {
        measureQueued = false
        view.requestMeasure()
      })
    }
    const render = (): void => {
      const s = formatStatus(rec)
      status.textContent = s.text
      status.classList.toggle('is-error', s.error)
      status.classList.toggle('is-running', rec.status === 'running')
      stop.hidden = rec.status !== 'running'
      // nothing streamed (e.g. the runner only returned buffered output)
      if (rec.status === 'done' && !pre.childNodes.length && rec.result) {
        if (rec.result.stdout) append('stdout', rec.result.stdout)
        if (rec.result.stderr) append('stderr', rec.result.stderr)
      }
      pre.hidden = !pre.childNodes.length
    }
    rec.chunks.forEach((c) => append(c.stream, c.text))
    render()
    const unsub = rec.subscribe((ev, stream, text) => {
      if (ev === 'chunk') {
        append(stream!, text!)
        pre.hidden = false
        pre.scrollTop = pre.scrollHeight
      } else render()
      measure()
    })
    this.cleanup.set(el, unsub)
    return el
  }
  destroy(dom: HTMLElement): void {
    this.cleanup.get(dom)?.()
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Language label + ▶ Run + copy controls shown on the opening fence line. */
export class CodeHeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly runnable: boolean,
    readonly showLang: boolean
  ) {
    super()
  }
  eq(o: CodeHeaderWidget): boolean {
    return o.lang === this.lang && o.runnable === this.runnable && o.showLang === this.showLang
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-code-header'
    if (this.showLang && this.lang) {
      const l = document.createElement('span')
      l.className = 'cm-code-lang'
      l.textContent = this.lang
      el.appendChild(l)
    }
    const copy = document.createElement('button')
    copy.className = 'cm-code-btn'
    copy.textContent = 'Copy'
    copy.title = 'Copy code'
    copy.onmousedown = (e) => e.preventDefault()
    copy.onclick = () => {
      const node = fencedCodeAt(view.state, view.posAtDOM(el))
      if (!node) return
      void navigator.clipboard.writeText(codeBlockInfo(view.state, node).code)
      copy.textContent = 'Copied!'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    }
    el.appendChild(copy)
    if (this.runnable) {
      const run = document.createElement('button')
      run.className = 'cm-code-btn cm-code-run'
      run.textContent = '▶ Run'
      run.title = `Run code block (${formatHotkey('Mod+Shift+Enter')})`
      run.onmousedown = (e) => e.preventDefault()
      run.onclick = () => runCodeBlockAt(view, view.posAtDOM(el))
      el.appendChild(run)
    }
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}
