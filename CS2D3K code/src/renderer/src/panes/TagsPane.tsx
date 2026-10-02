import { useMemo, useState } from 'react'
import { ArrowDownUp, ChevronDown, Hash } from 'lucide-react'
import { useMetadata, getAllTags } from '@/store/metadata'
import { useWorkspace } from '@/store/workspace'
import { emit } from '@/lib/events'

interface TagNode {
  name: string
  full: string
  count: number
  children: Map<string, TagNode>
}

function buildTree(tags: { tag: string; count: number }[]): TagNode {
  const root: TagNode = { name: '', full: '', count: 0, children: new Map() }
  for (const t of tags) {
    let node = root
    const parts = t.tag.split('/')
    parts.forEach((p, i) => {
      const key = p.toLowerCase()
      let child = node.children.get(key)
      if (!child) node.children.set(key, (child = { name: p, full: parts.slice(0, i + 1).join('/'), count: 0, children: new Map() }))
      child.count += t.count
      node = child
    })
  }
  return root
}

function TagRow({ node, depth, sort }: { node: TagNode; depth: number; sort: 'name' | 'count' }) {
  const [open, setOpen] = useState(true)
  const kids = [...node.children.values()].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.count - a.count))
  return (
    <>
      <div
        className="tree-item"
        style={{ paddingLeft: 4 + depth * 16 }}
        onClick={() => {
          useWorkspace.getState().revealPane('search')
          setTimeout(() => emit('focus-search', { query: `#${node.full}` }), 30)
        }}
      >
        {kids.length ? (
          <span
            className={`chevron${open ? '' : ' collapsed'}`}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
          >
            <ChevronDown />
          </span>
        ) : (
          <span className="chevron" />
        )}
        <Hash className="item-icon" size={13} />
        <span className="item-name">{node.name}</span>
        <span className="item-count">{node.count}</span>
      </div>
      {open && kids.map((k) => <TagRow key={k.full} node={k} depth={depth + 1} sort={sort} />)}
    </>
  )
}

export default function TagsPane() {
  const version = useMetadata((s) => s.version)
  const [sort, setSort] = useState<'name' | 'count'>('count')
  const tree = useMemo(() => buildTree(getAllTags()), [version])
  const top = [...tree.children.values()].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.count - a.count))
  return (
    <>
      <div className="pane-header">
        <button className="clickable-icon small" title={`Sort by ${sort === 'name' ? 'frequency' : 'name'}`} onClick={() => setSort(sort === 'name' ? 'count' : 'name')}>
          <ArrowDownUp />
        </button>
      </div>
      <div className="pane-body">
        {top.length === 0 && <div className="empty-state">No tags found.</div>}
        {top.map((n) => (
          <TagRow key={n.full} node={n} depth={0} sort={sort} />
        ))}
      </div>
    </>
  )
}
