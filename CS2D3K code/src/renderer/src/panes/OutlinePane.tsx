import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useActiveFile } from '@/store/workspace'
import { useMetadata } from '@/store/metadata'
import type { HeadingRef } from '@/lib/mdparse'
import { openAt } from './common'

interface Node {
  h: HeadingRef
  children: Node[]
}

function buildTree(headings: HeadingRef[]): Node[] {
  const root: Node[] = []
  const stack: Node[] = []
  for (const h of headings) {
    const node: Node = { h, children: [] }
    while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else root.push(node)
    stack.push(node)
  }
  return root
}

function Item({ node, depth, path }: { node: Node; depth: number; path: string }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div className="tree-item" style={{ paddingLeft: 4 + depth * 16 }} onClick={() => openAt(path, { line: node.h.line })}>
        {node.children.length ? (
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
        <span className="item-name">{node.h.text}</span>
      </div>
      {open && node.children.map((c, i) => <Item key={i} node={c} depth={depth + 1} path={path} />)}
    </>
  )
}

export default function OutlinePane() {
  const active = useActiveFile()
  const headings = useMetadata((s) => (active ? s.metas[active]?.headings : undefined))
  if (!active || !active.endsWith('.md')) return <div className="empty-state">Open a note to see its outline.</div>
  if (!headings?.length) return <div className="empty-state">No headings found.</div>
  return (
    <div className="pane-body">
      {buildTree(headings).map((n, i) => (
        <Item key={i} node={n} depth={0} path={active} />
      ))}
    </div>
  )
}
