import { useEffect, useMemo, useState } from 'react'
import { Plus, X, RotateCcw } from 'lucide-react'
import { useCommands, eventToHotkey, formatHotkey, hotkeyRecorder } from '@/store/commands'
import { useSettings } from '@/store/settings'
import { fuzzyMatch } from '@/lib/util'
import { SettingHeading } from './controls'

export default function HotkeysTab() {
  const commands = useCommands((s) => s.commands)
  const overrides = useSettings((s) => s.settings.hotkeys)
  const [filter, setFilter] = useState('')
  const [recording, setRecording] = useState<string | null>(null)

  const list = useMemo(() => {
    const all = Object.values(commands).sort((a, b) => a.name.localeCompare(b.name))
    if (!filter.trim()) return all
    return all.filter((c) => fuzzyMatch(filter, c.name) || (overrides[c.id] ?? c.hotkeys ?? []).some((h) => formatHotkey(h).toLowerCase().includes(filter.toLowerCase())))
  }, [commands, filter, overrides])

  // all assigned keys → command ids (to show conflicts)
  const assigned = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of Object.values(commands))
      for (const h of overrides[c.id] ?? c.hotkeys ?? []) {
        const arr = m.get(h)
        if (arr) arr.push(c.id)
        else m.set(h, [c.id])
      }
    return m
  }, [commands, overrides])

  useEffect(() => {
    if (!recording) return
    hotkeyRecorder.active = true
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const hk = eventToHotkey(e)
      if (!hk) return
      const cmd = useCommands.getState().commands[recording]
      const cur = useSettings.getState().settings.hotkeys[recording] ?? cmd?.hotkeys ?? []
      if (!cur.includes(hk)) useSettings.getState().set('hotkeys', { ...useSettings.getState().settings.hotkeys, [recording]: [...cur, hk] })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      hotkeyRecorder.active = false
      window.removeEventListener('keydown', onKey, true)
    }
  }, [recording])

  const remove = (id: string, hk: string): void => {
    const cur = overrides[id] ?? commands[id]?.hotkeys ?? []
    useSettings.getState().set('hotkeys', { ...overrides, [id]: cur.filter((h) => h !== hk) })
  }
  const reset = (id: string): void => {
    const next = { ...overrides }
    delete next[id]
    useSettings.getState().set('hotkeys', next)
  }

  return (
    <>
      <SettingHeading>Hotkeys</SettingHeading>
      <input className="input" placeholder="Filter by command name or hotkey…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
      {list.map((c) => {
        const keys = overrides[c.id] ?? c.hotkeys ?? []
        const custom = overrides[c.id] !== undefined
        return (
          <div key={c.id} className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">{c.name}</div>
              {custom && <div className="setting-item-description">Customized</div>}
            </div>
            <div className="setting-item-control" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {keys.map((k) => (
                <span key={k} className={`hotkey-pill${(assigned.get(k)?.length ?? 0) > 1 ? ' is-conflict' : ''}`} title={(assigned.get(k)?.length ?? 0) > 1 ? 'This hotkey is used by multiple commands' : undefined}>
                  {formatHotkey(k)}
                  <button className="hotkey-remove" onClick={() => remove(c.id, k)} aria-label="Remove hotkey">
                    <X size={11} />
                  </button>
                </span>
              ))}
              {recording === c.id ? (
                <span className="hotkey-pill is-recording">Press hotkey… (Esc to cancel)</span>
              ) : (
                <button className="clickable-icon small" title="Add hotkey" onClick={() => setRecording(c.id)}>
                  <Plus />
                </button>
              )}
              {custom && (
                <button className="clickable-icon small" title="Restore default" onClick={() => reset(c.id)}>
                  <RotateCcw />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
