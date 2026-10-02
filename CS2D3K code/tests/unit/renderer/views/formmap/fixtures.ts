// Small builders for crafted form-map documents (shared by the formmap unit tests).
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseCanvas, type CanvasNode } from '@/views/canvas/model'
import type { FormMapCtl } from '@/views/formmap/context'
import type { FormKind, FormMapData, FormMapEdge, FormNode, Relation, ZoneNode } from '@/views/formmap/schema'

export function card(id: string, kind: FormKind, init: Partial<FormNode> = {}): FormNode {
  return { id, type: 'form', kind, title: id, text: '', fields: {}, x: 0, y: 0, width: 200, height: 100, ...init }
}

export function zone(id: string, rect: { x: number; y: number; width: number; height: number }, init: Partial<ZoneNode> = {}): ZoneNode {
  return { id, type: 'zone', label: id, ...rect, ...init }
}

export function edge(from: string, to: string, relation?: Relation, id = `${from}->${to}`): FormMapEdge {
  return relation ? { id, fromNode: from, toNode: to, relation } : { id, fromNode: from, toNode: to }
}

export function doc(nodes: CanvasNode[], edges: FormMapEdge[] = [], formmap?: FormMapData['formmap']): FormMapData {
  return formmap ? { formmap, nodes, edges } : { nodes, edges }
}

export const SAMPLE_PATH = resolve(__dirname, '../../../../../sample-vault/CS2D3K Definition.formmap')

/** The real sample definition, parsed with the canvas parser (the same path the app uses). */
export function loadSample(): FormMapData {
  const { data, valid } = parseCanvas(readFileSync(SAMPLE_PATH, 'utf8'))
  if (!valid) throw new Error('sample form-map is not valid JSON Canvas')
  return data as FormMapData
}

/** Minimal FormMapCtl for the ops helpers: only `doc.update` is used. Records every update's options. */
export function fakeCtl(data: FormMapData): { ctl: FormMapCtl; data(): FormMapData; updates: (object | undefined)[] } {
  let cur = data
  const updates: (object | undefined)[] = []
  const ctl = {
    doc: {
      get data() {
        return cur
      },
      update(fn: (d: FormMapData) => FormMapData, opts?: object) {
        updates.push(opts)
        cur = fn(cur)
      }
    }
  } as unknown as FormMapCtl
  return { ctl, data: () => cur, updates }
}

export const nodeById = (d: FormMapData, id: string): CanvasNode => {
  const n = d.nodes.find((x) => x.id === id)
  if (!n) throw new Error(`no node ${id}`)
  return n
}
