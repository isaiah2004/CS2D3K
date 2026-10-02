import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { loadTestVault } from '../../../../helpers/vault'
import { linkCompletion, tagCompletion } from '@/views/markdown/editor/completion'
import { notePath } from '@/views/markdown/editor/state'
import { destroyViews, makeState, makeView, markdownLang, show } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const SOURCE = 'Home.md'

function complete(source: (c: CompletionContext) => CompletionResult | null, marked: string, path = SOURCE): CompletionResult | null {
  const state = makeState(marked, [markdownLang(), notePath.of(path)])
  return source(new CompletionContext(state, state.selection.main.head, false))
}
const labels = (r: CompletionResult | null): string[] => (r ? r.options.map((o) => o.label) : [])

function applyOption(marked: string, pick: (r: CompletionResult) => Completion): string {
  const view: EditorView = makeView(marked, [markdownLang(), notePath.of(SOURCE)])
  const r = linkCompletion(new CompletionContext(view.state, view.state.selection.main.head, false))!
  const opt = pick(r)
  ;(opt.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(view, opt, r.from, r.to ?? view.state.selection.main.head)
  return show(view.state)
}

beforeEach(async () => {
  await loadTestVault({
    'Home.md': '# Intro\n## Details\n#alpha #beta',
    'notes/Topic.md': '# Topic Head\n#alpha',
    'notes/Other.md': '#alpha/child #Alpha',
    'sub/Topic.md': '',
    'img.png': ''
  })
})

afterEach(destroyViews)

describe('views/markdown/editor/completion linkCompletion', () => {
  it('only triggers after an unclosed [[ on the same line', () => {
    expect(complete(linkCompletion, 'plain text‸')).toBeNull()
    expect(complete(linkCompletion, '[[done]] ‸')).toBeNull()
    expect(complete(linkCompletion, '[[a\nb‸')).toBeNull()
  })

  it('does not trigger once an alias is being typed', () => {
    expect(complete(linkCompletion, '[[Note|al‸')).toBeNull()
  })

  it('does not trigger inside code', () => {
    expect(complete(linkCompletion, 'x `[[No‸`')).toBeNull()
    expect(complete(linkCompletion, '```\n[[No‸\n```')).toBeNull()
  })

  it('lists every other file, notes before attachments, replacing the text after [[', () => {
    const r = complete(linkCompletion, 'see [[‸')!
    expect(r.from).toBe(6)
    expect(r.to).toBe(6)
    expect(r.filter).toBe(false)
    expect(labels(r)).not.toContain('Home')
    expect(labels(r).sort()).toEqual(['Other', 'Topic', 'img.png', 'notes/Topic'])
    expect(labels(r).at(-1)).toBe('img.png')
    const img = r.options.find((o) => o.label === 'img.png')!
    expect(img.type).toBe('file')
    const other = r.options.find((o) => o.label === 'Other')!
    expect(other).toMatchObject({ type: 'note', detail: 'notes' })
  })

  it('uses the shortest unambiguous link text for files sharing a name', () => {
    const r = complete(linkCompletion, '[[Top‸')!
    // "Topic" resolves to the shallowest/shortest path (sub/Topic.md), the other one needs its folder
    expect(r.options.map((o) => [o.label, o.detail]).sort()).toEqual([
      ['Topic', 'sub'],
      ['notes/Topic', 'notes']
    ])
  })

  it('fuzzy-ranks by link text', () => {
    expect(labels(complete(linkCompletion, '[[oth‸'))[0]).toBe('Other')
    expect(labels(complete(linkCompletion, '[[zzz‸'))).toEqual([])
  })

  it('matches against the full path once the query contains a slash', () => {
    expect(labels(complete(linkCompletion, '[[notes/O‸'))[0]).toBe('Other')
    expect(labels(complete(linkCompletion, '[[sub/‸'))).toEqual(['Topic'])
  })

  it('suggests headings of the linked note after #', () => {
    const r = complete(linkCompletion, '[[notes/Topic#‸', 'notes/Other.md')!
    expect(r.options).toEqual([expect.objectContaining({ label: 'Topic Head', detail: 'H1', type: 'heading' })])
  })

  it('suggests headings of the current note for [[#', () => {
    expect(labels(complete(linkCompletion, '[[#‸'))).toEqual(['Intro', 'Details'])
    expect(labels(complete(linkCompletion, '[[#det‸'))).toEqual(['Details'])
  })

  it('offers no headings for an unresolved note', () => {
    expect(labels(complete(linkCompletion, '[[Missing#‸'))).toEqual([])
  })

  it('applies a file completion and closes the link', () => {
    expect(applyOption('see [[oth‸', (r) => r.options[0])).toBe('see [[Other]]‸')
  })

  it('does not add a second ]] when the link is already closed', () => {
    expect(applyOption('see [[oth‸]] after', (r) => r.options[0])).toBe('see [[Other]]‸ after')
  })

  it('applies a heading completion keeping the note part', () => {
    expect(applyOption('[[#Det‸', (r) => r.options[0])).toBe('[[#Details]]‸')
  })
})

describe('views/markdown/editor/completion tagCompletion', () => {
  it('suggests vault tags after #, replacing from the hash', () => {
    const r = complete(tagCompletion, 'x #al‸')!
    expect(r.from).toBe(2)
    expect(labels(r)).toEqual(expect.arrayContaining(['#alpha', '#alpha/child']))
    const alpha = r.options.find((o) => o.label === '#alpha')!
    // #alpha appears in three notes (case-insensitively merged)
    expect(alpha).toMatchObject({ detail: '3', type: 'tag', apply: '#alpha ' })
  })

  it('omits the tag that has been typed exactly', () => {
    expect(labels(complete(tagCompletion, '#alpha‸'))).toEqual(['#alpha/child'])
  })

  it('needs a character after # and a boundary before it', () => {
    expect(complete(tagCompletion, '#‸')).toBeNull()
    expect(complete(tagCompletion, 'a#al‸')).toBeNull()
    expect(complete(tagCompletion, '(#al‸')).not.toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(complete(tagCompletion, '#zzz‸')).toBeNull()
  })

  it('does not trigger inside code', () => {
    expect(complete(tagCompletion, '`#al‸`')).toBeNull()
  })
})
