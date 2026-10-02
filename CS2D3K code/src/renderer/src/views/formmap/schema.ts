// Form-map domain model.
//
// A .formmap file is a JSON Canvas superset (same as .canvas) with three extra node types and typed edges:
//   form    — a typed "form card" (idea, principle, goal, approach, feature, question, note) with fields
//   zone    — a semantic region; cards dropped inside inherit its `assign` fields (position = meaning)
//   drawing — a freehand annotation stroke
// Edges may carry `relation` (serves, because, depends, refines, contradicts, relates).
// Top-level `formmap` holds map-wide metadata. Unknown fields are preserved on save.
import type { CanvasData, CanvasEdge, CanvasNode } from '../canvas/model'
import { hexId } from '@/lib/util'

export const FORMMAP_VERSION = 1

// ---------------------------------------------------------------- card kinds

export type FormKind = 'idea' | 'principle' | 'goal' | 'approach' | 'feature' | 'question' | 'note'

export type FieldType = 'text' | 'longtext' | 'number' | 'select' | 'checkbox' | 'date' | 'rating' | 'checklist' | 'link'

export interface FieldOption {
  value: string
  label: string
  /** css color for chips */
  color?: string
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: FieldOption[]
  /** rating max (default 5) */
  max?: number
  placeholder?: string
  /** shown on the card face (not only in the inspector) */
  onCard?: boolean
  help?: string
}

export interface KindDef {
  kind: FormKind
  label: string
  plural: string
  emoji: string
  /** css color (var or hex) used for the card accent */
  color: string
  /** one-line description shown in pickers */
  hint: string
  fields: FieldDef[]
  defaultSize: { width: number; height: number }
}

/** A checklist item (for `checklist` fields, e.g. acceptance criteria) */
export interface ChecklistItem {
  text: string
  done: boolean
}

const STATUS_COLORS = {
  gray: 'var(--text-faint)',
  blue: 'var(--color-blue)',
  green: 'var(--color-green)',
  orange: 'var(--color-orange)',
  red: 'var(--color-red)',
  purple: 'var(--color-purple)',
  cyan: 'var(--color-cyan)',
  yellow: 'var(--color-yellow)'
}

export const PHASES: FieldOption[] = [
  { value: 'mvp', label: 'Initial (MVP)', color: STATUS_COLORS.green },
  { value: 'next', label: 'Next', color: STATUS_COLORS.blue },
  { value: 'later', label: 'Later', color: STATUS_COLORS.purple },
  { value: 'someday', label: 'Someday', color: STATUS_COLORS.gray }
]

export const PRIORITIES: FieldOption[] = [
  { value: 'must', label: 'Must', color: STATUS_COLORS.red },
  { value: 'should', label: 'Should', color: STATUS_COLORS.orange },
  { value: 'could', label: 'Could', color: STATUS_COLORS.blue },
  { value: 'wont', label: "Won't", color: STATUS_COLORS.gray }
]

/** effort in t-shirt sizes; points used for budget math */
export const EFFORTS: (FieldOption & { points: number })[] = [
  { value: 'xs', label: 'XS', points: 1 },
  { value: 's', label: 'S', points: 2 },
  { value: 'm', label: 'M', points: 3 },
  { value: 'l', label: 'L', points: 5 },
  { value: 'xl', label: 'XL', points: 8 }
]

export const FEATURE_STATUS: FieldOption[] = [
  { value: 'idea', label: 'Idea', color: STATUS_COLORS.gray },
  { value: 'planned', label: 'Planned', color: STATUS_COLORS.blue },
  { value: 'building', label: 'Building', color: STATUS_COLORS.orange },
  { value: 'done', label: 'Done', color: STATUS_COLORS.green },
  { value: 'cut', label: 'Cut', color: STATUS_COLORS.red }
]

export const KINDS: Record<FormKind, KindDef> = {
  idea: {
    kind: 'idea',
    label: 'Idea',
    plural: 'Ideas',
    emoji: '💡',
    color: 'var(--color-yellow)',
    hint: 'A raw thought. Capture first, triage later.',
    defaultSize: { width: 240, height: 140 },
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        onCard: true,
        options: [
          { value: 'raw', label: 'Raw', color: STATUS_COLORS.gray },
          { value: 'refined', label: 'Refined', color: STATUS_COLORS.blue },
          { value: 'merged', label: 'Merged', color: STATUS_COLORS.green },
          { value: 'dropped', label: 'Dropped', color: STATUS_COLORS.red }
        ]
      },
      { key: 'source', label: 'Source', type: 'text', placeholder: 'Where did this come from?' }
    ]
  },
  principle: {
    kind: 'principle',
    label: 'Principle',
    plural: 'Principles',
    emoji: '🧭',
    color: 'var(--color-purple)',
    hint: 'A belief that drives decisions (philosophy).',
    defaultSize: { width: 280, height: 150 },
    fields: [
      { key: 'why', label: 'Why we believe it', type: 'longtext' },
      { key: 'strength', label: 'Conviction', type: 'rating', max: 5, onCard: true }
    ]
  },
  goal: {
    kind: 'goal',
    label: 'Goal',
    plural: 'Goals',
    emoji: '🎯',
    color: 'var(--color-red)',
    hint: 'An outcome we want. Features should serve goals.',
    defaultSize: { width: 280, height: 150 },
    fields: [
      { key: 'metric', label: 'Success metric', type: 'text', onCard: true, placeholder: 'How will we know?' },
      {
        key: 'horizon',
        label: 'Horizon',
        type: 'select',
        onCard: true,
        options: [
          { value: 'final', label: 'Final goal', color: STATUS_COLORS.red },
          { value: 'milestone', label: 'Milestone', color: STATUS_COLORS.orange }
        ]
      }
    ]
  },
  approach: {
    kind: 'approach',
    label: 'Approach',
    plural: 'Approaches',
    emoji: '🛠️',
    color: 'var(--color-cyan)',
    hint: 'An engineering decision with its rationale (ADR-style).',
    defaultSize: { width: 300, height: 170 },
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        onCard: true,
        options: [
          { value: 'proposed', label: 'Proposed', color: STATUS_COLORS.orange },
          { value: 'accepted', label: 'Accepted', color: STATUS_COLORS.green },
          { value: 'superseded', label: 'Superseded', color: STATUS_COLORS.gray }
        ]
      },
      { key: 'rationale', label: 'Rationale', type: 'longtext' },
      { key: 'alternatives', label: 'Alternatives considered', type: 'longtext' }
    ]
  },
  feature: {
    kind: 'feature',
    label: 'Feature',
    plural: 'Features',
    emoji: '✨',
    color: 'var(--color-green)',
    hint: 'Something the product does. Give it a phase, priority and effort.',
    defaultSize: { width: 280, height: 180 },
    fields: [
      { key: 'phase', label: 'Phase', type: 'select', onCard: true, options: PHASES },
      { key: 'priority', label: 'Priority', type: 'select', onCard: true, options: PRIORITIES },
      { key: 'effort', label: 'Effort', type: 'select', onCard: true, options: EFFORTS },
      { key: 'status', label: 'Status', type: 'select', onCard: true, options: FEATURE_STATUS },
      { key: 'fun', label: 'Fun factor', type: 'rating', max: 5, onCard: true, help: 'How much joy does this bring to developers?' },
      { key: 'acceptance', label: 'Acceptance criteria', type: 'checklist' },
      { key: 'note', label: 'Linked note', type: 'link', placeholder: '[[Note]]' }
    ]
  },
  question: {
    kind: 'question',
    label: 'Question',
    plural: 'Questions',
    emoji: '❓',
    color: 'var(--color-orange)',
    hint: 'An open question or risk that blocks a decision.',
    defaultSize: { width: 260, height: 150 },
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        onCard: true,
        options: [
          { value: 'open', label: 'Open', color: STATUS_COLORS.orange },
          { value: 'decided', label: 'Decided', color: STATUS_COLORS.green },
          { value: 'parked', label: 'Parked', color: STATUS_COLORS.gray }
        ]
      },
      { key: 'options', label: 'Options', type: 'longtext' },
      { key: 'decision', label: 'Decision', type: 'longtext', onCard: true }
    ]
  },
  note: {
    kind: 'note',
    label: 'Note',
    plural: 'Notes',
    emoji: '📝',
    color: 'var(--text-muted)',
    hint: 'Free-form context.',
    defaultSize: { width: 260, height: 140 },
    fields: []
  }
}

export const KIND_ORDER: FormKind[] = ['idea', 'principle', 'goal', 'approach', 'feature', 'question', 'note']

// ---------------------------------------------------------------- nodes

export interface FormNode extends CanvasNode {
  type: 'form'
  kind: FormKind
  title: string
  /** markdown body */
  text?: string
  fields: Record<string, unknown>
  /** dot votes */
  votes?: number
}

export interface ZoneNode extends CanvasNode {
  type: 'zone'
  label: string
  /** emoji/icon for the zone header */
  emoji?: string
  /** short guidance shown in the empty zone / pitch mode */
  prompt?: string
  /** default kind for cards created inside this zone */
  defaultKind?: FormKind
  /** fields assigned to form cards dropped into this zone, e.g. { phase: 'later' } */
  assign?: Record<string, unknown>
  /** pitch-mode order (ascending); zones without order are skipped */
  order?: number
  locked?: boolean
}

export interface DrawingNode extends CanvasNode {
  type: 'drawing'
  /** points relative to x/y, flattened [x0,y0,x1,y1,...] */
  points: number[]
  stroke?: string
  strokeWidth?: number
}

export type Relation = 'serves' | 'because' | 'depends' | 'refines' | 'contradicts' | 'relates'

export interface RelationDef {
  relation: Relation
  label: string
  /** verb shown on the edge, from → to */
  verb: string
  color: string
  dashed?: boolean
  hint: string
}

export const RELATIONS: Record<Relation, RelationDef> = {
  serves: { relation: 'serves', label: 'Serves', verb: 'serves', color: 'var(--color-green)', hint: 'Feature/approach → goal it helps achieve' },
  because: { relation: 'because', label: 'Because', verb: 'because', color: 'var(--color-purple)', hint: 'Decision → principle that motivates it' },
  depends: { relation: 'depends', label: 'Depends on', verb: 'needs', color: 'var(--color-blue)', dashed: true, hint: 'Must be built after the target' },
  refines: { relation: 'refines', label: 'Refines', verb: 'refines', color: 'var(--color-yellow)', dashed: true, hint: 'Idea → the card it became' },
  contradicts: { relation: 'contradicts', label: 'Contradicts', verb: 'conflicts', color: 'var(--color-red)', dashed: true, hint: 'Tension that needs a decision' },
  relates: { relation: 'relates', label: 'Relates', verb: '', color: 'var(--text-faint)', hint: 'Loose association' }
}

export interface FormMapEdge extends CanvasEdge {
  relation?: Relation
}

export interface FormMapMeta {
  version: number
  title?: string
  template?: string
  /** MVP effort budget in points (see EFFORTS) */
  mvpBudget?: number
  /** markdown note that "Export" writes to */
  exportPath?: string
}

export interface FormMapData extends CanvasData {
  formmap?: FormMapMeta
}

export const isForm = (n: CanvasNode): n is FormNode => n.type === 'form'
export const isZone = (n: CanvasNode): n is ZoneNode => n.type === 'zone'
export const isDrawing = (n: CanvasNode): n is DrawingNode => n.type === 'drawing'

export function forms(d: CanvasData): FormNode[] {
  return d.nodes.filter(isForm)
}

export function zones(d: CanvasData): ZoneNode[] {
  return d.nodes.filter(isZone)
}

export function newForm(kind: FormKind, at: { x: number; y: number }, init: Partial<FormNode> = {}): FormNode {
  const def = KINDS[kind]
  return {
    id: hexId(),
    type: 'form',
    kind,
    title: '',
    text: '',
    fields: {},
    x: at.x,
    y: at.y,
    width: def.defaultSize.width,
    height: def.defaultSize.height,
    ...init
  }
}

/** Zone that contains the center of a card (smallest wins when zones nest). */
export function zoneAt(d: CanvasData, n: { x: number; y: number; width: number; height: number }): ZoneNode | null {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  let best: ZoneNode | null = null
  for (const z of zones(d)) {
    if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
      if (!best || z.width * z.height < best.width * best.height) best = z
    }
  }
  return best
}

/** Like `zoneAt`, against a precomputed zone list (use when looking up many cards: avoids re-filtering the nodes). */
export function zoneIn(zs: ZoneNode[], n: { x: number; y: number; width: number; height: number }): ZoneNode | null {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  let best: ZoneNode | null = null
  for (const z of zs) {
    if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
      if (!best || z.width * z.height < best.width * best.height) best = z
    }
  }
  return best
}

/** Applies the zone's `assign` fields to a form card (returns same object if nothing changes). */
export function applyZone(card: FormNode, zone: ZoneNode | null): FormNode {
  if (!zone?.assign) return card
  let changed = false
  const fields = { ...card.fields }
  for (const [k, v] of Object.entries(zone.assign)) {
    // only assign fields the card's kind actually has
    if (!KINDS[card.kind].fields.some((f) => f.key === k)) continue
    if (fields[k] !== v) {
      fields[k] = v
      changed = true
    }
  }
  return changed ? { ...card, fields } : card
}

export function effortPoints(v: unknown): number {
  return EFFORTS.find((e) => e.value === v)?.points ?? 0
}

export function optionOf(field: FieldDef | undefined, value: unknown): FieldOption | undefined {
  return field?.options?.find((o) => o.value === value)
}

export function fieldDef(kind: FormKind, key: string): FieldDef | undefined {
  return KINDS[kind].fields.find((f) => f.key === key)
}

/** Display title of a card (title, else first line of text, else kind label). */
export function cardTitle(n: FormNode): string {
  return n.title?.trim() || (n.text ?? '').split('\n')[0].replace(/^#+\s*/, '').trim() || `Untitled ${KINDS[n.kind].label.toLowerCase()}`
}

// ---------------------------------------------------------------- loading

const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Coerce hand-edited / foreign data into the shapes the lenses rely on (unknown kind → note, bad fields → {},
 * unknown relation → none…), so one odd card can't crash the view. Returns `d` itself when nothing changed.
 */
export function normalizeFormMap(d: CanvasData): CanvasData {
  let changed = false
  const nodes = d.nodes.map((n) => {
    let next: CanvasNode = n
    if (n.type === 'form') {
      next = {
        ...n,
        kind: has(KINDS, n.kind) ? n.kind : 'note',
        title: optStr(n.title) ?? '',
        text: optStr(n.text),
        fields: isRecord(n.fields) ? n.fields : {},
        votes: optNum(n.votes)
      }
    } else if (n.type === 'zone') {
      next = {
        ...n,
        label: optStr(n.label) ?? '',
        defaultKind: has(KINDS, n.defaultKind) ? n.defaultKind : undefined,
        assign: isRecord(n.assign) ? n.assign : undefined,
        order: optNum(n.order)
      }
    } else if (n.type === 'drawing') {
      const ok = (p: unknown): boolean => typeof p === 'number' && Number.isFinite(p)
      if (!Array.isArray(n.points) || !n.points.every(ok)) next = { ...n, points: Array.isArray(n.points) ? n.points.filter(ok) : [] }
    }
    if (next === n) return n
    // keep the original object when only `undefined`-valued keys differ
    const same = Object.keys(next).every((k) => next[k] === n[k] || (next[k] === undefined && !(k in n)))
    if (same) return n
    changed = true
    return next
  })
  const edges = d.edges.map((e) => {
    if (e.relation === undefined || has(RELATIONS, e.relation)) return e
    changed = true
    const { relation: _drop, ...rest } = e
    return rest as CanvasEdge
  })
  let formmap = d.formmap
  if (formmap !== undefined) {
    if (!isRecord(formmap)) formmap = { version: FORMMAP_VERSION }
    else if ((formmap.title !== undefined && typeof formmap.title !== 'string') || (formmap.mvpBudget !== undefined && optNum(formmap.mvpBudget) === undefined))
      formmap = { ...formmap, title: optStr(formmap.title), mvpBudget: optNum(formmap.mvpBudget) }
    if (formmap !== d.formmap) changed = true
  }
  return changed ? { ...d, nodes, edges, ...(formmap !== undefined ? { formmap } : {}) } : d
}
