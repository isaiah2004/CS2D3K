// Generates the structured "Project Definition" markdown from a form-map.
import type { CanvasData } from '../../canvas/model'
import { features, mvpStats, relationsOf } from '../analysis'
import {
  cardTitle,
  EFFORTS,
  fieldDef,
  forms,
  KINDS,
  optionOf,
  PHASES,
  PRIORITIES,
  zoneAt,
  type ChecklistItem,
  type FormKind,
  type FormMapData,
  type FormNode
} from '../schema'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || '—'
const label = (kind: FormKind, key: string, v: unknown): string => optionOf(fieldDef(kind, key), v)?.label ?? ''
/** strips a leading "3. " so we can number principles ourselves */
const unnumbered = (t: string): string => t.replace(/^\s*\d+[.)]\s+/, '')
const leadingNumber = (t: string): number => {
  const m = /^\s*(\d+)[.)]\s/.exec(t)
  return m ? Number(m[1]) : Infinity
}
/** reading order on the map: top-to-bottom, then left-to-right (rows of ~60px) */
const byPosition = (a: FormNode, b: FormNode): number => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x
const rank = <T extends { value: string }>(opts: T[], v: unknown): number => {
  const i = opts.findIndex((o) => o.value === v)
  return i < 0 ? opts.length : i
}
/** body text, without repeating a field that says the same thing */
const body = (f: FormNode, ...dupes: unknown[]): string => {
  const t = str(f.text)
  return t && !dupes.some((d) => str(d) === t) ? t : ''
}
const quoteBlock = (s: string): string =>
  s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

export function definitionMarkdown(data: CanvasData, fallbackTitle: string): string {
  const d = data as FormMapData
  const all = forms(d)
  const titleOf = new Map(all.map((f) => [f.id, cardTitle(f)]))
  const ofKind = (k: FormKind): FormNode[] => all.filter((f) => f.kind === k).sort(byPosition)
  const related = (f: FormNode, relation: string, kind?: FormKind, dir: 'out' | 'in' = 'out'): string[] =>
    relationsOf(d, f.id)
      .filter((r) => r.relation === relation && r.dir === dir && (!kind || all.find((x) => x.id === r.other)?.kind === kind))
      .map((r) => titleOf.get(r.other))
      .filter((t): t is string => !!t)
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  // ------------------------------------------------ title + core idea
  push(`# ${d.formmap?.title?.trim() || fallbackTitle}`, '')
  const coreZone = all.filter((f) => /core idea/i.test(zoneAt(d, f)?.label ?? ''))
  push('## Core idea', '')
  if (coreZone.length)
    for (const f of coreZone.sort(byPosition)) {
      push(`**${cardTitle(f)}**`, '')
      if (body(f)) push(body(f), '')
    }
  else push('_Not defined yet._', '')

  // ------------------------------------------------ philosophy
  const principles = ofKind('principle').sort((a, b) => leadingNumber(cardTitle(a)) - leadingNumber(cardTitle(b)))
  push('## Philosophy', '')
  if (!principles.length) push('_No principles yet._', '')
  principles.forEach((p, i) => {
    push(`### ${i + 1}. ${unnumbered(cardTitle(p))}`, '')
    if (body(p, p.fields.why)) push(body(p, p.fields.why), '')
    if (str(p.fields.why)) push(`**Why:** ${str(p.fields.why)}`, '')
    const by = related(p, 'because', undefined, 'in')
    if (by.length) push(`_Drives:_ ${by.join(', ')}`, '')
  })

  // ------------------------------------------------ engineering approach (ADR style)
  const approaches = ofKind('approach').sort((a, b) => rank(KINDS.approach.fields[0].options!, a.fields.status) - rank(KINDS.approach.fields[0].options!, b.fields.status))
  push('## Engineering approach', '')
  if (!approaches.length) push('_No engineering decisions yet._', '')
  approaches.forEach((a, i) => {
    push(`### ADR-${String(i + 1).padStart(2, '0')}: ${cardTitle(a)}`, '')
    const meta = [`**Status:** ${label('approach', 'status', a.fields.status) || 'Proposed'}`]
    const because = related(a, 'because', 'principle')
    if (because.length) meta.push(`**Because:** ${because.map(unnumbered).join('; ')}`)
    push(meta.join(' · '), '')
    const decision = body(a, a.fields.rationale)
    if (decision) push(`**Decision:** ${decision}`, '')
    if (str(a.fields.rationale)) push(`**Rationale:** ${str(a.fields.rationale)}`, '')
    if (str(a.fields.alternatives)) push(`**Alternatives considered:** ${str(a.fields.alternatives)}`, '')
  })

  // ------------------------------------------------ final goal
  const goals = ofKind('goal').sort((a, b) => (a.fields.horizon === 'final' ? 0 : 1) - (b.fields.horizon === 'final' ? 0 : 1))
  push('## Final goal', '')
  if (!goals.length) push('_No goals yet._', '')
  for (const g of goals) {
    const tag = g.fields.horizon === 'milestone' ? ' _(milestone)_' : ''
    push(`### 🎯 ${cardTitle(g)}${tag}`, '')
    if (body(g)) push(body(g), '')
    if (str(g.fields.metric)) push(`- **Success metric:** ${str(g.fields.metric)}`)
    const servedBy = related(g, 'serves', 'feature', 'in')
    if (servedBy.length) push(`- **Served by:** ${servedBy.join(', ')}`)
    if (str(g.fields.metric) || servedBy.length) push('')
  }

  // ------------------------------------------------ MVP
  const mvp = features(d, 'mvp').sort(
    (a, b) => rank(PRIORITIES, a.fields.priority) - rank(PRIORITIES, b.fields.priority) || (b.votes ?? 0) - (a.votes ?? 0) || byPosition(a, b)
  )
  const stats = mvpStats(d)
  push('## Initial features (MVP)', '')
  if (!mvp.length) push('_No MVP features yet._', '')
  else {
    const budget = stats.budget !== null ? ` of a ${stats.budget}-point budget` : ''
    push(`${mvp.length} feature${mvp.length === 1 ? '' : 's'} · ${stats.done} done · ${stats.points} effort points${budget}.`, '')
    push('| Feature | Priority | Effort | Status | Fun | Serves |', '| --- | --- | --- | --- | --- | --- |')
    for (const f of mvp) {
      // clamp: a hand-edited file may hold -1 or 1e9, and String.repeat throws on negatives/Infinity
      const fun = Math.max(0, Math.min(fieldDef('feature', 'fun')?.max ?? 5,Math.round(Number(f.fields.fun) || 0)))
      push(
        `| ${cell(cardTitle(f))} | ${cell(label('feature', 'priority', f.fields.priority))} | ${cell(label('feature', 'effort', f.fields.effort))} | ${cell(label('feature', 'status', f.fields.status))} | ${fun ? '★'.repeat(fun) : '—'} | ${cell(related(f, 'serves', 'goal').join(', '))} |`
      )
    }
    push('')
    for (const f of mvp) {
      const ac = (Array.isArray(f.fields.acceptance) ? f.fields.acceptance : []) as ChecklistItem[]
      push(`### ${cardTitle(f)}`, '')
      if (body(f)) push(body(f), '')
      const deps = related(f, 'depends')
      if (deps.length) push(`_Depends on:_ ${deps.join(', ')}`, '')
      if (str(f.fields.note)) push(`_Notes:_ ${str(f.fields.note)}`, '')
      push('**Acceptance criteria**', '')
      if (ac.length) push(...ac.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`), '')
      else push('- [ ] _To be defined_', '')
    }
  }

  // ------------------------------------------------ later features
  const later = all.filter((f) => f.kind === 'feature' && f.fields.phase !== 'mvp')
  push('## Later features', '')
  if (!later.length) push('_Nothing parked for later._', '')
  const groups = [...PHASES.filter((p) => p.value !== 'mvp').map((p) => ({ value: p.value as string | undefined, label: p.label })), { value: undefined, label: 'Unscheduled' }]
  for (const g of groups) {
    const list = later
      .filter((f) => (g.value ? f.fields.phase === g.value : !PHASES.some((p) => p.value === f.fields.phase)))
      .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || rank(PRIORITIES, a.fields.priority) - rank(PRIORITIES, b.fields.priority) || byPosition(a, b))
    if (!list.length) continue
    push(`### ${g.label}`, '')
    for (const f of list) {
      const tags = [label('feature', 'priority', f.fields.priority), EFFORTS.find((e) => e.value === f.fields.effort)?.label, f.fields.status && f.fields.status !== 'idea' ? label('feature', 'status', f.fields.status) : '']
        .filter(Boolean)
        .join(' · ')
      const serves = related(f, 'serves', 'goal')
      const text = body(f)
      push(`- **${cardTitle(f)}**${tags ? ` (${tags})` : ''}${text ? ` — ${text.replace(/\n+/g, ' ')}` : ''}${serves.length ? ` _Serves: ${serves.join(', ')}_` : ''}`)
    }
    push('')
  }

  // ------------------------------------------------ questions + decisions
  const questions = ofKind('question')
  const open = questions.filter((q) => q.fields.status !== 'decided')
  const decided = questions.filter((q) => q.fields.status === 'decided')
  push('## Open questions', '')
  if (!open.length) push('_None — every question is decided._', '')
  for (const q of open) {
    const parked = q.fields.status === 'parked' ? ' _(parked)_' : ''
    push(`- [ ] **${cardTitle(q)}**${parked}`)
    if (body(q)) push(`  ${body(q).replace(/\n+/g, ' ')}`)
    if (str(q.fields.options)) push(`  _Options:_ ${str(q.fields.options).replace(/\n+/g, ' ')}`)
  }
  if (open.length) push('')
  push('## Decisions', '')
  if (!decided.length) push('_No decisions recorded yet._', '')
  for (const q of decided) {
    push(`### ✅ ${cardTitle(q)}`, '')
    if (str(q.fields.decision)) push(quoteBlock(str(q.fields.decision)), '')
    if (body(q, q.fields.decision)) push(body(q, q.fields.decision), '')
  }

  // ------------------------------------------------ idea inbox
  const ideas = ofKind('idea').filter((i) => i.fields.status !== 'merged' && i.fields.status !== 'dropped')
  push('## Idea inbox', '')
  if (!ideas.length) push('_Empty — every idea has been triaged._', '')
  for (const i of ideas) {
    const s = label('idea', 'status', i.fields.status)
    const text = body(i)
    push(`- 💡 **${cardTitle(i)}**${s && s !== 'Raw' ? ` (${s})` : ''}${text ? ` — ${text.replace(/\n+/g, ' ')}` : ''}${(i.votes ?? 0) > 0 ? ` · ${i.votes} vote${i.votes === 1 ? '' : 's'}` : ''}`)
  }
  if (ideas.length) push('')

  push('---', '', `_Generated from a CS2D3K form-map._`, '')
  return out.join('\n')
}
