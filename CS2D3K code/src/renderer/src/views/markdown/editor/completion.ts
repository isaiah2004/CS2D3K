// Autocomplete: [[links]] to vault files, [[note#headings]], and #tags.
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { allFiles } from '@/store/vault'
import { getAllTags, getMeta, linkTextFor, resolveLink } from '@/store/metadata'
import { fuzzyMatch } from '@/lib/util'
import { dirname } from '@/lib/path'
import { notePath } from './state'

const MAX_OPTIONS = 60

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'Frontmatter'])

function inCode(ctx: CompletionContext): boolean {
  for (let node: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
  }
  return false
}

/** Applies a link completion: replaces the typed query and closes the link with ]] if needed. */
function applyLink(text: string) {
  return (view: EditorView, _c: Completion, from: number, to: number): void => {
    const closed = view.state.sliceDoc(to, to + 2) === ']]'
    const insert = closed ? text : `${text}]]`
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + text.length + 2 },
      userEvent: 'input.complete'
    })
  }
}

function rank<T>(items: T[], query: string, key: (t: T) => string): T[] {
  if (!query) return items.slice(0, MAX_OPTIONS)
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const m = fuzzyMatch(query, key(item))
    if (m) scored.push({ item, score: m.score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_OPTIONS).map((s) => s.item)
}

export function linkCompletion(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/\[\[[^[\]\n]*$/)
  if (!before || inCode(ctx)) return null
  const from = before.from + 2
  const query = before.text.slice(2)
  if (query.includes('|')) return null
  const source = ctx.state.facet(notePath)

  const hash = query.indexOf('#')
  if (hash >= 0) {
    const noteText = query.slice(0, hash)
    const target = noteText ? resolveLink(noteText, source) : source
    const headings = (target && getMeta(target)?.headings) || []
    const q = query.slice(hash + 1)
    const options = rank(headings, q, (h) => h.text).map(
      (h): Completion => ({
        label: h.text,
        detail: `H${h.level}`,
        type: 'heading',
        apply: applyLink(`${noteText}#${h.text}`)
      })
    )
    return { from, to: ctx.pos, options, filter: false }
  }

  const files = allFiles().filter((f) => !f.isDir && f.path !== source)
  const entries = files.map((f) => ({ path: f.path, text: linkTextFor(f.path), isMd: f.ext === 'md' }))
  const ranked = rank(entries, query, (e) => (query.includes('/') ? e.path : e.text))
  // markdown notes first when there is no query
  if (!query) ranked.sort((a, b) => Number(b.isMd) - Number(a.isMd))
  const options = ranked.map(
    (e): Completion => ({
      label: e.text,
      detail: dirname(e.path) || undefined,
      type: e.isMd ? 'note' : 'file',
      apply: applyLink(e.text)
    })
  )
  return { from, to: ctx.pos, options, filter: false }
}

export function tagCompletion(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|[\s(,;])#[\p{L}\p{N}_\-/]+$/u)
  if (!m || inCode(ctx)) return null
  const hashAt = m.from + m.text.indexOf('#')
  const query = ctx.state.sliceDoc(hashAt + 1, ctx.pos)
  const tags = getAllTags().sort((a, b) => b.count - a.count)
  const options = rank(tags, query, (t) => t.tag)
    .filter((t) => t.tag !== query)
    .map((t): Completion => ({ label: `#${t.tag}`, detail: String(t.count), type: 'tag', apply: `#${t.tag} ` }))
  if (!options.length) return null
  return { from: hashAt, to: ctx.pos, options, filter: false }
}
