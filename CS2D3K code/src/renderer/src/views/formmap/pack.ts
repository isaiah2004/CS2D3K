// The "Product definition" pack: the old built-in kinds (idea, principle, goal, approach, feature, question, note) as
// plain data — tags with colors, card presets, typed fields, relation rules and coach checks. The Product Definition
// template ships it as an example, and version 1 maps are migrated onto it (their `kind` becomes a tag).
// Types only from schema (it imports this module's values).
import type { CheckRule, FieldDef, FieldOption, FieldRegistry, Preset, RelationRule, TagDef } from './schema'

export const PD_TAGS: Record<string, TagDef> = {
  idea: { color: 'yellow' },
  principle: { color: 'purple' },
  goal: { color: 'red' },
  approach: { color: 'cyan' },
  feature: { color: 'green' },
  question: { color: 'orange' },
  note: { color: 'gray' }
}
/** colors for tags that were kinds (migration) */
export const LEGACY_KIND_TAGS = PD_TAGS

export const PHASES: FieldOption[] = [
  { value: 'mvp', label: 'Initial (MVP)', color: 'green' },
  { value: 'next', label: 'Next', color: 'blue' },
  { value: 'later', label: 'Later', color: 'purple' },
  { value: 'someday', label: 'Someday', color: 'gray' }
]

export const PRIORITIES: FieldOption[] = [
  { value: 'must', label: 'Must', color: 'red' },
  { value: 'should', label: 'Should', color: 'orange' },
  { value: 'could', label: 'Could', color: 'blue' },
  { value: 'wont', label: "Won't", color: 'gray' }
]

/** effort in t-shirt sizes; points are what the MVP budget adds up */
export const EFFORTS: FieldOption[] = [
  { value: 'xs', label: 'XS', points: 1 },
  { value: 's', label: 'S', points: 2 },
  { value: 'm', label: 'M', points: 3 },
  { value: 'l', label: 'L', points: 5 },
  { value: 'xl', label: 'XL', points: 8 }
]

/** One status field; each option is offered to the cards it was meant for (`for`), like the old per-kind statuses. */
export const STATUSES: FieldOption[] = [
  { value: 'idea', label: 'Idea', color: 'gray', for: ['feature'] },
  { value: 'planned', label: 'Planned', color: 'blue', for: ['feature'] },
  { value: 'building', label: 'Building', color: 'orange', for: ['feature'] },
  { value: 'done', label: 'Done', color: 'green', for: ['feature'] },
  { value: 'cut', label: 'Cut', color: 'red', for: ['feature'] },
  { value: 'open', label: 'Open', color: 'orange', for: ['question'] },
  { value: 'decided', label: 'Decided', color: 'green', for: ['question'] },
  { value: 'parked', label: 'Parked', color: 'gray', for: ['question'] },
  { value: 'proposed', label: 'Proposed', color: 'orange', for: ['approach'] },
  { value: 'accepted', label: 'Accepted', color: 'green', for: ['approach'] },
  { value: 'superseded', label: 'Superseded', color: 'gray', for: ['approach'] },
  { value: 'raw', label: 'Raw', color: 'gray', for: ['idea'] },
  { value: 'refined', label: 'Refined', color: 'blue', for: ['idea'] },
  { value: 'merged', label: 'Merged', color: 'green', for: ['idea'] },
  { value: 'dropped', label: 'Dropped', color: 'red', for: ['idea'] }
]

/** The typed fields of the old kinds, by key (the registry of the template and of migrated maps). */
export const PD_FIELDS: FieldRegistry = {
  phase: { type: 'select', label: 'Phase', options: PHASES },
  priority: { type: 'select', label: 'Priority', options: PRIORITIES },
  effort: { type: 'select', label: 'Effort', options: EFFORTS },
  status: { type: 'select', label: 'Status', options: STATUSES },
  fun: { type: 'rating', label: 'Fun factor', max: 5, help: 'How much joy does this bring to developers?' },
  acceptance: { type: 'checklist', label: 'Acceptance criteria' },
  strength: { type: 'rating', label: 'Conviction', max: 5 },
  metric: { type: 'text', label: 'Success metric', placeholder: 'How will we know?' },
  horizon: {
    type: 'select',
    label: 'Horizon',
    options: [
      { value: 'final', label: 'Final goal', color: 'red' },
      { value: 'milestone', label: 'Milestone', color: 'orange' }
    ]
  },
  decision: { type: 'longtext', label: 'Decision' },
  why: { type: 'longtext', label: 'Why we believe it', hidden: true },
  rationale: { type: 'longtext', label: 'Rationale', hidden: true },
  alternatives: { type: 'longtext', label: 'Alternatives considered', hidden: true },
  options: { type: 'longtext', label: 'Options', hidden: true },
  source: { type: 'text', label: 'Source', hidden: true, placeholder: 'Where did this come from?' },
  note: { type: 'link', label: 'Linked note', hidden: true, placeholder: '[[Note]]' }
}

export function legacyFieldDef(key: string): FieldDef | undefined {
  return Object.prototype.hasOwnProperty.call(PD_FIELDS, key) ? PD_FIELDS[key] : undefined
}

/** Presets equivalent to the old kinds (ids = the old kind names, so migrated groups keep their default). */
export const PD_PRESETS: Preset[] = [
  { id: 'idea', name: 'Idea', emoji: '💡', tags: ['idea'], fields: { status: 'raw' }, size: { width: 240, height: 140 }, hint: 'A raw thought. Capture first, triage later.' },
  { id: 'principle', name: 'Principle', emoji: '🧭', tags: ['principle'], size: { width: 280, height: 150 }, child: 'approach', hint: 'A belief that drives decisions (philosophy).' },
  { id: 'goal', name: 'Goal', emoji: '🎯', tags: ['goal'], size: { width: 280, height: 150 }, child: 'feature', hint: 'An outcome we want. Features should serve goals.' },
  { id: 'approach', name: 'Approach', emoji: '🛠️', tags: ['approach'], fields: { status: 'proposed' }, size: { width: 300, height: 170 }, child: 'feature', hint: 'An engineering decision with its rationale (ADR-style).' },
  { id: 'feature', name: 'Feature', emoji: '✨', tags: ['feature'], size: { width: 280, height: 180 }, hint: 'Something the product does. Give it a phase, priority and effort.' },
  { id: 'question', name: 'Question', emoji: '❓', tags: ['question'], fields: { status: 'open' }, size: { width: 260, height: 150 }, child: 'idea', hint: 'An open question or risk that blocks a decision.' },
  { id: 'note', name: 'Note', emoji: '📝', tags: ['note'], size: { width: 260, height: 140 }, hint: 'Free-form context.' }
]

/** Default relations between the example tags (first match wins). */
export const PD_RELATION_RULES: RelationRule[] = [
  { from: 'idea', relation: 'refines' },
  { from: 'feature', to: 'goal', relation: 'serves' },
  { from: 'approach', to: 'goal', relation: 'serves' },
  { from: 'principle', to: 'principle', relation: 'relates' },
  { to: 'principle', relation: 'because' },
  { from: 'goal', to: 'goal', relation: 'serves' },
  { from: 'feature', to: 'feature', relation: 'depends' },
  { from: 'feature', to: 'approach', relation: 'depends' },
  { from: 'approach', to: 'approach', relation: 'depends' }
]

const LIVE_FEATURE = { tags: ['feature'], notFields: { status: 'cut' } }
const MVP_FEATURE = { tags: ['feature'], fields: { phase: 'mvp' }, notFields: { status: 'cut' } }

/** The product-definition coach checks, as declarative rules. */
export function pdChecks(mvpBudget?: number): CheckRule[] {
  return [
    {
      id: 'feature-no-goal',
      type: 'relation',
      match: LIVE_FEATURE,
      relation: 'serves',
      target: { tags: ['goal'] },
      level: 'warn',
      title: '{n} {n|feature|features} {n|serves|serve} no goal',
      detail: '{titles}. Connect each to the goal it helps achieve — or ask whether it belongs at all.',
      good: 'Every feature serves a goal'
    },
    {
      id: 'goal-no-features',
      type: 'relation',
      dir: 'in',
      match: { tags: ['goal'] },
      relation: 'serves',
      target: LIVE_FEATURE,
      level: 'warn',
      title: '{n} {n|goal|goals} with no features',
      detail: '{titles}. Nothing we plan to build moves {n|it|them} forward.',
      good: 'Every goal has features serving it'
    },
    { id: 'mvp-budget', type: 'sum', match: MVP_FEATURE, field: 'effort', label: 'MVP', unit: 'pts', ...(mvpBudget ? { max: mvpBudget } : {}) },
    {
      id: 'mvp-unsized',
      type: 'field',
      match: MVP_FEATURE,
      field: 'effort',
      level: 'info',
      title: '{n} MVP {n|feature|features} without an effort estimate',
      detail: "{titles}. The budget can't see {n|it|them}."
    },
    {
      id: 'unused-principles',
      type: 'relation',
      dir: 'in',
      match: { tags: ['principle'] },
      relation: 'because',
      level: 'info',
      title: '{n} {n|principle|principles} nobody relies on',
      detail: '{titles}. No decision is "because" of {n|it|them} — link one, or let the principle go.',
      good: 'Every principle drives a decision'
    },
    {
      id: 'approaches-proposed',
      type: 'count',
      match: { tags: ['approach'], fields: { status: [null, 'proposed'] } },
      level: 'info',
      title: '{n} {n|approach|approaches} still proposed',
      detail: '{titles}. Accept or supersede {n|it|them} so everyone builds with confidence.',
      good: 'All engineering approaches are decided'
    },
    {
      id: 'open-questions',
      type: 'count',
      match: { tags: ['question'], fields: { status: [null, 'open'] } },
      level: 'info',
      warnAbove: 3,
      title: '{n} open {n|question|questions}',
      detail: '{titles}. Decide {n|it|them}, or park {n|it|them} explicitly.',
      good: 'No open questions left'
    },
    {
      id: 'mvp-no-acceptance',
      type: 'field',
      match: MVP_FEATURE,
      field: 'acceptance',
      level: 'info',
      title: '{n} MVP {n|feature|features} without acceptance criteria',
      detail: '{titles}. How will we know {n|it is|they are} done?',
      good: 'Every MVP feature has acceptance criteria'
    },
    {
      id: 'raw-ideas',
      type: 'count',
      match: { tags: ['idea'], fields: { status: [null, 'raw'] } },
      level: 'info',
      title: '{n} raw {n|idea|ideas} waiting in the inbox',
      detail: '{titles}. Triage: refine into a feature, merge, or drop.'
    }
  ]
}
