import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useUi, type MenuItem } from '@/store/ui'

function MenuList({ items, x, y, onClose, level = 0 }: { items: MenuItem[]; x: number; y: number; onClose: () => void; level?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const [sel, setSel] = useState(-1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 4) nx = level > 0 ? x - r.width - 190 : window.innerWidth - r.width - 4
    if (ny + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4)
    setPos({ x: Math.max(4, nx), y: ny })
  }, [x, y, level])

  useEffect(() => {
    if (level > 0) return
    const onKey = (e: KeyboardEvent): void => {
      const actionable = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = actionable.indexOf(sel)
        const next = e.key === 'ArrowDown' ? actionable[(cur + 1) % actionable.length] : actionable[(cur - 1 + actionable.length) % actionable.length]
        setSel(next)
      } else if (e.key === 'Enter' && sel >= 0) {
        e.preventDefault()
        const it = items[sel]
        if (it.onClick) {
          onClose()
          it.onClick()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, sel, onClose, level])

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-separator" />
        ) : (
          <div
            key={i}
            className={`menu-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}${sel === i || sub?.index === i ? ' is-selected' : ''}`}
            onMouseEnter={(e) => {
              setSel(i)
              if (it.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ index: i, x: r.right + 2, y: r.top - 4 })
              } else setSub(null)
            }}
            onClick={() => {
              if (it.submenu) return
              onClose()
              it.onClick?.()
            }}
          >
            <span className="menu-icon">{it.checked ? <Check /> : it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.submenu && <ChevronRight size={14} />}
          </div>
        )
      )}
      {sub && items[sub.index]?.submenu && <MenuList items={items[sub.index].submenu!} x={sub.x} y={sub.y} onClose={onClose} level={level + 1} />}
    </div>
  )
}

export default function ContextMenu() {
  const menu = useUi((s) => s.menu)
  const close = useUi((s) => s.closeMenu)

  useEffect(() => {
    if (!menu) return
    const onDown = (): void => close()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onDown)
    window.addEventListener('resize', onDown)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onDown)
      window.removeEventListener('resize', onDown)
    }
  }, [menu, close])

  if (!menu) return null
  return <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} onClose={close} />
}
