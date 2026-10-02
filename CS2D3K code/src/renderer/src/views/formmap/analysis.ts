// Graph analysis over a form-map: "why" traces, the coach checks (generic ones + the map's declarative rules) and stats.
import type { CanvasData } from '../canvas/model'
import { boardColumns, NONE } from './boards'
import {
  assignOf,
  cardState,
  cardTitle,
  fieldLabel,
  forms,
  groupChainIn,
  groups,
  groupTitle,
  isEmptyValue,
  kanbans,
  matchesFilter,
  metaOf,
  parentGroup,
  relationDef,
  sameValue,
  valuePoints,
  type CardFilter,
  type CheckLevel,
  type CheckRule,
  type ChecklistItem,
  type FormMapEdge,
  type FormNode,
  type Relation
} from './schema'

export type { CheckLevel } from './schema'

/** Relations that point "upstream" (toward the reason a card exists). */
const UPSTREAM: Relation[] = ['serves', 'because', 'refines', 'depends']

/**
 * Everything connected to `id` through meaningful relations:
 * upstream (what this card serves / is motivated by) and downstream (what serves it).
 * Returns node ids + edge ids, including `id` itself.
 */
export function whyTrace(d: CanvasData, id: string): string[] {
  // adjacency (in edge order, so the result order matches a scan of all edges per step) — linear, not nodes × edges
  const up = new Map<string, FormMapEdge[]>()
  const down = new Map<string, FormMapEdge[]>()
  for (const e of d.edges as FormMapEdge[]) {
    if (!UPSTREAM.includes(e.relation ?? 'relates')) continue
    const u = up.get(e.fromNode)
    if (u) u.push(e)
    else up.set(e.fromNode, [e])
    const dn = down.get(e.toNode)
    if (dn) dn.push(e)
    else down.set(e.toNode, [e])
  }
  const out = new Set<string>([id])
  const walk = (start: string, dir: 'up' | 'down'): void => {
    const stack = [start]
    const seen = new Set<string>([start])
    while (stack.length) {
      const cur = stack.pop()!
      for (const e of (dir === 'up' ? up : down).get(cur) ?? []) {
        const next = dir === 'up' ? e.toNode : e.fromNode
        // the edge is part of the chain even when `next` was already reached another way (diamonds, cycles)
        out.add(e.id)
        if (seen.has(next)) continue
        seen.add(next)
        out.add(next)
        stack.push(next)
      }
    }
  }
  walk(id, 'up')
  walk(id, 'down')
  return [...out]
}

/** Relations of a card, both directions. */
export function relationsOf(d: CanvasData, id: string): { relation: Relation; other: string; edgeId: string; dir: 'out' | 'in' }[] {
  const res: { relation: Relation; other: string; edgeId: string; dir: 'out' | 'in' }[] = []
  for (const e of d.edges as FormMapEdge[]) {
    if (e.fromNode === id) res.push({ relation: e.relation ?? 'relates', other: e.toNode, edgeId: e.id, dir: 'out' })
    else if (e.toNode === id) res.push({ relation: e.relation ?? 'relates', other: e.fromNode, edgeId: e.id, dir: 'in' })
  }
  return res
}

export interface CoachCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
  /** cards involved — clicking reveals them */
  nodes: string[]
  /** a one-click fix the Coach tab offers (see CoachTab) */
  fix?: 'apply-groups'
  /** budget bar (sum rules) */
  sum?: { value: number; max?: number; label: string; unit?: string }
}

// ---------------------------------------------------------------- messages

const titleList = (list: { title?: string; text?: string }[]): string => {
  const names = list.slice(0, 3).map((f) => `“${cardTitle(f)}”`)
  return names.join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')
}

/** "{n} {n|card|cards}" style templates: {n}, {titles}, {sum}, {max}, {unit}, {label} and {n|singular|plural}. */
export function fmt(template: string, vars: { n?: number; titles?: string; [k: string]: string | number | undefined }): string {
  return template.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (m, key: string, one?: string, many?: string) => {
    const v = vars[key]
    if (one !== undefined) return v === 1 ? one : (many ?? '')
    return v === undefined ? m : String(v)
  })
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------- rules

/** Runs one declarative rule (a template's check) over the cards. */
export function runRule(d: CanvasData, rule: CheckRule, all: FormNode[] = forms(d)): CoachCheck | null {
  const matched = all.filter((c) => matchesFilter(c, rule.match))
  const level = rule.level ?? 'info'
  const finish = (flagged: FormNode[], lvl: CheckLevel = level): CoachCheck | null => {
    if (flagged.length) return { id: rule.id, level: lvl, title: fmt(rule.title ?? '', { n: flagged.length }), detail: rule.detail ? fmt(rule.detail, { n: flagged.length, titles: titleList(flagged) }) : undefined, nodes: flagged.map((f) => f.id) }
    return matched.length && rule.good ? { id: rule.id, level: 'good', title: rule.good, nodes: [] } : null
  }
  switch (rule.type) {
    case 'relation': {
      const byId = new Map(all.map((c) => [c.id, c]))
      const ok = new Set<string>()
      for (const e of d.edges as FormMapEdge[]) {
        if ((e.relation ?? 'relates') !== rule.relation) continue
        const [self, other] = rule.dir === 'in' ? [e.toNode, e.fromNode] : [e.fromNode, e.toNode]
        const o = byId.get(other)
        if (!rule.target || (o && matchesFilter(o, rule.target))) ok.add(self)
      }
      return finish(matched.filter((c) => !ok.has(c.id)))
    }
    case 'field':
      return finish(matched.filter((c) => isEmptyValue(c.fields[rule.field])))
    case 'count':
      return finish(matched, rule.warnAbove !== undefined && matched.length > rule.warnAbove ? 'warn' : level)
    case 'sum': {
      if (!matched.length) return null
      const def = metaOf(d).fields?.[rule.field]
      const value = matched.reduce((s, c) => s + valuePoints(def, c.fields[rule.field]), 0)
      const unit = rule.unit ? ` ${rule.unit}` : ''
      const sum = { value, max: rule.max, label: rule.label, unit: rule.unit }
      if (!rule.max) return { id: rule.id, level: 'info', title: `${rule.label}: ${value}${unit}`, nodes: [], sum }
      if (value > rule.max)
        return {
          id: rule.id,
          level: 'warn',
          title: `${rule.label} is over budget: ${value} / ${rule.max}${unit}`,
          detail: `Move ${value - rule.max}+${unit} out, or shrink cards. The smallest scope that proves the idea wins.`,
          nodes: matched.map((c) => c.id),
          sum
        }
      return { id: rule.id, level: 'good', title: `${rule.label} fits the budget (${value} / ${rule.max}${unit})`, nodes: [], sum }
    }
  }
}

/** Decision-support checks: generic ones, then the map's own rules. Warnings first, then info, then good news. */
export function coachChecks(d: CanvasData): CoachCheck[] {
  const all = forms(d)
  const meta = metaOf(d)
  const reg = meta.fields ?? {}
  const gs = groups(d)
  const nodeIds = new Set(d.nodes.map((n) => n.id))
  const cards = new Map(all.map((f) => [f.id, f]))
  const edges = d.edges as FormMapEdge[]
  const out: CoachCheck[] = []
  const ids = (list: FormNode[]): string[] => list.map((f) => f.id)
  const detail = (list: FormNode[], tail: string): string => `${titleList(list)}. ${tail}`

  // broken relations (an end is missing)
  const dangling = edges.filter((e) => !nodeIds.has(e.fromNode) || !nodeIds.has(e.toNode))
  if (dangling.length)
    out.push({ id: 'dangling', level: 'warn', title: count(dangling.length, 'broken relation'), detail: 'They point at cards that no longer exist. Remove them from the Card tab or the canvas.', nodes: dangling.flatMap((e) => [e.fromNode, e.toNode, e.id]).filter((id) => nodeIds.has(id)) })

  // contradictions between cards that are still open
  const settled = (id: string): boolean => {
    const c = cards.get(id)
    return !c || cardState(c, reg) !== null
  }
  const conflicts = edges.filter((e) => e.relation === 'contradicts' && nodeIds.has(e.fromNode) && nodeIds.has(e.toNode) && !settled(e.fromNode) && !settled(e.toNode))
  if (conflicts.length)
    out.push({
      id: 'contradictions',
      level: 'warn',
      title: count(conflicts.length, 'unresolved contradiction'),
      detail: 'Two cards pull in opposite directions. Decide which wins, then close, cut or park the other.',
      nodes: [...new Set(conflicts.flatMap((e) => [e.fromNode, e.toNode, e.id]))]
    })

  // cards whose fields disagree with what their group assigns (moved in before the group assigned it, or edited later)
  const chains = new Map(all.map((c) => [c.id, groupChainIn(gs, c)]))
  const mismatched = all.filter((c) => Object.entries(assignOf(chains.get(c.id)!)).some(([k, v]) => !sameValue(c.fields[k], v)))
  if (mismatched.length)
    out.push({
      id: 'group-mismatch',
      level: 'info',
      title: `${count(mismatched.length, 'card')} ${mismatched.length === 1 ? "doesn't" : "don't"} match ${mismatched.length === 1 ? 'its group' : 'their groups'}`,
      detail: detail(mismatched, 'Their group sets fields they lack or contradict.'),
      nodes: ids(mismatched),
      fix: 'apply-groups'
    })

  // field boards: cards in scope without a value for the board's field
  for (const b of meta.boards ?? []) {
    if (b.source.mode !== 'field') continue
    const none = boardColumns(d, b).find((c) => c.key === NONE)?.cards ?? []
    if (none.length)
      out.push({
        id: `board-field:${b.id}`,
        level: 'info',
        title: `${count(none.length, 'card')} without ${fieldLabel(b.source.field, reg[b.source.field]).toLowerCase()} on “${b.name}”`,
        detail: detail(none, 'Set it so the board can place them.'),
        nodes: ids(none)
      })
  }

  // the map's own (template) rules
  for (const r of meta.checks ?? []) {
    try {
      const c = runRule(d, r, all)
      if (c) out.push(c)
    } catch {
      /* a hand-edited rule must not break the coach */
    }
  }

  // structure
  if (gs.length) {
    const loose = all.filter((c) => !chains.get(c.id)!.length)
    if (loose.length) out.push({ id: 'no-group', level: 'info', title: `${count(loose.length, 'card')} outside any group`, detail: detail(loose, 'Drop them into a group to give them meaning.'), nodes: ids(loose) })
    const used = new Set<string>()
    for (const n of d.nodes) {
      if (n.type === 'group' || n.type === 'drawing') continue
      for (const g of groupChainIn(gs, n)) used.add(g.id)
    }
    const parents = new Set(gs.map((o) => parentGroup(gs, o)?.id))
    const empty = gs.filter((g) => !used.has(g.id) && !parents.has(g.id))
    if (empty.length)
      out.push({ id: 'empty-groups', level: 'info', title: count(empty.length, 'empty group'), detail: `${empty.slice(0, 3).map((g) => `“${groupTitle(g)}”`).join(', ')}${empty.length > 3 ? ` and ${empty.length - 3} more` : ''}. Fill or remove ${empty.length === 1 ? 'it' : 'them'}.`, nodes: empty.map((g) => g.id) })
  }
  if (all.some((c) => c.tags?.length)) {
    const untagged = all.filter((c) => !c.tags?.length)
    if (untagged.length) out.push({ id: 'untagged', level: 'info', title: count(untagged.length, 'untagged card'), detail: detail(untagged, 'Tags make them easy to filter, color and check.'), nodes: ids(untagged) })
  }
  const checklists = all.filter((c) => Object.entries(c.fields).some(([k, v]) => reg[k]?.type === 'checklist' && Array.isArray(v) && (v as ChecklistItem[]).some((i) => !i?.done)))
  if (checklists.length)
    out.push({ id: 'open-checklists', level: 'info', title: `${count(checklists.length, 'card')} with open checklist items`, detail: detail(checklists, 'Tick them off as they get done.'), nodes: ids(checklists) })
  const byTitle = new Map<string, FormNode[]>()
  for (const c of all) {
    const t = c.title?.trim().toLowerCase()
    if (!t) continue
    const list = byTitle.get(t)
    if (list) list.push(c)
    else byTitle.set(t, [c])
  }
  const dupes = [...byTitle.values()].filter((l) => l.length > 1)
  if (dupes.length)
    out.push({
      id: 'duplicates',
      level: 'info',
      title: count(dupes.length, 'duplicate title'),
      detail: `${dupes.slice(0, 3).map((l) => `“${cardTitle(l[0])}” ×${l.length}`).join(', ')}. Merge them, or say how they differ.`,
      nodes: dupes.flat().map((c) => c.id)
    })
  if (!all.length && !kanbans(d).length) out.push({ id: 'empty', level: 'info', title: 'Start by capturing a few cards', detail: 'Double-click the canvas, or use the toolbar. Group them when patterns appear.', nodes: [] })

  const rank: Record<CheckLevel, number> = { warn: 0, info: 1, good: 2 }
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank[a.c.level] - rank[b.c.level] || a.i - b.i).map((x) => x.c)
}

// ---------------------------------------------------------------- stats

export interface MapStats {
  cards: number
  groups: number
  boards: number
  kanbans: number
  votes: number
  /** checklist items across all checklist fields */
  checklist: { done: number; total: number }
}

export function mapStats(d: CanvasData): MapStats {
  const reg = metaOf(d).fields ?? {}
  const s: MapStats = { cards: 0, groups: groups(d).length, boards: metaOf(d).boards?.length ?? 0, kanbans: 0, votes: 0, checklist: { done: 0, total: 0 } }
  for (const n of d.nodes) {
    if (n.type === 'kanban') s.kanbans++
    if (n.type !== 'form') continue
    const f = n as FormNode
    s.cards++
    s.votes += f.votes ?? 0
    for (const [k, v] of Object.entries(f.fields ?? {}))
      if (reg[k]?.type === 'checklist' && Array.isArray(v))
        for (const i of v as ChecklistItem[]) {
          s.checklist.total++
          if (i?.done) s.checklist.done++
        }
  }
  return s
}

/** Cards with checklist items (HUD highlight). */
export function checklistCards(d: CanvasData): string[] {
  const reg = metaOf(d).fields ?? {}
  return forms(d)
    .filter((f) => Object.entries(f.fields).some(([k, v]) => reg[k]?.type === 'checklist' && Array.isArray(v) && v.length))
    .map((f) => f.id)
}

/** Matching helper re-exported for the lenses (focus filter, board filter). */
export const cardMatches = (c: FormNode, f: CardFilter | undefined): boolean => matchesFilter(c, f)

/** Relation label for a direction ("Serves" / "Served by"). */
export const relationTitle = (r: Relation, dir: 'out' | 'in'): string => (dir === 'out' ? relationDef(r).label : relationDef(r).inverse)
