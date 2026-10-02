// Graph analysis over a form-map: "why" traces and coach checks.
import type { CanvasData } from '../canvas/model'
import { cardTitle, effortPoints, forms, type FormMapEdge, type FormNode, type Relation } from './schema'

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

/** Outgoing relations of a card, by relation type. */
export function relationsOf(d: CanvasData, id: string): { relation: Relation; other: string; edgeId: string; dir: 'out' | 'in' }[] {
  const res: { relation: Relation; other: string; edgeId: string; dir: 'out' | 'in' }[] = []
  for (const e of d.edges as FormMapEdge[]) {
    if (e.fromNode === id) res.push({ relation: e.relation ?? 'relates', other: e.toNode, edgeId: e.id, dir: 'out' })
    else if (e.toNode === id) res.push({ relation: e.relation ?? 'relates', other: e.fromNode, edgeId: e.id, dir: 'in' })
  }
  return res
}

export type CheckLevel = 'warn' | 'info' | 'good'

export interface CoachCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
  /** cards involved — clicking reveals them */
  nodes: string[]
}

/** Features that are in a phase (default: all) */
export function features(d: CanvasData, phase?: string): FormNode[] {
  return forms(d).filter((f) => f.kind === 'feature' && (!phase || f.fields.phase === phase))
}

// ---------------------------------------------------------------- stats + coach

/** A feature counts unless it was cut. */
const isLive = (f: FormNode): boolean => f.fields.status !== 'cut'

export const isOpenQuestion = (f: FormNode): boolean => f.kind === 'question' && (!f.fields.status || f.fields.status === 'open')

/** A card that no longer needs a decision (cut, superseded, decided, parked, dropped, merged). */
function isSettled(f: FormNode | undefined): boolean {
  if (!f) return true
  const s = f.fields.status
  return s === 'cut' || s === 'superseded' || s === 'decided' || s === 'parked' || s === 'dropped' || s === 'merged'
}

export interface MvpStats {
  /** MVP features that were not cut */
  total: number
  done: number
  /** effort points of those features */
  points: number
  /** null = no budget set */
  budget: number | null
}

export function mvpStats(d: CanvasData): MvpStats {
  const mvp = features(d, 'mvp').filter(isLive)
  const budget = (d as { formmap?: { mvpBudget?: number } }).formmap?.mvpBudget
  return {
    total: mvp.length,
    done: mvp.filter((f) => f.fields.status === 'done').length,
    points: mvp.reduce((s, f) => s + effortPoints(f.fields.effort), 0),
    budget: typeof budget === 'number' && budget > 0 ? budget : null
  }
}

export interface MapStats {
  openQuestions: number
  /** accepted approaches + decided questions */
  decisions: number
  votes: number
}

export function mapStats(d: CanvasData): MapStats {
  const s: MapStats = { openQuestions: 0, decisions: 0, votes: 0 }
  for (const f of forms(d)) {
    s.votes += f.votes ?? 0
    if (isOpenQuestion(f)) s.openQuestions++
    else if ((f.kind === 'question' && f.fields.status === 'decided') || (f.kind === 'approach' && f.fields.status === 'accepted')) s.decisions++
  }
  return s
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const itThem = (n: number): string => (n === 1 ? 'it' : 'them')

function titles(list: FormNode[]): string {
  const names = list.slice(0, 3).map((f) => `“${cardTitle(f)}”`)
  return names.join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')
}

/** Decision-support checks over the map: warnings first, then info, then good news. */
export function coachChecks(d: CanvasData): CoachCheck[] {
  const all = forms(d)
  const cards = new Map(all.map((f) => [f.id, f]))
  const edges = d.edges as FormMapEdge[]
  const rel = (e: FormMapEdge): Relation => e.relation ?? 'relates'
  const ofKind = (kind: FormNode['kind']): FormNode[] => all.filter((f) => f.kind === kind)
  const out: CoachCheck[] = []
  const ids = (list: FormNode[]): string[] => list.map((f) => f.id)

  // features <-> goals
  const feats = ofKind('feature').filter(isLive)
  const goals = ofKind('goal')
  const serves = edges.filter((e) => rel(e) === 'serves')
  // linear lookups (these were nested scans: goals × serves × features on big maps)
  const featIds = new Set(feats.map((f) => f.id))
  const servesAGoal = new Set<string>()
  const servedGoals = new Set<string>()
  for (const e of serves) {
    if (cards.get(e.toNode)?.kind === 'goal') servesAGoal.add(e.fromNode)
    if (featIds.has(e.fromNode)) servedGoals.add(e.toNode)
  }
  const orphans = feats.filter((f) => !servesAGoal.has(f.id))
  if (orphans.length)
    out.push({
      id: 'feature-no-goal',
      level: 'warn',
      title: `${count(orphans.length, 'feature')} ${orphans.length === 1 ? 'serves' : 'serve'} no goal`,
      detail: `${titles(orphans)}. Connect each to the goal it helps achieve — or ask whether it belongs at all.`,
      nodes: ids(orphans)
    })
  else if (feats.length && goals.length) out.push({ id: 'feature-no-goal', level: 'good', title: 'Every feature serves a goal', nodes: [] })

  const lonely = goals.filter((g) => !servedGoals.has(g.id))
  if (lonely.length)
    out.push({
      id: 'goal-no-features',
      level: 'warn',
      title: `${count(lonely.length, 'goal')} with no features`,
      detail: `${titles(lonely)}. Nothing we plan to build moves ${itThem(lonely.length)} forward.`,
      nodes: ids(lonely)
    })
  else if (goals.length) out.push({ id: 'goal-no-features', level: 'good', title: 'Every goal has features serving it', nodes: [] })

  // MVP budget + sizing
  const mvp = features(d, 'mvp').filter(isLive)
  const stats = mvpStats(d)
  if (stats.budget !== null && mvp.length) {
    if (stats.points > stats.budget)
      out.push({
        id: 'mvp-budget',
        level: 'warn',
        title: `MVP is over budget: ${stats.points} / ${stats.budget} pts`,
        detail: `Move ${stats.points - stats.budget}+ points to Later, or shrink features. The smallest MVP that proves the idea wins.`,
        nodes: ids(mvp)
      })
    else out.push({ id: 'mvp-budget', level: 'good', title: `MVP fits the budget (${stats.points} / ${stats.budget} pts)`, nodes: [] })
  }
  const unsized = mvp.filter((f) => !f.fields.effort)
  if (unsized.length)
    out.push({
      id: 'mvp-unsized',
      level: 'info',
      title: `${count(unsized.length, 'MVP feature')} without an effort estimate`,
      detail: `${titles(unsized)}. The budget can't see ${itThem(unsized.length)}.`,
      nodes: ids(unsized)
    })

  // principles nobody references via `because`
  const principles = ofKind('principle')
  const becauseTargets = new Set(edges.filter((e) => rel(e) === 'because').map((e) => e.toNode))
  const unused = principles.filter((p) => !becauseTargets.has(p.id))
  if (unused.length)
    out.push({
      id: 'unused-principles',
      level: 'info',
      title: `${count(unused.length, 'principle')} nobody relies on`,
      detail: `${titles(unused)}. No decision is "because" of ${itThem(unused.length)} — link one, or let the principle go.`,
      nodes: ids(unused)
    })
  else if (principles.length) out.push({ id: 'unused-principles', level: 'good', title: 'Every principle drives a decision', nodes: [] })

  // approaches still proposed
  const approaches = ofKind('approach')
  const proposed = approaches.filter((a) => !a.fields.status || a.fields.status === 'proposed')
  if (proposed.length)
    out.push({
      id: 'approaches-proposed',
      level: 'info',
      title: `${count(proposed.length, 'approach', 'approaches')} still proposed`,
      detail: `${titles(proposed)}. Accept or supersede ${itThem(proposed.length)} so everyone builds with confidence.`,
      nodes: ids(proposed)
    })
  else if (approaches.length) out.push({ id: 'approaches-proposed', level: 'good', title: 'All engineering approaches are decided', nodes: [] })

  // open questions + contradictions
  const questions = ofKind('question')
  const open = questions.filter(isOpenQuestion)
  if (open.length)
    out.push({
      id: 'open-questions',
      level: open.length > 3 ? 'warn' : 'info',
      title: count(open.length, 'open question'),
      detail: `${titles(open)}. Decide ${itThem(open.length)}, or park ${itThem(open.length)} explicitly.`,
      nodes: ids(open)
    })
  else if (questions.length) out.push({ id: 'open-questions', level: 'good', title: 'No open questions left', nodes: [] })

  const conflicts = edges.filter((e) => rel(e) === 'contradicts' && !isSettled(cards.get(e.fromNode)) && !isSettled(cards.get(e.toNode)))
  if (conflicts.length)
    out.push({
      id: 'contradictions',
      level: 'warn',
      title: count(conflicts.length, 'unresolved contradiction'),
      detail: 'Two cards pull in opposite directions. Decide which wins, then cut, supersede or park the other.',
      nodes: [...new Set(conflicts.flatMap((e) => [e.fromNode, e.toNode, e.id]))]
    })

  // acceptance criteria
  const noCriteria = mvp.filter((f) => !Array.isArray(f.fields.acceptance) || !f.fields.acceptance.length)
  if (noCriteria.length)
    out.push({
      id: 'mvp-no-acceptance',
      level: 'info',
      title: `${count(noCriteria.length, 'MVP feature')} without acceptance criteria`,
      detail: `${titles(noCriteria)}. How will we know ${noCriteria.length === 1 ? 'it is' : 'they are'} done?`,
      nodes: ids(noCriteria)
    })
  else if (mvp.length) out.push({ id: 'mvp-no-acceptance', level: 'good', title: 'Every MVP feature has acceptance criteria', nodes: [] })

  // idea inbox
  const raw = ofKind('idea').filter((i) => !i.fields.status || i.fields.status === 'raw')
  if (raw.length)
    out.push({
      id: 'raw-ideas',
      level: 'info',
      title: `${count(raw.length, 'raw idea')} waiting in the inbox`,
      detail: `${titles(raw)}. Triage: refine into a feature, merge, or drop.`,
      nodes: ids(raw)
    })

  if (!feats.length && !goals.length && !principles.length)
    out.push({ id: 'empty', level: 'info', title: 'Start with the core idea', detail: 'Then add a goal, a few principles, and the features that serve them.', nodes: [] })

  const rank: Record<CheckLevel, number> = { warn: 0, info: 1, good: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}
