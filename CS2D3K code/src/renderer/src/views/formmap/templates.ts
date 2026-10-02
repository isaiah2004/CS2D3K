// Starting layouts for new form-maps. They only differ in data: groups, presets, fields, tags, boards and checks —
// nothing is built into the app. Product Definition is one example of what a map can capture.
import { hexId } from '@/lib/util'
import { FORMMAP_VERSION, type Board, type FormMapData, type FormNode, type GroupNode } from './schema'
import { PD_FIELDS, PD_PRESETS, PD_RELATION_RULES, PD_TAGS, pdChecks } from './pack'

export interface FormMapTemplate {
  id: string
  name: string
  emoji: string
  description: string
  build(): FormMapData
}

interface GroupSpec {
  label: string
  emoji: string
  prompt: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  preset?: string
  assign?: Record<string, unknown>
  order?: number
  locked?: boolean
}

function group(z: GroupSpec): GroupNode {
  return { id: hexId(), type: 'group', locked: true, ...z }
}

const W = 760
const GAP = 80

/** The product-definition layout: core idea → philosophy → approach → goal → MVP / later features, questions, inbox. */
export function productDefinitionGroups(): GroupNode[] {
  const col = (i: number): number => i * (W + GAP)
  return [
    group({
      label: 'Core idea',
      emoji: '🌱',
      prompt: 'One or two sentences: what is this product and why must it exist?',
      x: 0, y: 0, width: 3 * W + 2 * GAP, height: 340, color: '3', preset: 'note', order: 1
    }),
    group({
      label: 'Philosophy',
      emoji: '🧭',
      prompt: 'The beliefs that drive every decision. If a feature fights a principle, the principle wins.',
      x: col(0), y: 420, width: W, height: 620, color: '6', preset: 'principle', order: 2
    }),
    group({
      label: 'Engineering approach',
      emoji: '🛠️',
      prompt: 'How we build it: stack, process and the key technical decisions — each with a rationale.',
      x: col(1), y: 420, width: W, height: 620, color: '5', preset: 'approach', order: 3
    }),
    group({
      label: 'Final goal',
      emoji: '🎯',
      prompt: 'What does success look like? Make it measurable.',
      x: col(2), y: 420, width: W, height: 620, color: '1', preset: 'goal', assign: { horizon: 'final' }, order: 4
    }),
    group({
      label: 'Initial features (MVP)',
      emoji: '🚀',
      prompt: 'The smallest set of features that proves the core idea. Every one should serve a goal.',
      x: col(0), y: 1120, width: W, height: 720, color: '4', preset: 'feature', assign: { phase: 'mvp' }, order: 5
    }),
    group({
      label: 'Later features',
      emoji: '🔭',
      prompt: 'Good ideas that are not needed to prove the core idea. Park them here guilt-free.',
      x: col(1), y: 1120, width: W, height: 720, color: '5', preset: 'feature', assign: { phase: 'later' }, order: 6
    }),
    group({
      label: 'Open questions',
      emoji: '❓',
      prompt: 'Unknowns and risks. Decide them, or explicitly park them.',
      x: col(2), y: 1120, width: W, height: 720, color: '2', preset: 'question', order: 7
    }),
    group({
      label: 'Idea inbox',
      emoji: '📥',
      prompt: 'Dump raw ideas here. Drag them into a group when they are ready.',
      x: -(W / 2 + GAP + 40), y: 420, width: W / 2 + 40, height: 1420, color: '3', preset: 'idea'
    })
  ]
}

/** The product-definition registries (fields, tags, presets, relation rules, checks) + two example boards. */
export function productDefinitionMeta(gs: GroupNode[], mvpBudget = 40): FormMapData['formmap'] {
  const id = (label: string): string => gs.find((g) => g.label === label)!.id
  const boards: Board[] = [
    { id: hexId(), name: 'Roadmap', source: { mode: 'groups', groupIds: [id('Idea inbox'), id('Later features'), id('Initial features (MVP)')] } },
    { id: hexId(), name: 'Features by status', source: { mode: 'field', field: 'status', values: ['idea', 'planned', 'building', 'done'] }, filter: { tags: ['feature'] } }
  ]
  return {
    hudBoard: boards[1].id,
    version: FORMMAP_VERSION,
    template: 'product-definition',
    fields: structuredClone(PD_FIELDS),
    tags: structuredClone(PD_TAGS),
    presets: structuredClone(PD_PRESETS),
    relationRules: structuredClone(PD_RELATION_RULES),
    checks: pdChecks(mvpBudget),
    boards
  }
}

function kanbanTemplate(): FormMapData {
  const cols = [
    { label: 'To do', emoji: '📝', color: '2', prompt: 'Everything that still needs doing.' },
    { label: 'Doing', emoji: '⚡', color: '5', prompt: 'Keep this short: finish before you start.' },
    { label: 'Done', emoji: '✅', color: '4', prompt: 'Shipped! Drop a card here to celebrate.' }
  ]
  const gw = 340
  const gap = 40
  const parent = group({ label: 'Board', emoji: '📋', prompt: 'Your board: each group is a column.', x: -40, y: -60, width: cols.length * (gw + gap) - gap + 80, height: 760, locked: false })
  const gs = cols.map((c, i) => group({ ...c, x: i * (gw + gap), y: 0, width: gw, height: 660, locked: false }))
  const card = (title: string, text: string, g: GroupNode, i: number, tags: string[] = []): FormNode => ({
    id: hexId(),
    type: 'form',
    title,
    text,
    tags,
    fields: {},
    x: g.x + 24,
    y: g.y + 40 + i * 130,
    width: gw - 48,
    height: 110
  })
  const nodes = [
    parent,
    ...gs,
    card('Drag me to “Doing”', 'Moving a card between groups moves it on the Board lens too.', gs[0], 0, ['tip']),
    card('Open the Board lens', 'Alt+2 — the same cards as a kanban, live.', gs[0], 1, ['tip']),
    card('Add a card', 'Double-click inside a group, or use the toolbar.', gs[1], 0, ['tip'])
  ]
  const board: Board = { id: hexId(), name: 'Board', source: { mode: 'groups', groupIds: gs.map((g) => g.id) } }
  return {
    formmap: {
      version: FORMMAP_VERSION,
      template: 'kanban',
      tags: { task: { color: 'green' }, bug: { color: 'red' }, tip: { color: 'blue' } },
      fields: { Owner: { type: 'text' }, Due: { type: 'date' }, Priority: { type: 'select', options: [{ value: 'High', color: 'red' }, { value: 'Medium', color: 'orange' }, { value: 'Low', color: 'gray' }] } },
      presets: [
        { id: 'task', name: 'Task', emoji: '✅', tags: ['task'], fields: {} },
        { id: 'bug', name: 'Bug', emoji: '🐞', tags: ['bug'], fields: { Priority: 'High' } }
      ],
      boards: [board],
      hudBoard: board.id
    },
    nodes,
    edges: []
  }
}

export const TEMPLATES: FormMapTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    emoji: '⬜',
    description: 'An empty form-map: cards, groups and boards from scratch.',
    build: () => ({ formmap: { version: FORMMAP_VERSION, template: 'blank' }, nodes: [], edges: [] })
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    emoji: '🌪️',
    description: 'An idea inbox and an open field for mind-mapping (Tab = child, Enter = sibling).',
    build: () => ({
      formmap: {
        version: FORMMAP_VERSION,
        template: 'brainstorm',
        tags: { idea: { color: 'yellow' }, spark: { color: 'pink' } },
        presets: [{ id: 'idea', name: 'Idea', emoji: '💡', tags: ['idea'], child: 'idea', hint: 'Capture first, judge later.' }]
      },
      nodes: [group({ label: 'Idea inbox', emoji: '📥', prompt: 'Capture first, judge later.', x: -480, y: -300, width: 400, height: 900, color: '3', preset: 'idea' })],
      edges: []
    })
  },
  {
    id: 'kanban',
    name: 'Kanban',
    emoji: '📋',
    description: 'To do, Doing and Done groups with a saved board: move cards on the canvas or in the Board lens.',
    build: kanbanTemplate
  },
  {
    id: 'product-definition',
    name: 'Product definition',
    emoji: '🧩',
    description: 'An example: core idea, philosophy, approach, goals, MVP and later features, questions and an idea inbox.',
    build: () => {
      const gs = productDefinitionGroups()
      return { formmap: productDefinitionMeta(gs), nodes: gs, edges: [] }
    }
  }
]
