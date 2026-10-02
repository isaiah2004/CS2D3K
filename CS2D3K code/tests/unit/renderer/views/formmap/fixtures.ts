// Small builders for crafted form-map documents (shared by the formmap unit tests).
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseCanvas, type CanvasData, type CanvasNode } from '@/views/canvas/model'
import type { FormMapCtl } from '@/views/formmap/context'
import { metaOf, normalizeFormMap, type FormMapData, type FormMapEdge, type FormMapMeta, type FormNode, type GroupNode, type KanbanColumn, type KanbanNode, type Relation } from '@/views/formmap/schema'

export function card(id: string, init: Partial<FormNode> = {}): FormNode {
  return { id, type: 'form', title: id, text: '', tags: [], fields: {}, x: 0, y: 0, width: 200, height: 100, ...init }
}

export function group(id: string, rect: { x: number; y: number; width: number; height: number }, init: Partial<GroupNode> = {}): GroupNode {
  return { id, type: 'group', label: id, ...rect, ...init }
}

export function kanban(id: string, columns: KanbanColumn[], init: Partial<KanbanNode> = {}): KanbanNode {
  return { id, type: 'kanban', title: id, columns, x: 0, y: 0, width: 800, height: 400, ...init }
}

export function edge(from: string, to: string, relation?: Relation, id = `${from}->${to}`): FormMapEdge {
  return relation ? { id, fromNode: from, toNode: to, relation } : { id, fromNode: from, toNode: to }
}

export function doc(nodes: CanvasNode[], edges: FormMapEdge[] = [], formmap?: Partial<FormMapMeta>): FormMapData {
  return formmap ? { formmap: { version: 2, ...formmap }, nodes, edges } : { nodes, edges }
}

const ROOT = resolve(__dirname, '../../../../..')
export const SAMPLE_PATH = resolve(ROOT, 'sample-vault/CS2D3K Definition.formmap')
export const SPRINT_PATH = resolve(ROOT, 'sample-vault/Sprint board.formmap')
/** the CS2D3K definition as it was saved by version 1 (kinds + zones) */
export const LEGACY_PATH = resolve(ROOT, 'tests/fixtures/definition-v1.formmap')

/** A form-map file, parsed with the canvas parser (the same path the app uses) and optionally normalized. */
export function load(path: string, normalize = true): FormMapData {
  const { data, valid } = parseCanvas(readFileSync(path, 'utf8'))
  if (!valid) throw new Error(`${path} is not valid JSON Canvas`)
  return (normalize ? normalizeFormMap(data) : data) as FormMapData
}
export const loadSample = (): FormMapData => load(SAMPLE_PATH)
export const loadSprint = (): FormMapData => load(SPRINT_PATH)

/** Minimal FormMapCtl for the ops helpers: doc.update / doc.data (+ meta). Records every update's options. */
export function fakeCtl(data: FormMapData): { ctl: FormMapCtl; data(): FormMapData; updates: (object | undefined)[] } {
  let cur: CanvasData = data
  const updates: (object | undefined)[] = []
  const ctl = {
    doc: {
      get data() {
        return cur
      },
      update(fn: (d: CanvasData) => CanvasData, opts?: object) {
        updates.push(opts)
        cur = fn(cur)
      }
    },
    get data() {
      return cur
    },
    get meta() {
      return metaOf(cur)
    },
    updateForm(id: string, patch: Partial<FormNode>) {
      cur = { ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, ...patch, fields: patch.fields ? { ...(n as FormNode).fields, ...patch.fields } : (n as FormNode).fields } : n)) }
    }
  } as unknown as FormMapCtl
  return { ctl, data: () => cur as FormMapData, updates }
}

export const nodeById = (d: CanvasData, id: string): CanvasNode => {
  const n = d.nodes.find((x) => x.id === id)
  if (!n) throw new Error(`no node ${id}`)
  return n
}
export const formById = (d: CanvasData, id: string): FormNode => nodeById(d, id) as FormNode
