import { describe, expect, it } from 'vitest'
import { definitionMarkdown } from '@/views/formmap/lenses/definitionDoc'
import { features } from '@/views/formmap/analysis'
import { forms, type FormMapData } from '@/views/formmap/schema'
import { card, doc, edge, loadSample, zone } from '../fixtures'

const SECTIONS = ['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Decisions', 'Idea inbox']

const h2 = (md: string): string[] => md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3))
/** lines of one `## name` section (without the heading) */
function section(md: string, name: string): string[] {
  const lines = md.split('\n')
  const start = lines.indexOf(`## ${name}`)
  if (start < 0) throw new Error(`no section ${name}`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

function crafted(meta: FormMapData['formmap'] = { version: 1, title: 'My Product' }): FormMapData {
  const d = doc(
    [
      zone('core', { x: 0, y: 0, width: 1000, height: 300 }, { label: 'Core idea' }),
      card('core1', 'note', { title: 'CS2D3K', text: 'An editor for code.', x: 10, y: 10 }),
      card('p2', 'principle', { title: '2. Second', text: 'Because', fields: { why: 'Because' }, y: 400 }),
      card('p1', 'principle', { title: '1. First', text: 'Body one', y: 500 }),
      card('a2', 'approach', { title: 'Pick DB', y: 400 }),
      card('a1', 'approach', { title: 'Use Electron', text: 'We use electron', fields: { status: 'accepted', rationale: 'R', alternatives: 'Tauri' }, y: 500 }),
      card('g1', 'goal', { title: 'Ship beta', fields: { horizon: 'milestone' } }),
      card('g2', 'goal', { title: 'Delight devs', fields: { horizon: 'final', metric: 'NPS 50' } }),
      card('f1', 'feature', { title: 'Search | find', fields: { phase: 'mvp', priority: 'should', effort: 's', status: 'done', fun: 3, acceptance: [{ text: 'fast', done: true }] } }),
      card('f2', 'feature', { title: 'Index', fields: { phase: 'mvp', priority: 'must', effort: 'm' } }),
      card('l1', 'feature', { title: 'Plugins', text: 'Extend\nit', votes: 2, fields: { phase: 'later', priority: 'could' } }),
      card('s1', 'feature', { title: 'VR', fields: { phase: 'someday' } }),
      card('u1', 'feature', { title: 'Mystery' }),
      card('q1', 'question', { title: 'Which DB?', fields: { status: 'open', options: 'pg\nsqlite' } }),
      card('q2', 'question', { title: 'Mobile?', fields: { status: 'parked' } }),
      card('q3', 'question', { title: 'License?', fields: { status: 'decided', decision: 'MIT' } }),
      card('i1', 'idea', { title: 'Dark mode', votes: 1 }),
      card('i2', 'idea', { title: 'Themes', fields: { status: 'refined' } }),
      card('i3', 'idea', { title: 'Nope', fields: { status: 'dropped' } })
    ],
    [edge('a1', 'p1', 'because'), edge('f1', 'g2', 'serves'), edge('f1', 'f2', 'depends'), edge('s1', 'g1', 'serves')],
    meta
  )
  // everything except the core idea card sits below the Core idea zone
  for (const n of d.nodes) if (n.type === 'form' && n.id !== 'core1' && n.y < 400) n.y += 400
  return d
}

describe('formmap/lenses/definitionDoc', () => {
  const md = definitionMarkdown(crafted(), 'Fallback')

  it('titles the note with the map title, else the fallback', () => {
    expect(md.split('\n')[0]).toBe('# My Product')
    expect(definitionMarkdown(crafted({ version: 1 }), 'Fallback').split('\n')[0]).toBe('# Fallback')
    expect(definitionMarkdown(crafted({ version: 1, title: '   ' }), 'Fallback').split('\n')[0]).toBe('# Fallback')
  })

  it('writes the sections in definition order and ends with a footer', () => {
    expect(h2(md)).toEqual(SECTIONS)
    expect(md.trimEnd().endsWith('_Generated from a CS2D3K form-map._')).toBe(true)
  })

  it('fills the core idea from the cards inside the "Core idea" zone', () => {
    expect(section(md, 'Core idea')).toEqual(['', '**CS2D3K**', '', 'An editor for code.', ''])
  })

  it('numbers principles by their leading number, without repeating a body that equals "why"', () => {
    const s = section(md, 'Philosophy')
    expect(s.filter((l) => l.startsWith('### '))).toEqual(['### 1. First', '### 2. Second'])
    expect(s).toContain('Body one')
    expect(s).toContain('_Drives:_ Use Electron')
    expect(s).toContain('**Why:** Because')
    expect(s.filter((l) => l === 'Because')).toEqual([])
  })

  it('writes approaches as ADRs, accepted first, with status, motivating principles, decision and rationale', () => {
    const s = section(md, 'Engineering approach')
    expect(s.filter((l) => l.startsWith('### '))).toEqual(['### ADR-01: Use Electron', '### ADR-02: Pick DB'])
    expect(s).toContain('**Status:** Accepted · **Because:** First')
    expect(s).toContain('**Decision:** We use electron')
    expect(s).toContain('**Rationale:** R')
    expect(s).toContain('**Alternatives considered:** Tauri')
    expect(s).toContain('**Status:** Proposed')
  })

  it('lists final goals before milestones, with metric and the features serving them', () => {
    const s = section(md, 'Final goal')
    expect(s.filter((l) => l.startsWith('### '))).toEqual(['### 🎯 Delight devs', '### 🎯 Ship beta _(milestone)_'])
    expect(s).toContain('- **Success metric:** NPS 50')
    expect(s).toContain('- **Served by:** Search | find')
  })

  it('summarises the MVP and tables its features by priority, escaping pipes', () => {
    const s = section(md, 'Initial features (MVP)')
    expect(s).toContain('2 features · 1 done · 5 effort points.')
    const rows = s.filter((l) => l.startsWith('| ') && !l.startsWith('| Feature') && !l.startsWith('| ---'))
    expect(rows).toEqual(['| Index | Must | M | — | — | — |', '| Search \\| find | Should | S | Done | ★★★ | Delight devs |'])
  })

  it('details each MVP feature with dependencies and acceptance criteria (or a placeholder)', () => {
    const s = section(md, 'Initial features (MVP)')
    expect(s.filter((l) => l.startsWith('### '))).toEqual(['### Index', '### Search | find'])
    expect(s).toContain('_Depends on:_ Index')
    expect(s).toContain('- [x] fast')
    expect(s).toContain('- [ ] _To be defined_')
  })

  it('mentions the MVP budget when one is set', () => {
    const withBudget = definitionMarkdown(crafted({ version: 1, mvpBudget: 10 }), 'X')
    expect(section(withBudget, 'Initial features (MVP)')).toContain('2 features · 1 done · 5 effort points of a 10-point budget.')
  })

  it('groups later features by phase (Next, Later, Someday, then Unscheduled), skipping empty groups', () => {
    const s = section(md, 'Later features')
    expect(s.filter((l) => l.startsWith('### '))).toEqual(['### Later', '### Someday', '### Unscheduled'])
    expect(s).toContain('- **Plugins** (Could) — Extend it')
    expect(s).toContain('- **VR** _Serves: Ship beta_')
    expect(s).toContain('- **Mystery**')
  })

  it('lists open and parked questions as tasks and decided ones as decisions', () => {
    const open = section(md, 'Open questions')
    expect(open).toContain('- [ ] **Which DB?**')
    expect(open).toContain('  _Options:_ pg sqlite')
    expect(open).toContain('- [ ] **Mobile?** _(parked)_')
    expect(open.join('\n')).not.toContain('License?')
    const dec = section(md, 'Decisions')
    expect(dec).toContain('### ✅ License?')
    expect(dec).toContain('> MIT')
  })

  it('lists untriaged ideas with status and votes, hiding dropped and merged ones', () => {
    const s = section(md, 'Idea inbox')
    expect(s).toContain('- 💡 **Dark mode** · 1 vote')
    expect(s).toContain('- 💡 **Themes** (Refined)')
    expect(s.join('\n')).not.toContain('Nope')
  })

  it('writes a placeholder for every empty section', () => {
    const empty = definitionMarkdown(doc([]), 'Empty')
    expect(h2(empty)).toEqual(SECTIONS)
    for (const p of ['_Not defined yet._', '_No principles yet._', '_No engineering decisions yet._', '_No goals yet._', '_No MVP features yet._', '_Nothing parked for later._', '_None — every question is decided._', '_No decisions recorded yet._', '_Empty — every idea has been triaged._'])
      expect(empty).toContain(p)
  })

  // regression: "1 features"
  it('uses the singular for a single MVP feature', () => {
    const one = definitionMarkdown(doc([card('f', 'feature', { fields: { phase: 'mvp' } })]), 'X')
    expect(one).toContain('1 feature · 0 done · 0 effort points.')
  })

  // regression: '★'.repeat(-1) threw a RangeError and broke the whole export for a hand-edited file
  it('clamps out-of-range fun ratings instead of throwing', () => {
    const fun = (v: unknown): string => {
      const out = definitionMarkdown(doc([card('f', 'feature', { title: 'F', fields: { phase: 'mvp', fun: v } })]), 'X')
      return out.split('\n').find((l) => l.startsWith('| F |'))!.split(' | ')[4]
    }
    expect(fun(-1)).toBe('—')
    expect(fun(99)).toBe('★★★★★')
    expect(fun('Infinity')).toBe('★★★★★')
    expect(fun('abc')).toBe('—')
    expect(fun(2.6)).toBe('★★★')
  })
})

describe('formmap/lenses/definitionDoc on the sample definition', () => {
  const d = loadSample()
  const md = definitionMarkdown(d, 'Fallback')
  const count = (kind: string): number => forms(d).filter((f) => f.kind === kind).length

  it('has every section, in order, titled from the map', () => {
    expect(md.split('\n')[0]).toBe(`# ${d.formmap!.title}`)
    expect(h2(md)).toEqual(SECTIONS)
  })

  it('numbers all principles 1..n', () => {
    const heads = section(md, 'Philosophy').filter((l) => l.startsWith('### '))
    expect(heads).toHaveLength(count('principle'))
    heads.forEach((h, i) => expect(h.startsWith(`### ${i + 1}. `)).toBe(true))
  })

  it('writes one ADR per approach and one heading per goal', () => {
    expect(section(md, 'Engineering approach').filter((l) => /^### ADR-\d\d: /.test(l))).toHaveLength(count('approach'))
    expect(section(md, 'Final goal').filter((l) => l.startsWith('### 🎯 '))).toHaveLength(count('goal'))
  })

  it('writes one table row and one detail heading per MVP feature', () => {
    const s = section(md, 'Initial features (MVP)')
    const n = features(d, 'mvp').length
    expect(s.filter((l) => l.startsWith('### '))).toHaveLength(n)
    expect(s.filter((l) => l.startsWith('| ') && !l.startsWith('| Feature') && !l.startsWith('| ---'))).toHaveLength(n)
  })
})
