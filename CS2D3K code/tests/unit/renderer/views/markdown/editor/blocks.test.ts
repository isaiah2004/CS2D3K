import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Compartment, EditorState } from '@codemirror/state'
import { blockWidgets, isBlockEmbed } from '@/views/markdown/editor/blocks'
import { livePreview, notePath } from '@/views/markdown/editor/state'
import { useSettings } from '@/store/settings'
import { loadTestVault } from '../../../../helpers/vault'
import { destroyViews, makeState, makeView, markdownLang, parsed } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

interface Item {
  kind: string
  from: number
  to: number
  raw?: string
  mdImage?: boolean
}

const live = (doc: string, on = true): EditorState => makeState(doc, [markdownLang(), notePath.of('n.md'), livePreview.of(on), blockWidgets])
const items = (state: EditorState): Item[] => state.field(blockWidgets).items as Item[]
const kinds = (doc: string): string[] => items(live(doc)).map((i) => i.kind)

beforeAll(() => {
  // jsdom has no ResizeObserver; rendered block widgets observe their size
  if (!globalThis.ResizeObserver)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await loadTestVault({})
})

afterEach(destroyViews)

describe('views/markdown/editor/blocks isBlockEmbed', () => {
  it('is true only when the embed is the whole (trimmed) line', () => {
    const s = EditorState.create({ doc: '  ![[a]]  \ntext ![[b]]' })
    expect(isBlockEmbed(s, 2, 8)).toBe(true)
    expect(isBlockEmbed(s, 16, 22)).toBe(false)
  })

  it('is false for a range spanning past the line end', () => {
    const s = EditorState.create({ doc: '![[a]]\nx' })
    expect(isBlockEmbed(s, 0, 8)).toBe(false)
  })
})

describe('views/markdown/editor/blocks scan', () => {
  it('finds nothing when live preview is off', () => {
    expect(items(live('---\na: 1\n---\n![[x]]', false))).toEqual([])
  })

  it('finds closed frontmatter, also at the very end of the note', () => {
    expect(items(live('---\na: 1\n---'))).toEqual([{ kind: 'frontmatter', from: 0, to: 12 }])
    expect(items(live('---\na: 1\n---\ntext'))).toEqual([{ kind: 'frontmatter', from: 0, to: 12 }])
  })

  it('does not treat an unclosed --- at the top as frontmatter', () => {
    expect(kinds('---\nThis note starts with a rule\n\nand has no closing fence')).not.toContain('frontmatter')
  })

  it('finds GFM tables spanning whole lines', () => {
    const doc = 'intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter'
    expect(items(live(doc))).toEqual([{ kind: 'table', from: 7, to: 36 }])
  })

  it('finds wiki embeds alone on their line, keeping the alias', () => {
    expect(items(live('![[pic.png|300]]'))).toEqual([{ kind: 'embed', from: 0, to: 16, raw: 'pic.png|300' }])
    expect(items(live('  ![[Note#Head]]  '))[0]).toMatchObject({ kind: 'embed', raw: 'Note#Head' })
  })

  it('finds markdown images alone on their line', () => {
    expect(items(live('![alt](img/a.png)'))).toEqual([{ kind: 'embed', from: 0, to: 17, raw: 'img/a.png', mdImage: true }])
  })

  it('ignores inline embeds and links', () => {
    expect(kinds('text ![[x]]\n\n[[link]]\n\n![](a.png) more')).toEqual([])
  })

  it('finds every embed of a multi-line paragraph', () => {
    expect(kinds('![[a]]\n![[b]]')).toEqual(['embed', 'embed'])
  })

  it('does not look inside code blocks or quotes', () => {
    expect(kinds('```\n![[a]]\n```\n\n> ![[b]]')).toEqual([])
  })
})

describe('views/markdown/editor/blocks decorations', () => {
  it('replaces frontmatter and tables with widgets while the editor is unfocused', () => {
    const s = live('---\na: 1\n---\n\n| a |\n| - |\n| 1 |')
    const ranges: [number, number][] = []
    s.field(blockWidgets).deco.between(0, s.doc.length, (from, to) => {
      ranges.push([from, to])
    })
    expect(ranges).toEqual([
      [0, 12],
      [14, 31]
    ])
  })

  it('hides frontmatter entirely when "show properties" is off', () => {
    useSettings.setState((st) => ({ settings: { ...st.settings, showFrontmatter: false } }))
    const s = live('---\na: 1\n---\ntext')
    let widget: unknown = 'none'
    s.field(blockWidgets).deco.between(0, 12, (_f, _t, d) => {
      widget = d.spec.widget
    })
    expect(widget).toBeUndefined()
  })

  it('recomputes items when live preview is toggled', () => {
    const mode = new Compartment()
    const view = makeView('![[x]]', [markdownLang(), mode.of(livePreview.of(false)), blockWidgets])
    expect(items(view.state)).toEqual([])
    view.dispatch({ effects: mode.reconfigure(livePreview.of(true)) })
    expect(items(view.state).map((i) => i.kind)).toEqual(['embed'])
  })

  it('updates items when the document changes', () => {
    const view = makeView('text‸', [markdownLang(), livePreview.of(true), blockWidgets])
    view.dispatch({ changes: { from: 0, to: 4, insert: '![[x]]' } })
    parsed(view)
    expect(items(view.state).map((i) => i.kind)).toEqual(['embed'])
  })
})
