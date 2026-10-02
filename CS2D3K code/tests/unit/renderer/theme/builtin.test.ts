import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '@/theme/builtin'

describe('theme/builtin', () => {
  it('has unique, non-empty theme names', () => {
    const names = BUILTIN_THEMES.map((t) => t.name)
    expect(names.every((n) => n.trim().length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(BUILTIN_THEMES.map((t) => [t.name, t] as const))('%s styles exactly the modes it declares', (_name, theme) => {
    expect(theme.modes.length).toBeGreaterThan(0)
    for (const mode of ['dark', 'light'] as const)
      expect(theme.css.includes(`body.theme-${mode}`), `${mode} block`).toBe(theme.modes.includes(mode))
  })

  it.each(BUILTIN_THEMES.map((t) => [t.name, t] as const))('%s has balanced braces and only hex color values', (_name, theme) => {
    expect(theme.css.split('{').length).toBe(theme.css.split('}').length)
    const values = [...theme.css.matchAll(/--[\w-]+:\s*([^;}\s]+)/g)].map((m) => m[1])
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it.each(BUILTIN_THEMES.map((t) => [t.name, t] as const))('%s defines the full base color ramp for each mode', (_name, theme) => {
    const ramp = ['00', '05', '10', '20', '25', '30', '35', '40', '50', '60', '70', '100']
    for (const block of theme.css.split('body.theme-').slice(1))
      for (const step of ramp) expect(block, `--color-base-${step}`).toContain(`--color-base-${step}:`)
  })
})
