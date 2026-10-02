// Theme manager: applies base theme, accent, fonts, theme CSS and snippets.
import { useSettings, type Settings } from '@/store/settings'
import { BUILTIN_THEMES } from './builtin'

const listeners = new Set<() => void>()

/** Subscribe to any change of effective theme (mode, theme css, accent). */
export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(): void {
  // let styles apply first
  requestAnimationFrame(() => listeners.forEach((cb) => cb()))
}

function styleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  return el
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let hh = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) hh = (b - r) / d + 2
    else hh = (r - g) / d + 4
    hh *= 60
  }
  return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) }
}

let mediaQuery: MediaQueryList | null = null

export function effectiveMode(s: Settings): 'dark' | 'light' {
  if (s.baseTheme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return s.baseTheme
}

async function themeCss(name: string): Promise<string> {
  if (!name) return ''
  if (name.startsWith('builtin:')) return BUILTIN_THEMES.find((t) => t.name === name.slice(8))?.css ?? ''
  const themes = await window.api.config.listThemes()
  const t = themes.find((x) => x.name === name)
  if (!t) return ''
  try {
    return await window.api.config.readCss(t.path)
  } catch {
    return ''
  }
}

let applySeq = 0

export async function applyTheme(s: Settings = useSettings.getState().settings): Promise<void> {
  const seq = ++applySeq
  const body = document.body
  const mode = effectiveMode(s)
  body.classList.toggle('theme-dark', mode === 'dark')
  body.classList.toggle('theme-light', mode === 'light')

  const { h, s: sat, l } = hexToHsl(s.accentColor || '#8a5cf5')
  body.style.setProperty('--accent-h', String(h))
  body.style.setProperty('--accent-s', `${sat}%`)
  body.style.setProperty('--accent-l', `${l}%`)

  const font = (v: string, fallback: string): string => (v.trim() ? `${v.trim()}, ${fallback}` : fallback)
  body.style.setProperty('--font-interface', font(s.interfaceFont, 'var(--font-interface-theme)'))
  body.style.setProperty('--font-text', font(s.textFont, 'var(--font-text-theme)'))
  body.style.setProperty('--font-monospace', font(s.monoFont, 'var(--font-monospace-theme)'))
  body.style.setProperty('--font-text-size', `${s.editorFontSize}px`)
  body.style.setProperty('--font-code-size', `${s.codeFontSize}px`)
  body.style.setProperty('--font-ui-medium', `${s.uiFontSize}px`)
  body.style.setProperty('--font-ui-small', `${s.uiFontSize - 1}px`)
  body.style.setProperty('--font-ui-smaller', `${s.uiFontSize - 2}px`)
  body.classList.toggle('readable-line-width', s.readableLineLength)
  body.classList.toggle('hide-ribbon', !s.showRibbon)
  body.classList.toggle('hide-status-bar', !s.showStatusBar)
  body.classList.toggle('show-inline-title', s.showInlineTitle)

  const css = await themeCss(s.theme)
  if (seq !== applySeq) return
  styleEl('cs2d3k-theme').textContent = css

  // snippets
  const snippets = await window.api.config.listSnippets()
  const parts: string[] = []
  for (const sn of snippets) {
    if (!s.enabledSnippets.includes(sn.name)) continue
    try {
      parts.push(`/* snippet: ${sn.name} */\n` + (await window.api.config.readCss(sn.path)))
    } catch {
      /* ignore */
    }
  }
  if (seq !== applySeq) return
  styleEl('cs2d3k-snippets').textContent = parts.join('\n\n')
  window.api.app.setTitleBarOverlay(resolveColor('var(--background-secondary)').slice(0, 7), resolveColor('var(--text-muted)').slice(0, 7))
  emit()
}

/** Wire theme to settings changes + system theme + css file changes. Returns cleanup. */
export function initTheme(): () => void {
  void applyTheme()
  let prev = useSettings.getState().settings
  const unsub = useSettings.subscribe((st) => {
    const s = st.settings
    const keys: (keyof Settings)[] = [
      'baseTheme', 'accentColor', 'theme', 'enabledSnippets', 'interfaceFont', 'textFont', 'monoFont', 'editorFontSize',
      'codeFontSize', 'uiFontSize', 'readableLineLength', 'showRibbon', 'showStatusBar', 'showInlineTitle'
    ]
    if (keys.some((k) => s[k] !== prev[k])) void applyTheme(s)
    prev = s
  })
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const onMq = (): void => {
    if (useSettings.getState().settings.baseTheme === 'system') void applyTheme()
  }
  mediaQuery.addEventListener('change', onMq)
  const unCss = window.api.config.onCssChange(() => void applyTheme())
  return () => {
    unsub()
    mediaQuery?.removeEventListener('change', onMq)
    unCss()
  }
}

/** Read a CSS variable's computed value from <body>. */
export function cssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

/** Resolve any CSS color expression to "#rrggbb" (or rgba string) via a probe element. */
export function resolveColor(expr: string): string {
  const probe = document.createElement('div')
  probe.style.color = expr
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c)
  if (!m) return '#888888'
  const hex = (n: string): string => Number(n).toString(16).padStart(2, '0')
  const a = m[4] !== undefined ? Math.round(Number(m[4]) * 255) : 255
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}${a < 255 ? a.toString(16).padStart(2, '0') : ''}`
}

/** Resolved palette for non-CSS consumers (Monaco, xterm, canvas2d). */
export function themePalette(): Record<string, string> {
  const vars = [
    'background-primary', 'background-primary-alt', 'background-secondary', 'background-secondary-alt', 'background-modifier-border',
    'background-modifier-hover', 'text-normal', 'text-muted', 'text-faint', 'text-accent', 'interactive-accent', 'text-selection',
    'code-background', 'code-normal', 'code-comment', 'code-keyword', 'code-string', 'code-number', 'code-function', 'code-type',
    'code-property', 'code-operator', 'code-tag', 'graph-node', 'graph-node-unresolved', 'graph-node-attachment', 'graph-node-tag',
    'graph-node-focused', 'graph-line', 'graph-text', 'graph-background', 'color-red', 'color-green', 'color-yellow', 'color-blue',
    'color-purple', 'color-cyan', 'color-orange', 'color-pink'
  ]
  const out: Record<string, string> = {}
  for (const v of vars) out[v] = resolveColor(`var(--${v})`)
  out.mode = document.body.classList.contains('theme-light') ? 'light' : 'dark'
  return out
}
