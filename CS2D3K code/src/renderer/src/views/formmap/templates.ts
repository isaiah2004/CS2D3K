// Starting layouts for new form-maps.
import { hexId } from '@/lib/util'
import { FORMMAP_VERSION, type FormKind, type FormMapData, type ZoneNode } from './schema'

export interface FormMapTemplate {
  id: string
  name: string
  emoji: string
  description: string
  build(): FormMapData
}

interface ZoneSpec {
  label: string
  emoji: string
  prompt: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  defaultKind?: FormKind
  assign?: Record<string, unknown>
  order?: number
}

function zone(z: ZoneSpec): ZoneNode {
  return { id: hexId(), type: 'zone', locked: true, ...z }
}

const W = 760
const GAP = 80

/** The CS2D3K project-definition board: idea → philosophy → approach → goal → features. */
export function productDefinitionZones(): ZoneNode[] {
  const col = (i: number): number => i * (W + GAP)
  return [
    zone({
      label: 'Core idea',
      emoji: '🌱',
      prompt: 'One or two sentences: what is this product and why must it exist?',
      x: 0, y: 0, width: 3 * W + 2 * GAP, height: 340, color: '3', defaultKind: 'note', order: 1
    }),
    zone({
      label: 'Philosophy',
      emoji: '🧭',
      prompt: 'The beliefs that drive every decision. If a feature fights a principle, the principle wins.',
      x: col(0), y: 420, width: W, height: 620, color: '6', defaultKind: 'principle', order: 2
    }),
    zone({
      label: 'Engineering approach',
      emoji: '🛠️',
      prompt: 'How we build it: stack, process and the key technical decisions — each with a rationale.',
      x: col(1), y: 420, width: W, height: 620, color: '5', defaultKind: 'approach', order: 3
    }),
    zone({
      label: 'Final goal',
      emoji: '🎯',
      prompt: 'What does success look like? Make it measurable.',
      x: col(2), y: 420, width: W, height: 620, color: '1', defaultKind: 'goal', assign: { horizon: 'final' }, order: 4
    }),
    zone({
      label: 'Initial features (MVP)',
      emoji: '🚀',
      prompt: 'The smallest set of features that proves the core idea. Every one should serve a goal.',
      x: col(0), y: 1120, width: W, height: 720, color: '4', defaultKind: 'feature', assign: { phase: 'mvp' }, order: 5
    }),
    zone({
      label: 'Later features',
      emoji: '🔭',
      prompt: 'Good ideas that are not needed to prove the core idea. Park them here guilt-free.',
      x: col(1), y: 1120, width: W, height: 720, color: '5', defaultKind: 'feature', assign: { phase: 'later' }, order: 6
    }),
    zone({
      label: 'Open questions',
      emoji: '❓',
      prompt: 'Unknowns and risks. Decide them, or explicitly park them.',
      x: col(2), y: 1120, width: W, height: 720, color: '2', defaultKind: 'question', order: 7
    }),
    zone({
      label: 'Idea inbox',
      emoji: '📥',
      prompt: 'Dump raw ideas here. Drag them into a zone when they are ready.',
      x: -(W / 2 + GAP + 40), y: 420, width: W / 2 + 40, height: 1420, color: '3', defaultKind: 'idea'
    })
  ]
}

export const TEMPLATES: FormMapTemplate[] = [
  {
    id: 'product-definition',
    name: 'Product definition',
    emoji: '🧩',
    description: 'Core idea, philosophy, engineering approach, final goal, MVP and later features, open questions and an idea inbox.',
    build: () => ({ formmap: { version: FORMMAP_VERSION, template: 'product-definition', mvpBudget: 40 }, nodes: productDefinitionZones(), edges: [] })
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    emoji: '🌪️',
    description: 'An idea inbox and an open field for mind-mapping (Tab = child, Enter = sibling).',
    build: () => ({
      formmap: { version: FORMMAP_VERSION, template: 'brainstorm' },
      nodes: [
        zone({ label: 'Idea inbox', emoji: '📥', prompt: 'Capture first, judge later.', x: -480, y: -300, width: 400, height: 900, color: '3', defaultKind: 'idea' })
      ],
      edges: []
    })
  },
  {
    id: 'blank',
    name: 'Blank',
    emoji: '⬜',
    description: 'An empty form-map.',
    build: () => ({ formmap: { version: FORMMAP_VERSION, template: 'blank' }, nodes: [], edges: [] })
  }
]
