import { describe, expect, it } from 'vitest'
import { mapMarkdown } from '@/views/formmap/lenses/docMarkdown'
import { forms, groups } from '@/views/formmap/schema'
import { card, doc, edge, group, kanban, loadSample } from '../fixtures'

const headings = (md: string): string[] => md.split('\n').filter((l) => /^#{1,6} /.test(l))

describe('formmap/lenses/docMarkdown', () => {
  const d = doc(
    [
      group('later', { x: 0, y: 1000, width: 800, height: 600 }, { label: 'Later', emoji: '🔭', order: 2 }),
      group('core', { x: 0, y: 0, width: 800, height: 600 }, { label: 'Core', emoji: '🌱', order: 1, prompt: 'What is it?\nWhy?' }),
      group('nested', { x: 400, y: 100, width: 300, height: 400 }, { label: 'Details' }),
      group('empty', { x: 2000, y: 0, width: 300, height: 300 }, { label: 'Parking' }),
      card('b', { title: 'Second', x: 20, y: 300, tags: ['x', 'y'], text: 'Body **two**' }),
      card('a', { title: 'First', x: 20, y: 40, fields: { prio: 'high', done: true, notes: 'line one\nline two', list: [{ text: 'do', done: true }, { text: 'test', done: false }], free: 7 }, votes: 3 }),
      card('n', { title: 'Nested card', x: 420, y: 150 }),
      card('l', { title: '', text: 'Later idea\nwith details', x: 20, y: 1050 }),
      card('loose', { title: 'Loose', x: 5000, y: 0 }),
      kanban('k', [{ id: 'c1', title: 'To do', cards: [{ id: 'k1', title: 'Write docs', text: 'all of them', tags: ['docs'], fields: { prio: 'high' } }] }, { id: 'c2', title: 'Done', cards: [{ id: 'k2', title: 'Ship', done: true }] }, { id: 'c3', title: 'Empty', cards: [] }], { title: 'Tasks', x: 20, y: 1300, width: 300, height: 200 })
    ],
    [edge('a', 'b', 'serves'), edge('a', 'n', 'serves'), edge('b', 'a', 'blocks'), edge('a', 'gone', 'serves')],
    {
      title: 'My map',
      fields: {
        prio: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }] },
        done: { type: 'checkbox', label: 'Done' },
        notes: { type: 'longtext' },
        list: { type: 'checklist', label: 'Checklist' }
      }
    }
  )
  const md = mapMarkdown(d, 'Fallback')
  const lines = md.split('\n')

  it('titles the document with the map title, else the fallback', () => {
    expect(lines[0]).toBe('# My map')
    expect(mapMarkdown(doc([]), 'Fallback').split('\n')[0]).toBe('# Fallback')
  })

  it('writes groups in pitch order, nested groups inside their parent, cards in reading order, loose cards last', () => {
    expect(headings(md)).toEqual([
      '# My map',
      '## 🌱 Core',
      '### First',
      '### Second',
      '### Details',
      '#### Nested card',
      '## 🔭 Later',
      '### Later idea',
      '### 📋 Tasks',
      '## Parking',
      '## Other cards',
      '### Loose'
    ])
  })

  it('quotes group prompts and marks empty groups', () => {
    expect(lines).toContain('> What is it? Why?')
    const i = lines.indexOf('## Parking')
    expect(lines[i + 2]).toBe('_Nothing here yet._')
  })

  it('writes tags, body, every field by type, votes and outgoing relations of a card', () => {
    expect(lines).toContain('#x #y')
    expect(lines).toContain('Body **two**')
    expect(lines).toContain('- **Priority:** High')
    expect(lines).toContain('- **Done:** Yes')
    expect(lines).toContain('- **notes:** line one line two')
    expect(lines).toContain('- **Checklist:**')
    expect(lines).toContain('  - [x] do')
    expect(lines).toContain('  - [ ] test')
    expect(lines).toContain('- **free:** 7')
    expect(lines).toContain('- **Votes:** 3')
    expect(lines).toContain('_Serves:_ Second, Nested card')
    expect(lines).toContain('_Blocks:_ First')
  })

  it('uses the first text line as the title of an untitled card, without repeating it', () => {
    const i = lines.indexOf('### Later idea')
    expect(lines[i + 2]).toBe('with details')
  })

  it('writes kanban nodes as task lists per column', () => {
    expect(lines).toContain('**To do** (1)')
    expect(lines).toContain('- [ ] Write docs — all of them _(Priority: High)_ #docs')
    expect(lines).toContain('- [x] Ship')
    expect(lines).toContain('**Empty** (0)')
    expect(lines).toContain('- _Empty_')
  })

  it('ends with a footer, and handles an empty map', () => {
    expect(md.trimEnd().endsWith('_Generated from a CS2D3K form-map._')).toBe(true)
    expect(mapMarkdown(doc([]), 'X')).toContain('_This map is empty._')
  })

  it('writes every group and card of the sample definition', () => {
    const s = loadSample()
    const out = mapMarkdown(s, 'Fallback')
    for (const g of groups(s)) expect(out).toContain(`${g.emoji} ${g.label}`)
    for (const f of forms(s)) expect(out).toContain(`### ${f.title}`)
    expect(headings(out).filter((h) => h.startsWith('## ')).slice(0, 7)).toEqual(['## 🌱 Core idea', '## 🧭 Philosophy', '## 🛠️ Engineering approach', '## 🎯 Final goal', '## 🚀 Initial features (MVP)', '## 🔭 Later features', '## ❓ Open questions'])
  })
})
