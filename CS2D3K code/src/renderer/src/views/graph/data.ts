// Builds graph data (nodes + deduplicated links) from the metadata index and the vault file list.
import { useMetadata } from '@/store/metadata'
import { useVault } from '@/store/vault'
import { basename, extname, stem } from '@/lib/path'
import type { GraphGroup } from './settings'

export type NodeKind = 'note' | 'canvas' | 'attachment' | 'tag' | 'unresolved'
export type LinkKind = 'link' | 'tag' | 'unresolved'

export interface GraphNodeData {
  id: string
  kind: NodeKind
  label: string
  /** vault path for note / canvas / attachment nodes */
  path?: string
  /** tag name without '#' (original casing) for tag nodes */
  tag?: string
  /** link text for unresolved nodes */
  link?: string
  /** color from a matching group */
  groupColor?: string
}

export interface GraphLinkData {
  source: string
  target: string
  kind: LinkKind
  /** bitmask: 1 = source→target, 2 = target→source (0 = undirected, e.g. tags) */
  dir: number
}

export interface GraphData {
  nodes: GraphNodeData[]
  links: GraphLinkData[]
}

export interface BuildOptions {
  showTags: boolean
  showAttachments: boolean
  existingOnly: boolean
  showOrphans: boolean
  search: string
  groups: GraphGroup[]
}

export interface LocalBuildOptions {
  depth: number
  showTags: boolean
  showAttachments: boolean
  neighborLinks: boolean
  groups: GraphGroup[]
}

// ------------------------------------------------------------------ queries

interface Term {
  neg: boolean
  field: 'any' | 'path' | 'file' | 'tag'
  value: string
}

const TERM_RE = /(-?)(?:(path|file|tag):)?(?:"([^"]*)"|(\S+))/gi

/** Parses a simple search query: words, "quoted phrases", `path:`, `file:`, `tag:` prefixes and `-` negation. */
export function parseQuery(q: string): Term[] {
  const terms: Term[] = []
  TERM_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TERM_RE.exec(q))) {
    let value = (m[3] ?? m[4] ?? '').toLowerCase()
    let field = (m[2]?.toLowerCase() ?? 'any') as Term['field']
    if (field === 'any' && value.startsWith('#') && value.length > 1) field = 'tag'
    if (field === 'tag') value = value.replace(/^#/, '')
    if (value) terms.push({ neg: m[1] === '-', field, value })
  }
  return terms
}

type TagLookup = (path: string) => string[]

function matchTerm(n: GraphNodeData, t: Term, tagsOf: TagLookup): boolean {
  const v = t.value
  switch (n.kind) {
    case 'tag': {
      const tag = n.tag!.toLowerCase()
      if (t.field === 'tag') return tag === v || tag.startsWith(v + '/')
      if (t.field === 'any') return ('#' + tag).includes(v)
      return false
    }
    case 'unresolved': {
      if (t.field === 'tag') return false
      return n.link!.toLowerCase().includes(v)
    }
    default: {
      const path = n.path!.toLowerCase()
      if (t.field === 'tag') return tagsOf(n.path!).some((tag) => tag === v || tag.startsWith(v + '/'))
      if (t.field === 'file') return basename(path).includes(v)
      return path.includes(v)
    }
  }
}

export function matchQuery(n: GraphNodeData, terms: Term[], tagsOf: TagLookup): boolean {
  for (const t of terms) if (matchTerm(n, t, tagsOf) === t.neg) return false
  return true
}

// ------------------------------------------------------------------ build

interface FullGraph {
  nodes: Map<string, GraphNodeData>
  links: Map<string, GraphLinkData>
  tagsOf: TagLookup
}

const tagId = (tag: string): string => 'tag:' + tag.toLowerCase()
const unresolvedId = (link: string): string => 'unresolved:' + link.toLowerCase()

function isNoteExt(ext: string): boolean {
  return ext === 'md' || ext === 'canvas' || ext === 'formmap'
}

function buildFull(opts: { showTags: boolean; showAttachments: boolean; existingOnly: boolean; forceAttachment?: string }): FullGraph {
  const { metas, resolved, unresolved } = useMetadata.getState()
  const files = useVault.getState().files
  const nodes = new Map<string, GraphNodeData>()
  const links = new Map<string, GraphLinkData>()

  const addLink = (a: string, b: string, kind: LinkKind, directed: boolean): void => {
    if (a === b) return
    const fwd = a < b
    const key = fwd ? a + '\u0000' + b : b + '\u0000' + a
    let l = links.get(key)
    if (!l) links.set(key, (l = { source: fwd ? a : b, target: fwd ? b : a, kind, dir: 0 }))
    if (directed) l.dir |= fwd ? 1 : 2
  }

  for (const f of Object.values(files)) {
    if (f.isDir || !isNoteExt(f.ext)) continue
    nodes.set(f.path, { id: f.path, kind: f.ext === 'md' ? 'note' : 'canvas', label: f.ext === 'md' ? stem(f.name) : f.name, path: f.path })
  }

  const addAttachment = (p: string): boolean => {
    if (nodes.has(p)) return true
    const f = files[p]
    if (!f || f.isDir) return false
    nodes.set(p, { id: p, kind: 'attachment', label: f.name, path: p })
    return true
  }
  if (opts.forceAttachment) addAttachment(opts.forceAttachment)

  for (const [src, targets] of Object.entries(resolved)) {
    if (!nodes.has(src)) continue
    for (const tgt of Object.keys(targets)) {
      if (!nodes.has(tgt)) {
        const isAttachment = !isNoteExt(extname(tgt))
        if (!isAttachment || !(opts.showAttachments || tgt === opts.forceAttachment) || !addAttachment(tgt)) continue
      }
      addLink(src, tgt, 'link', true)
    }
  }

  if (!opts.existingOnly) {
    for (const [src, targets] of Object.entries(unresolved)) {
      if (!nodes.has(src)) continue
      for (const text of Object.keys(targets)) {
        const id = unresolvedId(text)
        if (!nodes.has(id)) nodes.set(id, { id, kind: 'unresolved', label: basename(text), link: text })
        addLink(src, id, 'unresolved', true)
      }
    }
  }

  const tagCache = new Map<string, string[]>()
  const tagsOf: TagLookup = (path) => {
    let t = tagCache.get(path)
    if (!t) tagCache.set(path, (t = [...new Set((metas[path]?.tags ?? []).map((x) => x.tag.toLowerCase()))]))
    return t
  }

  if (opts.showTags) {
    for (const m of Object.values(metas)) {
      if (!nodes.has(m.path)) continue
      for (const t of m.tags) {
        const id = tagId(t.tag)
        if (!nodes.has(id)) nodes.set(id, { id, kind: 'tag', label: '#' + t.tag, tag: t.tag })
        addLink(m.path, id, 'tag', false)
      }
    }
  }
  return { nodes, links, tagsOf }
}

function applyGroups(nodes: GraphNodeData[], groups: GraphGroup[], tagsOf: TagLookup): void {
  const parsed = groups.map((g) => ({ color: g.color, terms: parseQuery(g.query) })).filter((g) => g.terms.length)
  if (!parsed.length) return
  for (const n of nodes) {
    const g = parsed.find((x) => matchQuery(n, x.terms, tagsOf))
    if (g) n.groupColor = g.color
  }
}

/** Global graph. */
export function buildGraph(opts: BuildOptions): GraphData {
  const full = buildFull(opts)
  let nodes = [...full.nodes.values()]
  let links = [...full.links.values()]

  const terms = parseQuery(opts.search)
  if (terms.length) {
    const keep = new Set<string>()
    for (const n of nodes) if (matchQuery(n, terms, full.tagsOf)) keep.add(n.id)
    // tags / attachments / unresolved links of matching notes stay visible
    const isFileNote = (id: string): boolean => {
      const k = full.nodes.get(id)!.kind
      return k === 'note' || k === 'canvas'
    }
    const extra: string[] = []
    for (const l of links) {
      if (keep.has(l.source) && isFileNote(l.source) && !isFileNote(l.target)) extra.push(l.target)
      if (keep.has(l.target) && isFileNote(l.target) && !isFileNote(l.source)) extra.push(l.source)
    }
    for (const id of extra) keep.add(id)
    nodes = nodes.filter((n) => keep.has(n.id))
    links = links.filter((l) => keep.has(l.source) && keep.has(l.target))
  }

  if (!opts.showOrphans) {
    const linked = new Set<string>()
    for (const l of links) {
      linked.add(l.source)
      linked.add(l.target)
    }
    nodes = nodes.filter((n) => linked.has(n.id))
  }

  applyGroups(nodes, opts.groups, full.tagsOf)
  return { nodes, links }
}

/** Local graph around `center` (a vault path) up to `depth` hops. Returns null if the file is unknown. */
export function buildLocalGraph(center: string, opts: LocalBuildOptions): GraphData | null {
  const files = useVault.getState().files
  if (!files[center] || files[center].isDir) return null
  const isAttachment = !isNoteExt(extname(center))
  const full = buildFull({ ...opts, existingOnly: false, forceAttachment: isAttachment ? center : undefined })
  if (!full.nodes.has(center)) return null

  const adj = new Map<string, string[]>()
  const push = (a: string, b: string): void => {
    const arr = adj.get(a)
    if (arr) arr.push(b)
    else adj.set(a, [b])
  }
  for (const l of full.links.values()) {
    push(l.source, l.target)
    push(l.target, l.source)
  }

  // BFS (tag nodes are leaves: never expand through them)
  const dist = new Map<string, number>([[center, 0]])
  let frontier = [center]
  for (let d = 1; d <= opts.depth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      if (id !== center && full.nodes.get(id)!.kind === 'tag') continue
      for (const nb of adj.get(id) ?? []) {
        if (dist.has(nb)) continue
        dist.set(nb, d)
        next.push(nb)
      }
    }
    frontier = next
  }

  const nodes = [...dist.keys()].map((id) => full.nodes.get(id)!)
  const links = [...full.links.values()].filter((l) => {
    const a = dist.get(l.source)
    const b = dist.get(l.target)
    if (a === undefined || b === undefined) return false
    return opts.neighborLinks || Math.abs(a - b) === 1
  })
  applyGroups(nodes, opts.groups, full.tagsOf)
  return { nodes, links }
}
