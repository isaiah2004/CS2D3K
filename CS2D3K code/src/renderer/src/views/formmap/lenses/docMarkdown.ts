// Generates a markdown document from a form-map: groups in pitch order (then spatial order), each with its cards (title,
// tags, body, fields, relations) and nested groups; kanban nodes as task lists; cards outside groups last.
import type { CanvasData, CanvasNode } from '../../canvas/model'
import { relationsOf } from '../analysis'
import { byPosition } from '../boards'
import {
  cardTitle,
  fieldLabel,
  fieldText,
  groupChainIn,
  groups,
  groupTitle,
  isEmptyValue,
  isForm,
  isGroup,
  isKanban,
  metaOf,
  parentGroup,
  relationDef,
  type ChecklistItem,
  type FieldRegistry,
  type FormNode,
  type GroupNode,
  type KanbanNode
} from '../schema'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const oneLine = (s: string): string => s.replace(/\s*\n+\s*/g, ' ').trim()
const h = (level: number, text: string): string => `${'#'.repeat(Math.min(6, level))} ${text}`
const tagLine = (tags: string[] | undefined): string => (tags ?? []).map((t) => `#${t}`).join(' ')

/** pitch order first (groups with an order), then reading order */
const groupOrder = (a: GroupNode, b: GroupNode): number => (a.order ?? Infinity) - (b.order ?? Infinity) || byPosition(a, b)

function fieldLines(fields: Record<string, unknown>, reg: FieldRegistry): string[] {
  const out: string[] = []
  const keys = [...Object.keys(reg).filter((k) => k in fields), ...Object.keys(fields).filter((k) => !(k in reg))]
  for (const k of keys) {
    const v = fields[k]
    const def = reg[k]
    if (isEmptyValue(v) && v !== false) continue
    const label = fieldLabel(k, def)
    if (def?.type === 'checklist' && Array.isArray(v)) {
      out.push(`- **${label}:**`, ...(v as ChecklistItem[]).map((i) => `  - [${i?.done ? 'x' : ' '}] ${oneLine(str(i?.text))}`))
    } else if (def?.type === 'longtext') out.push(`- **${label}:** ${oneLine(String(v))}`)
    else out.push(`- **${label}:** ${fieldText(def, v) || String(v)}`)
  }
  return out
}

/** Markdown for the whole map. */
export function mapMarkdown(data: CanvasData, fallbackTitle: string): string {
  const meta = metaOf(data)
  const reg = meta.fields ?? {}
  const gs = groups(data)
  const titleOf = new Map<string, string>()
  for (const n of data.nodes) if (isForm(n)) titleOf.set(n.id, cardTitle(n))
  // innermost group of every node (groups: their parent)
  const parentOf = new Map<string, string | null>()
  for (const n of data.nodes) {
    if (n.type === 'drawing') continue
    parentOf.set(n.id, (isGroup(n) ? parentGroup(gs, n) : groupChainIn(gs, n).at(-1))?.id ?? null)
  }
  const childrenOf = (id: string | null): CanvasNode[] => data.nodes.filter((n) => parentOf.get(n.id) === id && n.type !== 'drawing')
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  const card = (f: FormNode, level: number): void => {
    push(h(level, cardTitle(f)), '')
    const tags = tagLine(f.tags)
    if (tags) push(tags, '')
    const body = f.title?.trim() ? str(f.text) : str(f.text).split('\n').slice(1).join('\n').trim()
    if (body) push(body, '')
    const lines = fieldLines(f.fields ?? {}, reg)
    if (f.votes) lines.push(`- **Votes:** ${f.votes}`)
    if (lines.length) push(...lines, '')
    const rels = relationsOf(data, f.id).filter((r) => r.dir === 'out' && titleOf.has(r.other))
    if (rels.length) {
      const by = new Map<string, string[]>()
      for (const r of rels) {
        const label = relationDef(r.relation).label
        by.set(label, [...(by.get(label) ?? []), titleOf.get(r.other)!])
      }
      push([...by].map(([label, names]) => `_${label}:_ ${names.join(', ')}`).join(' · '), '')
    }
  }

  const kanban = (k: KanbanNode, level: number): void => {
    push(h(level, `📋 ${k.title?.trim() || 'Kanban'}`), '')
    if (!k.columns.length) push('_No columns._', '')
    for (const c of k.columns) {
      push(`**${c.title || 'Column'}** (${c.cards.length})`, '')
      if (!c.cards.length) push('- _Empty_')
      for (const x of c.cards) {
        const tags = tagLine(x.tags)
        const fields = Object.entries(x.fields ?? {})
          .filter(([, v]) => !isEmptyValue(v))
          .map(([key, v]) => `${fieldLabel(key, reg[key])}: ${fieldText(reg[key], v) || String(v)}`)
        push(`- [${x.done ? 'x' : ' '}] ${cardTitle(x)}${x.text?.trim() && x.text.trim() !== x.title?.trim() ? ` — ${oneLine(x.text)}` : ''}${fields.length ? ` _(${fields.join(' · ')})_` : ''}${tags ? ` ${tags}` : ''}`)
      }
      push('')
    }
  }

  const items = (parent: string | null, level: number): void => {
    const kids = childrenOf(parent)
    const own = kids.filter((n) => isForm(n) || isKanban(n)).sort(byPosition)
    for (const n of own) {
      if (isForm(n)) card(n, level)
      else kanban(n as KanbanNode, level)
    }
    for (const g of kids.filter(isGroup).sort(groupOrder)) section(g, level)
  }

  const section = (g: GroupNode, level: number): void => {
    push(h(level, `${g.emoji ? `${g.emoji} ` : ''}${groupTitle(g)}`), '')
    if (g.prompt?.trim()) push(`> ${oneLine(g.prompt)}`, '')
    const before = out.length
    items(g.id, level + 1)
    if (out.length === before) push('_Nothing here yet._', '')
  }

  push(h(1, meta.title?.trim() || fallbackTitle), '')
  const top = childrenOf(null)
  const loose = top.filter((n) => isForm(n) || isKanban(n)).sort(byPosition)
  const topGroups = top.filter(isGroup).sort(groupOrder)
  if (!loose.length && !topGroups.length) push('_This map is empty._', '')
  for (const g of topGroups) section(g, 2)
  if (loose.length) {
    if (topGroups.length) push(h(2, 'Other cards'), '')
    for (const n of loose) {
      if (isForm(n)) card(n, topGroups.length ? 3 : 2)
      else kanban(n as KanbanNode, topGroups.length ? 3 : 2)
    }
  }
  push('---', '', '_Generated from a CS2D3K form-map._', '')
  return out.join('\n')
}
