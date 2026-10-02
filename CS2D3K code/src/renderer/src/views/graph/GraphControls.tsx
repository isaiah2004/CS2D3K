// Floating, collapsible settings panel of the graph view (filters, groups, display, forces).
import type { ReactNode } from 'react'
import { ChevronDown, Plus, RotateCcw, Search, Settings, X } from 'lucide-react'
import { useGraphSettings, type GraphSettings } from './settings'
import { themePalette } from '@/theme/theme'

const GROUP_COLORS = ['color-red', 'color-orange', 'color-yellow', 'color-green', 'color-cyan', 'color-blue', 'color-purple', 'color-pink']

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const collapsed = useGraphSettings((s) => !!s.settings.collapsed[id])
  const toggle = (): void => {
    const s = useGraphSettings.getState()
    s.set({ collapsed: { ...s.settings.collapsed, [id]: !collapsed } })
  }
  return (
    <div className={`graph-control-section${collapsed ? ' is-collapsed' : ''}`}>
      <div className="graph-control-section-header" onClick={toggle} role="button" aria-expanded={!collapsed}>
        <span className="graph-control-chevron">
          <ChevronDown />
        </span>
        {title}
      </div>
      {!collapsed && <div className="graph-control-section-body">{children}</div>}
    </div>
  )
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <div className="graph-control-row" onClick={() => onChange(!value)}>
      <span className="graph-control-label">{label}</span>
      <button className={`toggle${value ? ' is-on' : ''}`} role="switch" aria-checked={value} aria-label={label} />
    </div>
  )
}

export function SliderRow(props: { label: string; min: number; max: number; step: number; value: number; onChange(v: number): void }) {
  const { label, min, max, step, value, onChange } = props
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="graph-control-slider">
      <span className="graph-control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title={String(+value.toFixed(2))}
        aria-label={label}
        style={{ '--graph-slider-pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export default function GraphControls({ onAnimate }: { onAnimate(): void }) {
  const s = useGraphSettings((st) => st.settings)
  const set = useGraphSettings((st) => st.set)
  const patch = <K extends keyof GraphSettings>(k: K) => (v: GraphSettings[K]) => set({ [k]: v } as Partial<GraphSettings>)

  if (!s.panelOpen)
    return (
      <button className="graph-controls-open clickable-icon" title="Open graph settings" aria-label="Open graph settings" onClick={() => set({ panelOpen: true })}>
        <Settings />
      </button>
    )

  const addGroup = (): void => {
    const pal = themePalette()
    const color = pal[GROUP_COLORS[s.groups.length % GROUP_COLORS.length]].slice(0, 7)
    set({ groups: [...s.groups, { query: '', color }] })
  }
  const updateGroup = (i: number, p: Partial<GraphSettings['groups'][number]>): void =>
    set({ groups: s.groups.map((g, j) => (j === i ? { ...g, ...p } : g)) })

  return (
    <div className="graph-controls" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="graph-controls-top">
        <button className="clickable-icon small" title="Restore default settings" aria-label="Restore default settings" onClick={() => useGraphSettings.getState().reset()}>
          <RotateCcw />
        </button>
        <button className="clickable-icon small" title="Close" aria-label="Close graph settings" onClick={() => set({ panelOpen: false })}>
          <X />
        </button>
      </div>

      <Section id="filters" title="Filters">
        <div className="graph-search">
          <Search className="graph-search-icon" />
          <input
            className="input"
            type="search"
            placeholder="Search files…"
            spellCheck={false}
            value={s.search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && s.search && (e.preventDefault(), set({ search: '' }))}
          />
          {s.search && (
            <button className="graph-search-clear clickable-icon small" title="Clear" aria-label="Clear search" onClick={() => set({ search: '' })}>
              <X />
            </button>
          )}
        </div>
        <ToggleRow label="Tags" value={s.showTags} onChange={patch('showTags')} />
        <ToggleRow label="Attachments" value={s.showAttachments} onChange={patch('showAttachments')} />
        <ToggleRow label="Existing files only" value={s.existingOnly} onChange={patch('existingOnly')} />
        <ToggleRow label="Orphans" value={s.showOrphans} onChange={patch('showOrphans')} />
      </Section>

      <Section id="groups" title="Groups">
        {s.groups.map((g, i) => (
          <div className="graph-group-row" key={i}>
            <input
              className="input"
              placeholder="Enter query…  (path:, file:, tag:)"
              spellCheck={false}
              value={g.query}
              onChange={(e) => updateGroup(i, { query: e.target.value })}
            />
            <label className="graph-color-swatch" style={{ background: g.color }} title="Group color">
              <input type="color" value={g.color.slice(0, 7)} onChange={(e) => updateGroup(i, { color: e.target.value })} />
            </label>
            <button className="clickable-icon small" title="Delete group" aria-label="Delete group" onClick={() => set({ groups: s.groups.filter((_, j) => j !== i) })}>
              <X />
            </button>
          </div>
        ))}
        <button className="btn mod-cta graph-new-group" onClick={addGroup}>
          <Plus size={14} /> New group
        </button>
      </Section>

      <Section id="display" title="Display">
        <ToggleRow label="Arrows" value={s.showArrows} onChange={patch('showArrows')} />
        <SliderRow label="Text fade threshold" min={-3} max={3} step={0.1} value={s.textFade} onChange={patch('textFade')} />
        <SliderRow label="Node size" min={0.3} max={3} step={0.05} value={s.nodeSize} onChange={patch('nodeSize')} />
        <SliderRow label="Link thickness" min={0.2} max={4} step={0.1} value={s.linkThickness} onChange={patch('linkThickness')} />
        <button className="btn graph-animate" onClick={onAnimate}>
          Animate
        </button>
      </Section>

      <Section id="forces" title="Forces">
        <SliderRow label="Center force" min={0} max={1} step={0.01} value={s.centerStrength} onChange={patch('centerStrength')} />
        <SliderRow label="Repel force" min={0} max={20} step={0.1} value={s.repelStrength} onChange={patch('repelStrength')} />
        <SliderRow label="Link force" min={0} max={1} step={0.01} value={s.linkStrength} onChange={patch('linkStrength')} />
        <SliderRow label="Link distance" min={30} max={500} step={1} value={s.linkDistance} onChange={patch('linkDistance')} />
      </Section>
    </div>
  )
}
