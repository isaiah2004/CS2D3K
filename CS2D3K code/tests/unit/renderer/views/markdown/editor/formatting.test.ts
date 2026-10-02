import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { autocompletion, completionStatus } from '@codemirror/autocomplete'
import { insertWikiLink, isListLine, toggleChecklist, toggleComment, toggleWrap } from '@/views/markdown/editor/formatting'
import { destroyViews, makeView, show } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

afterEach(destroyViews)

const run = (marked: string, cmd: (v: EditorView) => boolean): string => {
  const view = makeView(marked)
  expect(cmd(view)).toBe(true)
  return show(view.state)
}
const bold = (v: EditorView): boolean => toggleWrap(v, '**')
const italic = (v: EditorView): boolean => toggleWrap(v, '*')
const code = (v: EditorView): boolean => toggleWrap(v, '`')

describe('views/markdown/editor/formatting toggleWrap', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(run('hello «world»', bold)).toBe('hello **«world»**')
  })

  it('wraps the word under the cursor, keeping the cursor inside the word', () => {
    expect(run('hel‸lo there', bold)).toBe('**hel‸lo** there')
  })

  it('inserts an empty pair with the cursor between when not on a word', () => {
    expect(run('a ‸ b', bold)).toBe('a **‸** b')
    expect(run('‸', code)).toBe('`‸`')
  })

  it('unwraps a selection whose surrounding text is the markup', () => {
    expect(run('hello **«world»**', bold)).toBe('hello «world»')
  })

  it('unwraps a selection that includes the markup', () => {
    expect(run('«**world**»', bold)).toBe('«world»')
  })

  it('unwraps the word under the cursor, keeping the cursor in place', () => {
    expect(run('**hel‸lo**', bold)).toBe('hel‸lo')
  })

  it('toggling twice with a cursor restores the original text and cursor', () => {
    const view = makeView('say hel‸lo')
    bold(view)
    bold(view)
    expect(show(view.state)).toBe('say hel‸lo')
  })

  it('adds italic around bold text instead of eating half of the bold markers', () => {
    expect(run('**«bold»**', italic)).toBe('***«bold»***')
  })

  it('removes italic from bold-italic text', () => {
    expect(run('***«x»***', italic)).toBe('**«x»**')
  })

  it('removes plain italic', () => {
    expect(run('*«x»*', italic)).toBe('«x»')
  })

  it('handles every selection range', () => {
    expect(run('«a» and «b»', code)).toBe('`«a»` and `«b»`')
  })

  it('supports asymmetric open/close markup', () => {
    const view = makeView('«x»')
    toggleWrap(view, '<u>', '</u>')
    expect(show(view.state)).toBe('<u>«x»</u>')
    toggleWrap(view, '<u>', '</u>')
    expect(show(view.state)).toBe('«x»')
  })
})

describe('views/markdown/editor/formatting insertWikiLink', () => {
  it('wraps the selection in [[ ]] and puts the cursor after it', () => {
    expect(run('see «Note»', insertWikiLink)).toBe('see [[Note]]‸')
  })

  it('inserts an empty link with the cursor inside', () => {
    expect(run('see ‸', insertWikiLink)).toBe('see [[‸]]')
  })

  it('opens link suggestions for an empty link', () => {
    const view = makeView('‸', autocompletion({ override: [() => ({ from: 0, options: [{ label: 'x' }] })] }))
    insertWikiLink(view)
    expect(completionStatus(view.state)).not.toBeNull()
  })
})

describe('views/markdown/editor/formatting toggleChecklist', () => {
  it('turns plain text into a task', () => {
    expect(run('te‸xt', toggleChecklist)).toBe('- [ ] te‸xt')
  })

  it('turns a bullet into a task', () => {
    expect(run('- it‸em', toggleChecklist)).toBe('- [ ] it‸em')
    expect(run('  * it‸em', toggleChecklist)).toBe('  * [ ] it‸em')
  })

  it('checks and unchecks tasks', () => {
    expect(run('- [ ] it‸em', toggleChecklist)).toBe('- [x] it‸em')
    expect(run('- [x] it‸em', toggleChecklist)).toBe('- [ ] it‸em')
    expect(run('- [X] it‸em', toggleChecklist)).toBe('- [ ] it‸em')
  })

  it('handles ordered lists', () => {
    expect(run('1. it‸em', toggleChecklist)).toBe('1. [ ] it‸em')
    expect(run('2) [ ] it‸em', toggleChecklist)).toBe('2) [x] it‸em')
  })

  it('keeps blockquote prefixes', () => {
    expect(run('> quo‸te', toggleChecklist)).toBe('> - [ ] quo‸te')
  })

  it('toggles each selected line exactly once', () => {
    expect(run('«a\n- b\n- [ ] c»', toggleChecklist)).toBe('- [ ] «a\n- [ ] b\n- [x] c»')
    expect(run('x‸a ‸b', toggleChecklist)).toBe('- [ ] x‸a ‸b')
  })

  it('leaves the cursor after the new checkbox on an empty line', () => {
    expect(run('‸', toggleChecklist)).toBe('- [ ] ‸')
    expect(run('a\n‸\nb', toggleChecklist)).toBe('a\n- [ ] ‸\nb')
  })

  it('leaves a cursor at the start of the line after the new checkbox', () => {
    expect(run('‸text', toggleChecklist)).toBe('- [ ] ‸text')
    expect(run('- ‸item', toggleChecklist)).toBe('- [ ] ‸item')
  })

  it('toggles an empty task without a trailing space instead of nesting a second box', () => {
    expect(run('- [ ]‸', toggleChecklist)).toBe('- [x]‸')
    expect(run('1. [x]‸', toggleChecklist)).toBe('1. [ ]‸')
  })
})

describe('views/markdown/editor/formatting toggleComment', () => {
  it('comments out the current line', () => {
    expect(run('hel‸lo', toggleComment)).toBe('%% hel‸lo %%')
  })

  it('keeps indentation outside the comment', () => {
    expect(run('  co‸de', toggleComment)).toBe('  %% co‸de %%')
  })

  it('uncomments a commented line', () => {
    expect(run('%% hel‸lo %%', toggleComment)).toBe('hel‸lo')
  })

  it('round-trips comment on/off for a line', () => {
    const view = makeView('some te‸xt')
    toggleComment(view)
    toggleComment(view)
    expect(show(view.state)).toBe('some te‸xt')
  })

  it('inserts an empty comment on a blank line', () => {
    expect(run('‸', toggleComment)).toBe('%% ‸ %%')
  })

  it('wraps and unwraps a selection inline', () => {
    expect(run('a «b» c', toggleComment)).toBe('a «%%b%%» c')
    expect(run('a «%%b%%» c', toggleComment)).toBe('a «b» c')
    expect(run('«%% b %%»', toggleComment)).toBe('«b»')
  })
})

describe('views/markdown/editor/formatting isListLine', () => {
  it('detects bullet and ordered list lines at the cursor', () => {
    for (const line of ['- a‸', '  * a‸', '+ a‸', '1. a‸', '10) a‸', '-‸']) expect(isListLine(makeView(line)), line).toBe(true)
    for (const line of ['a‸', '-a‸', '1.a‸', '# h‸', '> q‸']) expect(isListLine(makeView(line)), line).toBe(false)
  })
})
