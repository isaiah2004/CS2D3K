import { describe, expect, it } from 'vitest'
import {
  applyAssign,
  assignOf,
  cardAccent,
  cardState,
  cardTitle,
  cleanTag,
  defaultTagColor,
  fieldLabel,
  fieldText,
  FIELD_TYPES,
  fmColor,
  FM_COLORS,
  forms,
  fromPreset,
  groupAt,
  groupChain,
  groups,
  inferFieldType,
  inferRelation,
  isDoneField,
  isEmptyValue,
  isForm,
  isGroup,
  isKanban,
  kanbans,
  matchesFilter,
  newForm,
  optionsFor,
  presetOf,
  relationDef,
  RELATIONS,
  tagColor,
  valuePoints,
  type FieldDef,
  type FormMapMeta
} from '@/views/formmap/schema'
import { card, doc, group, kanban } from './fixtures'

describe('formmap/schema colors', () => {
  it('resolves named colors, canvas presets and hex; anything else is undefined', () => {
    expect(fmColor('green')).toBe('var(--color-green)')
    expect(fmColor('gray')).toBe('var(--text-faint)')
    expect(fmColor('4')).toBe('var(--color-green)')
    expect(fmColor('#aabbcc')).toBe('#aabbcc')
    expect(fmColor('nope')).toBeUndefined()
    expect(fmColor(undefined)).toBeUndefined()
    expect(new Set(FM_COLORS.map((c) => c.id)).size).toBe(FM_COLORS.length)
  })

  it('gives every tag a stable default color from the palette', () => {
    expect(defaultTagColor('feature')).toBe(defaultTagColor('feature'))
    expect(FM_COLORS.map((c) => c.id)).toContain(defaultTagColor('anything'))
    const meta: FormMapMeta = { version: 2, tags: { feature: { color: 'green' } } }
    expect(tagColor(meta, 'feature')).toBe('var(--color-green)')
    expect(tagColor(meta, 'other')).toBe(fmColor(defaultTagColor('other')))
  })

  it("accents a card with its node color, else its first tag's color, else nothing", () => {
    const meta: FormMapMeta = { version: 2, tags: { a: { color: 'red' }, b: { color: 'blue' } } }
    expect(cardAccent({ color: '6', tags: ['a'] }, meta)).toBe('var(--color-purple)')
    expect(cardAccent({ tags: ['b', 'a'] }, meta)).toBe('var(--color-blue)')
    expect(cardAccent({ tags: [] }, meta)).toBeUndefined()
  })
})

describe('formmap/schema fields', () => {
  const status: FieldDef = {
    type: 'select',
    options: [{ value: 'open', for: ['question'] }, { value: 'done', label: 'Done', color: 'green', for: ['feature'] }, { value: 'any' }]
  }

  it('lists every field type once', () => {
    expect(new Set(FIELD_TYPES.map((t) => t.type)).size).toBe(FIELD_TYPES.length)
    expect(FIELD_TYPES.map((t) => t.type)).toEqual(expect.arrayContaining(['text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'date', 'rating', 'checklist', 'link']))
  })

  it('labels a field by its label, else its name', () => {
    expect(fieldLabel('fun', { type: 'rating', label: 'Fun factor' })).toBe('Fun factor')
    expect(fieldLabel('Owner', { type: 'text' })).toBe('Owner')
    expect(fieldLabel('Owner')).toBe('Owner')
  })

  it("scopes options to the card's tags (options without tags always apply; nothing matching = all)", () => {
    expect(optionsFor(status, ['question']).map((o) => o.value)).toEqual(['open', 'any'])
    expect(optionsFor(status, ['feature', 'x']).map((o) => o.value)).toEqual(['done', 'any'])
    expect(optionsFor(status, []).map((o) => o.value)).toEqual(['open', 'done', 'any'])
    expect(optionsFor({ type: 'select', options: [{ value: 'a', for: ['x'] }] }, ['y']).map((o) => o.value)).toEqual(['a'])
    expect(optionsFor(undefined, ['x'])).toEqual([])
  })

  it('infers a field type from a value', () => {
    expect(inferFieldType(true)).toBe('checkbox')
    expect(inferFieldType(3)).toBe('number')
    expect(inferFieldType([{ text: 'a', done: false }])).toBe('checklist')
    expect(inferFieldType(['a', 'b'])).toBe('multiselect')
    expect(inferFieldType('[[Note]]')).toBe('link')
    expect(inferFieldType('2026-10-02')).toBe('date')
    expect(inferFieldType('two\nlines')).toBe('longtext')
    expect(inferFieldType('word')).toBe('text')
    expect(inferFieldType(null)).toBe('text')
  })

  it('treats undefined, null, empty strings / arrays and false as empty', () => {
    for (const v of [undefined, null, '', [], false]) expect(isEmptyValue(v)).toBe(true)
    for (const v of [0, 'x', [1], true]) expect(isEmptyValue(v)).toBe(false)
  })

  it('renders values as text by type', () => {
    expect(fieldText(status, 'done')).toBe('Done')
    expect(fieldText(status, 'open')).toBe('open')
    expect(fieldText({ type: 'multiselect', options: [{ value: 'a', label: 'A' }] }, ['a', 'b'])).toBe('A, b')
    expect(fieldText({ type: 'checkbox' }, true)).toBe('Yes')
    expect(fieldText({ type: 'rating', max: 5 }, 3)).toBe('★★★')
    expect(fieldText({ type: 'rating', max: 5 }, 99)).toBe('★★★★★')
    expect(fieldText({ type: 'checklist' }, [{ text: 'a', done: true }, { text: 'b', done: false }])).toBe('1/2')
    expect(fieldText({ type: 'text' }, undefined)).toBe('')
    expect(fieldText(undefined, 42)).toBe('42')
  })

  it('weights values by option points or the number itself', () => {
    const effort: FieldDef = { type: 'select', options: [{ value: 's', points: 2 }, { value: 'x' }] }
    expect(valuePoints(effort, 's')).toBe(2)
    expect(valuePoints(effort, 'x')).toBe(0)
    expect(valuePoints({ type: 'number' }, 7)).toBe(7)
    expect(valuePoints(undefined, 'nope')).toBe(0)
  })

  it('recognises done checkboxes by name or label', () => {
    expect(isDoneField('done', { type: 'checkbox' })).toBe(true)
    expect(isDoneField('Complete', { type: 'checkbox' })).toBe(true)
    expect(isDoneField('x', { type: 'checkbox', label: 'Done' })).toBe(true)
    expect(isDoneField('done', { type: 'text' })).toBe(false)
    expect(isDoneField('shipped', { type: 'checkbox' })).toBe(false)
  })

  it('derives a win / muted state from done checkboxes and select words', () => {
    const reg = { status: { type: 'select' as const }, done: { type: 'checkbox' as const } }
    expect(cardState({ fields: { done: true } }, reg)).toBe('win')
    expect(cardState({ fields: { status: 'accepted' } }, reg)).toBe('win')
    expect(cardState({ fields: { status: 'cut' } }, reg)).toBe('muted')
    expect(cardState({ fields: { status: 'planned' } }, reg)).toBeNull()
    expect(cardState({ fields: { note: 'done' } }, { note: { type: 'text' } })).toBeNull()
  })
})

describe('formmap/schema nodes', () => {
  it('recognises cards, groups and kanban nodes by type', () => {
    const d = doc([card('f'), group('g', { x: 0, y: 0, width: 10, height: 10 }), kanban('k', []), { id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1 }])
    expect(forms(d).map((n) => n.id)).toEqual(['f'])
    expect(groups(d).map((n) => n.id)).toEqual(['g'])
    expect(kanbans(d).map((n) => n.id)).toEqual(['k'])
    expect([isForm(d.nodes[0]), isGroup(d.nodes[1]), isKanban(d.nodes[2])]).toEqual([true, true, true])
  })

  it('creates empty plain cards with fresh ids', () => {
    const n = newForm({ x: 12, y: -40 })
    expect(n).toMatchObject({ type: 'form', title: '', text: '', tags: [], fields: {}, x: 12, y: -40 })
    expect(n.id).toMatch(/^[0-9a-f]{16}$/)
    expect(newForm({ x: 0, y: 0 }).id).not.toBe(n.id)
    expect(newForm({ x: 0, y: 0 }, { title: 'T', tags: ['a'], width: 999 })).toMatchObject({ title: 'T', tags: ['a'], width: 999 })
    expect('kind' in n).toBe(false)
  })

  it('titles a card by its title, else its first line, else "Untitled card"', () => {
    expect(cardTitle(card('a', { title: '  Hello  ', text: 'Body' }))).toBe('Hello')
    expect(cardTitle(card('a', { title: '', text: '## Big idea\nmore' }))).toBe('Big idea')
    expect(cardTitle(card('a', { title: '', text: '' }))).toBe('Untitled card')
  })

  it('cleans tags (trim, no leading #)', () => {
    expect(cleanTag('  #feature ')).toBe('feature')
    expect(cleanTag('##x')).toBe('x')
    expect(cleanTag(5)).toBe('')
  })

  it('maps relation names to definitions, custom ones included', () => {
    expect(relationDef('serves')).toBe(RELATIONS.serves)
    expect(relationDef(undefined)).toBe(RELATIONS.relates)
    expect(relationDef('blocks')).toMatchObject({ relation: 'blocks', label: 'Blocks', verb: 'blocks' })
  })
})

describe('formmap/schema presets + relation rules', () => {
  const meta: FormMapMeta = {
    version: 2,
    presets: [
      { id: 'plain', name: 'Plain' },
      { id: 'goal', name: 'Goal', tags: ['goal'], child: 'feature' },
      { id: 'feature', name: 'Feature', tags: ['feature'], fields: { status: 'planned' }, size: { width: 300, height: 180 }, color: '4' }
    ],
    relationRules: [{ from: 'feature', to: 'goal', relation: 'serves' }, { to: 'principle', relation: 'because' }]
  }

  it("matches a card to the first preset whose tags it carries (presets without tags never match)", () => {
    expect(presetOf({ tags: ['goal', 'x'] }, meta.presets)?.id).toBe('goal')
    expect(presetOf({ tags: ['x'] }, meta.presets)).toBeUndefined()
  })

  it('copies tags, fields, size and color from a preset', () => {
    const p = meta.presets![2]
    const base = fromPreset(p)
    expect(base).toEqual({ tags: ['feature'], fields: { status: 'planned' }, width: 300, height: 180, color: '4' })
    base.fields.status = 'x'
    expect(p.fields).toEqual({ status: 'planned' })
    expect(fromPreset(undefined)).toEqual({ tags: [], fields: {} })
  })

  it('infers relations from tag rules (first match), default relates', () => {
    expect(inferRelation(meta, { tags: ['feature'] }, { tags: ['goal'] })).toBe('serves')
    expect(inferRelation(meta, { tags: ['anything'] }, { tags: ['principle'] })).toBe('because')
    expect(inferRelation(meta, { tags: ['goal'] }, { tags: ['feature'] })).toBe('relates')
    expect(inferRelation({ version: 2 }, undefined, undefined)).toBe('relates')
  })
})

describe('formmap/schema groups', () => {
  const outer = group('outer', { x: 0, y: 0, width: 1000, height: 1000 }, { assign: { sprint: 12, status: 'todo' } })
  const inner = group('inner', { x: 100, y: 100, width: 300, height: 300 }, { assign: { status: 'doing' } })
  const d = doc([outer, inner])

  it('finds the innermost group containing a card center, and the whole chain outermost first', () => {
    const r = { x: 200, y: 200, width: 10, height: 10 }
    expect(groupAt(d, r)?.id).toBe('inner')
    expect(groupChain(d, r).map((g) => g.id)).toEqual(['outer', 'inner'])
    expect(groupAt(d, { x: 600, y: 600, width: 10, height: 10 })?.id).toBe('outer')
    expect(groupAt(d, { x: 2000, y: 0, width: 10, height: 10 })).toBeNull()
    // document order doesn't matter
    expect(groupChain(doc([inner, outer]), r).map((g) => g.id)).toEqual(['outer', 'inner'])
  })

  it('uses the card center and treats borders as inside', () => {
    expect(groupAt(d, { x: 950, y: 950, width: 100, height: 100 })?.id).toBe('outer')
    expect(groupAt(d, { x: 960, y: 960, width: 100, height: 100 })).toBeNull()
    expect(groupAt(d, { x: -5, y: -5, width: 10, height: 10 })?.id).toBe('outer')
  })

  it('merges assigns outermost first (inner groups win) and applies them to any field', () => {
    expect(assignOf([outer, inner])).toEqual({ sprint: 12, status: 'doing' })
    const c = card('c', { fields: { status: 'new', other: 1 } })
    const out = applyAssign(c, [outer, inner])
    expect(out.fields).toEqual({ status: 'doing', other: 1, sprint: 12 })
    expect(c.fields).toEqual({ status: 'new', other: 1 })
    expect(applyAssign(out, [outer, inner])).toBe(out)
    expect(applyAssign(c, [])).toBe(c)
  })

  it('clears a field when a group assigns an empty value', () => {
    const c = card('c', { fields: { owner: 'Ana' } })
    expect(applyAssign(c, [group('g', { x: 0, y: 0, width: 1, height: 1 }, { assign: { owner: '' } })]).fields).toEqual({})
  })
})

describe('formmap/schema filters', () => {
  const c = { tags: ['feature', 'ux'], fields: { phase: 'mvp', status: 'planned', list: ['a', 'b'] } }

  it('requires every tag and excludes notTags', () => {
    expect(matchesFilter(c, { tags: ['feature'] })).toBe(true)
    expect(matchesFilter(c, { tags: ['feature', 'goal'] })).toBe(false)
    expect(matchesFilter(c, { notTags: ['ux'] })).toBe(false)
    expect(matchesFilter(c, undefined)).toBe(true)
  })

  it('matches field values by equality, any-of arrays, null = empty, and array membership', () => {
    expect(matchesFilter(c, { fields: { phase: 'mvp' } })).toBe(true)
    expect(matchesFilter(c, { fields: { status: [null, 'planned'] } })).toBe(true)
    expect(matchesFilter(c, { fields: { missing: null } })).toBe(true)
    expect(matchesFilter(c, { fields: { phase: null } })).toBe(false)
    expect(matchesFilter(c, { fields: { list: 'b' } })).toBe(true)
    expect(matchesFilter(c, { notFields: { status: 'cut' } })).toBe(true)
    expect(matchesFilter(c, { notFields: { status: 'planned' } })).toBe(false)
  })
})
