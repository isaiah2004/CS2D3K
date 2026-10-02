// Form-map domain model (version 2).
//
// A .formmap file is a JSON Canvas superset (same as .canvas): a more advanced canvas. On top of the plain canvas nodes
// (text, file, link, code, group) it adds:
//   form    — a plain card: title, markdown text, free `tags` and typed `fields` (+ optional dot votes)
//   group   — the canvas group, with optional form-map powers: emoji, prompt, `assign` (fields given to cards dropped in),
//             a default `preset`, a pitch `order` and a `locked` toggle. Groups nest.
//   kanban  — a self-contained board node with its own columns and cards
//   drawing — a freehand annotation stroke
// Edges may carry a `relation` (any string; serves / because / depends / refines / contradicts / relates are presets).
// The top-level `formmap` object holds the map-wide registries: field types, tag colors, card presets, saved boards,
// declarative coach checks and relation rules. Unknown keys are preserved on save.
import type { CanvasData, CanvasEdge, CanvasNode, Rect } from '../canvas/model'
import { colorCss } from '../canvas/model'
import { hexId } from '@/lib/util'
import { LEGACY_KIND_TAGS, legacyFieldDef, PD_PRESETS, PD_RELATION_RULES, pdChecks } from './pack'

export const FORMMAP_VERSION = 2

// ---------------------------------------------------------------- colors

/** Named colors used by tags, options and fields (node colors keep the JSON Canvas "1".."6" / #hex values). */
export const FM_COLORS: { id: string; name: string; css: string }[] = [
  { id: 'red', name: 'Red', css: 'var(--color-red)' },
  { id: 'orange', name: 'Orange', css: 'var(--color-orange)' },
  { id: 'yellow', name: 'Yellow', css: 'var(--color-yellow)' },
  { id: 'green', name: 'Green', css: 'var(--color-green)' },
  { id: 'cyan', name: 'Cyan', css: 'var(--color-cyan)' },
  { id: 'blue', name: 'Blue', css: 'var(--color-blue)' },
  { id: 'purple', name: 'Purple', css: 'var(--color-purple)' },
  { id: 'pink', name: 'Pink', css: 'var(--color-pink)' },
  { id: 'gray', name: 'Gray', css: 'var(--text-faint)' }
]

/** CSS color of a form-map color value (named, canvas preset "1".."6" or #hex), or undefined. */
export function fmColor(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined
  return FM_COLORS.find((x) => x.id === c)?.css ?? colorCss(c)
}

const TAG_PALETTE = ['blue', 'green', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'red']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A stable default color for a tag without one. */
export const defaultTagColor = (tag: string): string => TAG_PALETTE[hash(tag) % TAG_PALETTE.length]

// ---------------------------------------------------------------- fields

export type FieldType = 'text' | 'longtext' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'rating' | 'checklist' | 'link'

export const FIELD_TYPES: { type: FieldType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: 'Aa' },
  { type: 'longtext', label: 'Long text', icon: '¶' },
  { type: 'number', label: 'Number', icon: '#' },
  { type: 'select', label: 'Select', icon: '◉' },
  { type: 'multiselect', label: 'Multi-select', icon: '☰' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'rating', label: 'Rating', icon: '★' },
  { type: 'checklist', label: 'Checklist', icon: '✓' },
  { type: 'link', label: 'Link', icon: '↗' }
]
const isFieldType = (t: unknown): t is FieldType => FIELD_TYPES.some((x) => x.type === t)

export interface FieldOption {
  value: string
  /** display label (default: the value) */
  label?: string
  /** form-map color (see fmColor) */
  color?: string
  /** weight for sums (e.g. effort points) */
  points?: number
  /** only offered to cards carrying one of these tags (all cards when unset) */
  for?: string[]
}

export interface FieldDef {
  type: FieldType
  /** display name (default: the registry key) */
  label?: string
  options?: FieldOption[]
  color?: string
  /** rating max (default 5) */
  max?: number
  /** not shown on the card face (inspector / table only) */
  hidden?: boolean
  placeholder?: string
  help?: string
}

/** field name → definition. Built automatically as fields are added; edited in the inspector (Map tab). */
export type FieldRegistry = Record<string, FieldDef>

/** A checklist item (checklist fields, e.g. acceptance criteria) */
export interface ChecklistItem {
  text: string
  done: boolean
}

export const fieldLabel = (key: string, def?: FieldDef): string => def?.label?.trim() || key
export const optionLabel = (o: FieldOption): string => o.label?.trim() || o.value

export function optionOf(def: FieldDef | undefined, value: unknown): FieldOption | undefined {
  return def?.options?.find((o) => o.value === value)
}

/** Options of a select field that apply to a card (an option's `for` tags), all of them when none match. */
export function optionsFor(def: FieldDef | undefined, tags?: string[]): FieldOption[] {
  const all = def?.options ?? []
  if (!tags?.length || !all.some((o) => o.for?.length)) return all
  const scoped = all.filter((o) => !o.for?.length || o.for.some((t) => tags.includes(t)))
  return scoped.length ? scoped : all
}

/** Field type of a raw value (for auto-registration of fields found on cards). */
export function inferFieldType(v: unknown): FieldType {
  if (typeof v === 'boolean') return 'checkbox'
  if (typeof v === 'number') return 'number'
  if (Array.isArray(v)) return v.every((x) => x && typeof x === 'object' && 'text' in x) ? 'checklist' : 'multiselect'
  if (typeof v === 'string') {
    if (/^\[\[.*\]\]$/.test(v.trim())) return 'link'
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
    return v.includes('\n') ? 'longtext' : 'text'
  }
  return 'text'
}

/** Is a field value empty (unset, '', [], false)? */
export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)
}

/** Plain text of a field value (search, sorting, markdown export). */
export function fieldText(def: FieldDef | undefined, v: unknown): string {
  if (isEmptyValue(v) && v !== false) return ''
  switch (def?.type) {
    case 'select':
      return optionOf(def, v) ? optionLabel(optionOf(def, v)!) : String(v)
    case 'multiselect':
      return Array.isArray(v) ? v.map((x) => (optionOf(def, x) ? optionLabel(optionOf(def, x)!) : String(x))).join(', ') : String(v)
    case 'checkbox':
      return v ? 'Yes' : 'No'
    case 'rating': {
      const n = Math.max(0, Math.min(def.max ?? 5, Math.round(Number(v) || 0)))
      return n ? '★'.repeat(n) : ''
    }
    case 'checklist':
      return Array.isArray(v) ? `${v.filter((i) => i?.done).length}/${v.length}` : ''
    default:
      return Array.isArray(v) ? v.join(', ') : String(v)
  }
}

/** Weight of a value for sums: option points, or the number itself. */
export function valuePoints(def: FieldDef | undefined, v: unknown): number {
  const o = optionOf(def, v)
  if (o) return o.points ?? 0
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// ---------------------------------------------------------------- tags, presets, rules, boards

export interface TagDef {
  color?: string
}

/** Quick-create template for cards (toolbar, double-click in a group, Tab children). */
export interface Preset {
  id: string
  name: string
  emoji?: string
  tags?: string[]
  fields?: Record<string, unknown>
  /** node color of new cards */
  color?: string
  size?: { width: number; height: number }
  /** preset of mind-map children (Tab) */
  child?: string
  hint?: string
}

/** Default relation for a new edge between cards carrying these tags (first match wins; default "relates"). */
export interface RelationRule {
  from?: string
  to?: string
  relation: string
}

/** Which cards a rule / board / filter applies to. A field value matches by equality, an array means "any of", null means "empty". */
export interface CardFilter {
  tags?: string[]
  notTags?: string[]
  fields?: Record<string, unknown>
  notFields?: Record<string, unknown>
}

export type CheckLevel = 'warn' | 'info' | 'good'

interface RuleBase {
  id: string
  /** cards the rule is about */
  match: CardFilter
  level?: 'warn' | 'info'
  /** title when cards are flagged; supports {n}, {titles} and {n|one|many} */
  title: string
  detail?: string
  /** title when nothing is flagged (omitted = no "good" line) */
  good?: string
}

/**
 * Declarative coach checks (templates add their own):
 *  relation — flags matching cards without a `relation` edge to (out) / from (in) a card matching `target`
 *  field    — flags matching cards where `field` is empty
 *  count    — flags matching cards (e.g. open questions); `warnAbove` raises the level
 *  sum      — adds up `field` (option points or numbers) over matching cards against a budget `max`
 */
export type CheckRule =
  | (RuleBase & { type: 'relation'; relation: string; target?: CardFilter; dir?: 'out' | 'in' })
  | (RuleBase & { type: 'field'; field: string })
  | (RuleBase & { type: 'count'; warnAbove?: number })
  | (Omit<RuleBase, 'title'> & { type: 'sum'; field: string; max?: number; label: string; unit?: string; title?: string })

export type BoardSource = { mode: 'groups'; groupIds: string[] } | { mode: 'field'; field: string; groupId?: string; values?: string[] }

/** A saved kanban view over the map's cards (Board lens). */
export interface Board {
  id: string
  name: string
  source: BoardSource
  /** card order per column key */
  order?: Record<string, string[]>
  /** only cards matching this filter */
  filter?: CardFilter
  /** WIP limit per column key */
  wip?: Record<string, number>
}

export interface FormMapMeta {
  version: number
  title?: string
  template?: string
  /** markdown note that "Export" writes to */
  exportPath?: string
  fields?: FieldRegistry
  tags?: Record<string, TagDef>
  presets?: Preset[]
  boards?: Board[]
  checks?: CheckRule[]
  relationRules?: RelationRule[]
  /** board whose last column the HUD shows progress for */
  hudBoard?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------- nodes

export interface FormNode extends CanvasNode {
  type: 'form'
  title: string
  /** markdown body */
  text?: string
  tags?: string[]
  fields: Record<string, unknown>
  /** dot votes */
  votes?: number
}

export interface GroupNode extends CanvasNode {
  type: 'group'
  label?: string
  emoji?: string
  /** short guidance shown in the empty group and in pitch mode */
  prompt?: string
  /** fields given to cards dropped into this group (nested groups apply outermost first) */
  assign?: Record<string, unknown>
  /** preset of cards created inside the group */
  preset?: string
  /** pitch-mode order (ascending); groups without an order are skipped */
  order?: number
  /** locked groups can't be dragged or resized */
  locked?: boolean
}

export interface KanbanCard {
  id: string
  title: string
  text?: string
  tags?: string[]
  fields?: Record<string, unknown>
  done?: boolean
  votes?: number
  color?: string
}

export interface KanbanColumn {
  id: string
  title: string
  color?: string
  collapsed?: boolean
  cards: KanbanCard[]
}

/** A self-contained kanban board on the canvas. */
export interface KanbanNode extends CanvasNode {
  type: 'kanban'
  title: string
  columns: KanbanColumn[]
}

export interface DrawingNode extends CanvasNode {
  type: 'drawing'
  /** points relative to x/y, flattened [x0,y0,x1,y1,...] */
  points: number[]
  stroke?: string
  strokeWidth?: number
}

export type Relation = string

export interface RelationDef {
  relation: string
  label: string
  /** verb shown on the edge, from → to */
  verb: string
  /** inverse label (Relations panel: "Served by") */
  inverse: string
  color: string
  dashed?: boolean
  hint: string
}

/** Relation presets (users can also type any custom relation). */
export const RELATIONS: Record<string, RelationDef> = {
  serves: { relation: 'serves', label: 'Serves', verb: 'serves', inverse: 'Served by', color: 'var(--color-green)', hint: 'Helps achieve the target' },
  because: { relation: 'because', label: 'Because', verb: 'because', inverse: 'Reason for', color: 'var(--color-purple)', hint: 'Motivated by the target' },
  depends: { relation: 'depends', label: 'Depends on', verb: 'needs', inverse: 'Needed by', color: 'var(--color-blue)', dashed: true, hint: 'Must happen after the target' },
  refines: { relation: 'refines', label: 'Refines', verb: 'refines', inverse: 'Refined by', color: 'var(--color-yellow)', dashed: true, hint: 'A sharper version of the target' },
  contradicts: { relation: 'contradicts', label: 'Contradicts', verb: 'conflicts', inverse: 'Contradicted by', color: 'var(--color-red)', dashed: true, hint: 'Tension that needs a decision' },
  relates: { relation: 'relates', label: 'Relates', verb: '', inverse: 'Related from', color: 'var(--text-faint)', hint: 'Loose association' }
}
export const RELATION_ORDER = Object.keys(RELATIONS)

/** Definition of any relation (custom relations get a neutral style and their own name as verb). */
export function relationDef(r: string | undefined): RelationDef {
  const k = r?.trim() || 'relates'
  return RELATIONS[k] ?? { relation: k, label: k.charAt(0).toUpperCase() + k.slice(1), verb: k, inverse: `${k} (from)`, color: 'var(--text-muted)', hint: 'Custom relation' }
}

export interface FormMapEdge extends CanvasEdge {
  relation?: Relation
}

export interface FormMapData extends CanvasData {
  formmap?: FormMapMeta
}

export const isForm = (n: CanvasNode): n is FormNode => n.type === 'form'
export const isGroup = (n: CanvasNode): n is GroupNode => n.type === 'group'
export const isKanban = (n: CanvasNode): n is KanbanNode => n.type === 'kanban'
export const isDrawing = (n: CanvasNode): n is DrawingNode => n.type === 'drawing'

export const forms = (d: CanvasData): FormNode[] => d.nodes.filter(isForm)
export const groups = (d: CanvasData): GroupNode[] => d.nodes.filter(isGroup)
export const kanbans = (d: CanvasData): KanbanNode[] => d.nodes.filter(isKanban)

const EMPTY_META: FormMapMeta = { version: FORMMAP_VERSION }
export const metaOf = (d: CanvasData): FormMapMeta => (d as FormMapData).formmap ?? EMPTY_META
export const registryOf = (d: CanvasData): FieldRegistry => metaOf(d).fields ?? {}

export function tagColor(meta: FormMapMeta, tag: string): string {
  return fmColor(meta.tags?.[tag]?.color) ?? fmColor(defaultTagColor(tag))!
}

/** Card accent: its node color, else its first tag's color (undefined = neutral). */
export function cardAccent(n: { color?: unknown; tags?: string[] }, meta: FormMapMeta): string | undefined {
  return colorCss(n.color) ?? (n.tags?.length ? tagColor(meta, n.tags[0]) : undefined)
}

/** Display title of a card (title, else first line of text). */
export function cardTitle(n: { title?: string; text?: string }): string {
  return n.title?.trim() || (n.text ?? '').split('\n')[0].replace(/^#+\s*/, '').trim() || 'Untitled card'
}

export const groupTitle = (g: GroupNode): string => g.label?.trim() || 'Group'

export const CARD_SIZE = { width: 260, height: 150 }

export function newForm(at: { x: number; y: number }, init: Partial<FormNode> = {}): FormNode {
  return { id: hexId(), type: 'form', title: '', text: '', tags: [], fields: {}, x: at.x, y: at.y, ...CARD_SIZE, ...init }
}

export function presetById(meta: FormMapMeta, id: string | undefined): Preset | undefined {
  return id ? meta.presets?.find((p) => p.id === id) : undefined
}

/** The preset a card looks like (all of a preset's tags on the card), for mind-map children. */
export function presetOf(card: { tags?: string[] }, presets: Preset[] | undefined): Preset | undefined {
  const tags = card.tags ?? []
  return presets?.find((p) => !!p.tags?.length && p.tags.every((t) => tags.includes(t)))
}

/** Card fields + tags from a preset (copies; the preset's fields are only defaults). */
export function fromPreset(p: Preset | undefined): Pick<FormNode, 'tags' | 'fields'> & Partial<Pick<FormNode, 'width' | 'height' | 'color'>> {
  if (!p) return { tags: [], fields: {} }
  return { tags: [...(p.tags ?? [])], fields: structuredClone(p.fields ?? {}), ...(p.size ?? {}), ...(p.color ? { color: p.color } : {}) }
}

/** Relation for a new edge between two cards (relation rules on tags), default "relates". */
export function inferRelation(meta: FormMapMeta, from?: { tags?: string[] }, to?: { tags?: string[] }): Relation {
  const a = from?.tags ?? []
  const b = to?.tags ?? []
  for (const r of meta.relationRules ?? []) if ((!r.from || a.includes(r.from)) && (!r.to || b.includes(r.to))) return r.relation
  return 'relates'
}

// ---------------------------------------------------------------- groups (geometry)

const centerIn = (z: Rect, n: Rect): boolean => {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  return cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height
}
const area = (r: Rect): number => r.width * r.height

/** Groups containing the center of a rect, outermost first (largest area first; document order breaks ties). */
export function groupChainIn(gs: GroupNode[], n: Rect, exclude?: string): GroupNode[] {
  const out: GroupNode[] = []
  for (const g of gs) if (g.id !== exclude && centerIn(g, n)) out.push(g)
  return out.length > 1 ? out.map((g, i) => ({ g, i })).sort((a, b) => area(b.g) - area(a.g) || b.i - a.i).map((x) => x.g) : out
}

/** Smallest group containing the center of a rect (the first in document order on ties). */
export function groupIn(gs: GroupNode[], n: Rect, exclude?: string): GroupNode | null {
  let best: GroupNode | null = null
  for (const g of gs) if (g.id !== exclude && centerIn(g, n) && (!best || area(g) < area(best))) best = g
  return best
}

export const groupAt = (d: CanvasData, n: Rect, exclude?: string): GroupNode | null => groupIn(groups(d), n, exclude)

/** The group a group is nested in: the smallest larger group containing its center (larger = no cycles). */
export function parentGroup(gs: GroupNode[], g: Rect & { id: string }): GroupNode | null {
  let best: GroupNode | null = null
  for (const p of gs) if (p.id !== g.id && area(p) > area(g) && centerIn(p, g) && (!best || area(p) < area(best))) best = p
  return best
}

/** Is `g` nested (at any depth) inside `ancestor`? */
export function isInside(gs: GroupNode[], g: GroupNode, ancestor: string): boolean {
  for (let p = parentGroup(gs, g); p; p = parentGroup(gs, p)) if (p.id === ancestor) return true
  return false
}
export const groupChain = (d: CanvasData, n: Rect, exclude?: string): GroupNode[] => groupChainIn(groups(d), n, exclude)

/** The fields a chain of groups assigns (outermost first, inner groups win). */
export function assignOf(chain: GroupNode[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const g of chain) if (g.assign) Object.assign(out, g.assign)
  return out
}

/** Applies a chain of groups' `assign` to a card (returns the same object if nothing changes). */
export function applyAssign(card: FormNode, chain: GroupNode[]): FormNode {
  const assign = assignOf(chain)
  let fields: Record<string, unknown> | null = null
  for (const [k, v] of Object.entries(assign)) {
    if (sameValue(card.fields?.[k], v)) continue
    fields ??= { ...card.fields }
    if (isEmptyValue(v)) delete fields[k]
    else fields[k] = structuredClone(v)
  }
  return fields ? { ...card, fields } : card
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isEmptyValue(a) && isEmptyValue(b)) return true
  if (typeof a === 'object' && typeof b === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b)
  return false
}

// ---------------------------------------------------------------- filters + done-ness

function valueMatches(v: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return want.some((w) => valueMatches(v, w))
  if (want === null) return isEmptyValue(v)
  if (Array.isArray(v)) return v.includes(want)
  return v === want
}

export function matchesFilter(card: { tags?: string[]; fields?: Record<string, unknown> }, f: CardFilter | undefined): boolean {
  if (!f) return true
  const tags = card.tags ?? []
  const fields = card.fields ?? {}
  if (f.tags?.length && !f.tags.every((t) => tags.includes(t))) return false
  if (f.notTags?.some((t) => tags.includes(t))) return false
  for (const [k, want] of Object.entries(f.fields ?? {})) if (!valueMatches(fields[k], want)) return false
  for (const [k, want] of Object.entries(f.notFields ?? {})) if (valueMatches(fields[k], want)) return false
  return true
}

export const DONE_WORDS = /^(done|complete|completed|finished|shipped|closed|decided|accepted|merged)$/i
const SETTLED_WORDS = /^(cut|superseded|parked|dropped|wont|won't|rejected|cancelled|canceled)$/i
const DONE_FIELD = /^(done|complete|completed)$/i

/** A checkbox field named done / complete. */
export const isDoneField = (key: string, def?: FieldDef): boolean => (!def || def.type === 'checkbox') && (DONE_FIELD.test(key) || DONE_FIELD.test(def?.label ?? ''))

/** 'win' = done (a done checkbox, or a select value like done / decided / accepted), 'muted' = cut / parked / dropped… */
export function cardState(card: { fields?: Record<string, unknown> }, reg: FieldRegistry): 'win' | 'muted' | null {
  let muted = false
  for (const [k, v] of Object.entries(card.fields ?? {})) {
    const def = reg[k]
    if (v === true && isDoneField(k, def)) return 'win'
    if (typeof v !== 'string' || (def && def.type !== 'select')) continue
    if (DONE_WORDS.test(v)) return 'win'
    if (SETTLED_WORDS.test(v)) muted = true
  }
  return muted ? 'muted' : null
}

// ---------------------------------------------------------------- loading + migration

const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** A tag as stored: trimmed, without a leading '#'. */
export const cleanTag = (t: unknown): string => (typeof t === 'string' ? t.trim().replace(/^#+/, '').trim() : '')

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return typeof v === 'string' && cleanTag(v) ? [cleanTag(v)] : []
  const out: string[] = []
  for (const t of v) {
    const c = cleanTag(t)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/** Registry entry for a field found on cards without one (old schema first, else inferred from the value). */
function registryEntry(key: string, value: unknown, legacy: boolean): FieldDef {
  if (legacy) {
    const old = legacyFieldDef(key)
    if (old) return structuredClone(old)
  }
  return { type: inferFieldType(value) }
}

function cleanFieldDef(v: unknown): FieldDef | null {
  if (!isRecord(v)) return null
  const type = isFieldType(v.type) ? v.type : 'text'
  const def: FieldDef = { ...(v as object), type } as FieldDef
  if (v.options !== undefined) {
    def.options = Array.isArray(v.options)
      ? v.options.filter((o): o is FieldOption => isRecord(o) && typeof o.value === 'string')
      : undefined
    if (!def.options) delete def.options
  }
  if (def.max !== undefined && optNum(def.max) === undefined) delete def.max
  return def
}

function cleanKanbanCard(c: unknown, ids: Set<string>): KanbanCard | null {
  if (!isRecord(c)) return null
  let id = typeof c.id === 'string' && c.id ? c.id : hexId()
  while (ids.has(id)) id = hexId()
  ids.add(id)
  const card: KanbanCard = { ...(c as object), id, title: optStr(c.title) ?? '' } as KanbanCard
  if (c.tags !== undefined) card.tags = cleanTags(c.tags)
  if (c.fields !== undefined && !isRecord(c.fields)) delete card.fields
  if (c.done !== undefined && typeof c.done !== 'boolean') card.done = !!c.done
  if (c.text !== undefined && typeof c.text !== 'string') delete card.text
  return card
}

function cleanKanban(n: CanvasNode): CanvasNode {
  const ids = new Set<string>()
  const cols = Array.isArray(n.columns) ? n.columns : []
  const columns: KanbanColumn[] = cols.filter(isRecord).map((c) => {
    let id = typeof c.id === 'string' && c.id ? c.id : hexId()
    while (ids.has(id)) id = hexId()
    ids.add(id)
    return {
      ...(c as object),
      id,
      title: optStr(c.title) ?? '',
      cards: (Array.isArray(c.cards) ? c.cards : []).map((x) => cleanKanbanCard(x, ids)).filter((x): x is KanbanCard => !!x)
    } as KanbanColumn
  })
  return { ...n, title: optStr(n.title) ?? '', columns }
}

/** Only rebuild what changed: keep `prev` when the cleaned object is equal (stable identity = no re-render / save). */
function same(prev: unknown, next: unknown): boolean {
  return prev === next || JSON.stringify(prev) === JSON.stringify(next)
}

/**
 * Loads any form-map into the current shape, in memory (the file is rewritten only when the user edits):
 *  - migrates version 1 maps: a card's `kind` becomes its first tag, zones become groups (`defaultKind` → `preset`),
 *    old field values are kept and registered with their old types, the product-definition presets, relation rules and
 *    coach checks are added, `mvpBudget` becomes the budget check's limit;
 *  - coerces hand-edited / foreign data into the shapes the lenses rely on (bad fields → {}, bad tags dropped…) so one odd
 *    card can't crash the view;
 *  - registers fields and tags used by cards but missing from the registries.
 * Returns `d` itself when nothing changed.
 */
export function normalizeFormMap(d: CanvasData): CanvasData {
  const rawMeta = (d as FormMapData).formmap as unknown
  const metaIn: Record<string, unknown> | undefined = rawMeta === undefined ? undefined : isRecord(rawMeta) ? rawMeta : {}
  // a version 1 map (or one still holding v1 shapes)
  const legacy =
    (metaIn !== undefined && (optNum(metaIn.version) ?? 1) < FORMMAP_VERSION) ||
    d.nodes.some((n) => n.type === 'zone' || (n.type === 'form' && n.kind !== undefined))
  let changed = rawMeta !== undefined && !isRecord(rawMeta)
  const usedKinds = new Set<string>()
  const usedFields = new Map<string, unknown>()
  const usedTags = new Set<string>()

  const nodes = d.nodes.map((n) => {
    let next: CanvasNode = n
    if (n.type === 'form') {
      const tags = cleanTags(n.tags)
      const kind = cleanTag(n.kind)
      if (kind) {
        usedKinds.add(kind)
        if (!tags.includes(kind)) tags.unshift(kind)
      }
      const fields = isRecord(n.fields) ? n.fields : {}
      const { kind: _kind, ...rest } = n
      next = { ...rest, title: optStr(n.title) ?? '', text: optStr(n.text), tags: tags.length || n.tags !== undefined ? tags : undefined, fields, votes: optNum(n.votes) }
      for (const t of tags) usedTags.add(t)
      for (const [k, v] of Object.entries(fields)) if (!usedFields.has(k) || isEmptyValue(usedFields.get(k))) usedFields.set(k, v)
    } else if (n.type === 'zone' || n.type === 'group') {
      const g: Record<string, unknown> = { ...n, type: 'group' }
      if (n.type === 'zone') {
        // zones were locked unless explicitly unlocked; groups are unlocked unless locked
        delete g.defaultKind
        g.locked = n.locked !== false
        if (typeof n.defaultKind === 'string' && n.defaultKind && g.preset === undefined) {
          g.preset = n.defaultKind
          usedKinds.add(n.defaultKind)
        }
      }
      if (g.label !== undefined && typeof g.label !== 'string') g.label = ''
      if (g.assign !== undefined && !isRecord(g.assign)) delete g.assign
      if (g.order !== undefined && optNum(g.order) === undefined) delete g.order
      if (g.locked !== undefined && typeof g.locked !== 'boolean') g.locked = !!g.locked
      if (g.preset !== undefined && typeof g.preset !== 'string') delete g.preset
      if (isRecord(g.assign)) for (const [k, v] of Object.entries(g.assign)) if (!usedFields.has(k)) usedFields.set(k, v)
      next = g as CanvasNode
    } else if (n.type === 'kanban') {
      next = cleanKanban(n)
      for (const c of (next as KanbanNode).columns) for (const k of c.cards) for (const t of k.tags ?? []) usedTags.add(t)
    } else if (n.type === 'drawing') {
      const ok = (p: unknown): boolean => typeof p === 'number' && Number.isFinite(p)
      if (!Array.isArray(n.points) || !n.points.every(ok)) next = { ...n, points: Array.isArray(n.points) ? n.points.filter(ok) : [] }
    }
    if (next === n) return n
    // keep the original object when only `undefined`-valued keys differ (and arrays / records are equal)
    const keys = new Set([...Object.keys(n), ...Object.keys(next)])
    const unchanged = [...keys].every((k) => (next[k] === undefined && !(k in n)) || same(n[k], next[k]))
    if (unchanged) return n
    changed = true
    return next
  })

  const edges = d.edges.map((e) => {
    if (e.relation === undefined || (typeof e.relation === 'string' && e.relation.trim())) return e
    changed = true
    const { relation: _drop, ...rest } = e
    return rest as CanvasEdge
  })

  let formmap = metaIn as FormMapMeta | undefined
  if (formmap !== undefined || legacy || usedTags.size || usedFields.size) {
    const m: FormMapMeta = { ...(formmap ?? {}), version: FORMMAP_VERSION } as FormMapMeta
    if (m.title !== undefined && typeof m.title !== 'string') delete m.title
    // registries
    const fields: FieldRegistry = {}
    if (isRecord(m.fields)) for (const [k, v] of Object.entries(m.fields)) {
      const def = cleanFieldDef(v)
      if (def) fields[k] = def
    }
    for (const [k, v] of usedFields) if (!has(fields, k)) fields[k] = registryEntry(k, v, legacy)
    const tags: Record<string, TagDef> = isRecord(m.tags) ? Object.fromEntries(Object.entries(m.tags).filter(([, v]) => isRecord(v))) as Record<string, TagDef> : {}
    for (const t of usedTags) if (!has(tags, t)) tags[t] = legacy && LEGACY_KIND_TAGS[t] ? { ...LEGACY_KIND_TAGS[t] } : { color: defaultTagColor(t) }
    m.fields = fields
    m.tags = tags
    for (const k of ['presets', 'boards', 'checks', 'relationRules'] as const)
      if (m[k] !== undefined && !Array.isArray(m[k])) delete m[k]
      else if (Array.isArray(m[k])) (m as Record<string, unknown>)[k] = (m[k] as unknown[]).filter(isRecord)
    // the product-definition behaviour of v1 maps (kind presets, relation inference, coach checks) as data
    if (legacy && usedKinds.size) {
      m.presets ??= structuredClone(PD_PRESETS)
      m.relationRules ??= structuredClone(PD_RELATION_RULES)
      m.checks ??= pdChecks(optNum(m.mvpBudget))
    }
    if (legacy) delete m.mvpBudget
    if (!Object.keys(m.fields!).length && !(isRecord(metaIn) && isRecord(metaIn.fields))) delete m.fields
    if (!Object.keys(m.tags!).length && !(isRecord(metaIn) && isRecord(metaIn.tags))) delete m.tags
    if (!same(formmap, m)) {
      formmap = m
      changed = true
    }
  }
  return changed ? { ...d, nodes, edges, ...(formmap !== undefined ? { formmap } : {}) } : d
}
