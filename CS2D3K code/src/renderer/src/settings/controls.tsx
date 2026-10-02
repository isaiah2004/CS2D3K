import { useEffect, useState, type ReactNode } from 'react'
import { useSettings, type Settings } from '@/store/settings'

export function SettingItem({ name, desc, children, vertical }: { name: ReactNode; desc?: ReactNode; children?: ReactNode; vertical?: boolean }) {
  return (
    <div className={`setting-item${vertical ? ' vertical' : ''}`}>
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {desc && <div className="setting-item-description">{desc}</div>}
      </div>
      {children && <div className="setting-item-control">{children}</div>}
    </div>
  )
}

export function SettingHeading({ children }: { children: ReactNode }) {
  return <div className="setting-heading">{children}</div>
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`toggle${value ? ' is-on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} />
}

type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T]

/** Toggle bound to a boolean settings key */
export function BoolSetting({ k, name, desc }: { k: KeysOfType<Settings, boolean>; name: string; desc?: ReactNode }) {
  const v = useSettings((s) => s.settings[k]) as boolean
  return (
    <SettingItem name={name} desc={desc}>
      <Toggle value={v} label={name} onChange={(nv) => useSettings.getState().set(k, nv as never)} />
    </SettingItem>
  )
}

export function SelectSetting<K extends keyof Settings>({ k, name, desc, options }: { k: K; name: string; desc?: ReactNode; options: { value: Settings[K]; label: string }[] }) {
  const v = useSettings((s) => s.settings[k])
  return (
    <SettingItem name={name} desc={desc}>
      <select className="input" value={String(v)} onChange={(e) => useSettings.getState().set(k, options.find((o) => String(o.value) === e.target.value)!.value)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingItem>
  )
}

/** Text input that commits on blur / Enter */
export function TextInput({ value, onCommit, placeholder, width = 220, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; width?: number; mono?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      className="input"
      style={{ width, fontFamily: mono ? 'var(--font-monospace)' : undefined }}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function TextSetting({ k, name, desc, placeholder }: { k: KeysOfType<Settings, string>; name: string; desc?: ReactNode; placeholder?: string }) {
  const v = useSettings((s) => s.settings[k]) as string
  return (
    <SettingItem name={name} desc={desc}>
      <TextInput value={v} placeholder={placeholder} onCommit={(nv) => useSettings.getState().set(k, nv as never)} />
    </SettingItem>
  )
}

export function SliderSetting({ k, name, desc, min, max, step = 1, unit = '' }: { k: KeysOfType<Settings, number>; name: string; desc?: ReactNode; min: number; max: number; step?: number; unit?: string }) {
  const v = useSettings((s) => s.settings[k]) as number
  return (
    <SettingItem name={name} desc={desc}>
      <span className="slider-value">
        {v}
        {unit}
      </span>
      <input type="range" className="slider" min={min} max={max} step={step} value={v} onChange={(e) => useSettings.getState().set(k, Number(e.target.value) as never)} />
    </SettingItem>
  )
}
