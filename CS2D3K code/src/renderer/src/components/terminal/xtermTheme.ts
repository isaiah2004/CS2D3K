// xterm.js theme derived from the app palette.
import type { ITheme } from '@xterm/xterm'
import { themePalette } from '@/theme/theme'

function solid(c: string): string {
  return c.length > 7 ? c.slice(0, 7) : c
}

/** mix two "#rrggbb" colors; t = weight of b */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export function xtermTheme(p: Record<string, string> = themePalette()): ITheme {
  const dark = p.mode !== 'light'
  const bg = solid(p['background-primary'])
  const fg = solid(p['text-normal'])
  const c = (k: string): string => solid(p[`color-${k}`])
  // light themes: darken the palette a bit for contrast on white; dark: brighten the "bright" set
  const base = (k: string): string => (dark ? c(k) : mix(c(k), '#000000', 0.15))
  const bright = (k: string): string => (dark ? mix(c(k), '#ffffff', 0.25) : c(k))
  return {
    background: bg,
    foreground: fg,
    cursor: solid(p['interactive-accent']),
    cursorAccent: bg,
    selectionBackground: p['text-selection'],
    selectionInactiveBackground: p['text-selection'].length > 7 ? solid(p['text-selection']) + '40' : p['text-selection'],
    scrollbarSliderBackground: solid(p['text-faint']) + '4d',
    scrollbarSliderHoverBackground: solid(p['text-faint']) + '80',
    scrollbarSliderActiveBackground: solid(p['text-faint']) + 'a6',
    overviewRulerBorder: bg,
    black: dark ? mix(bg, '#000000', 0.3) : fg,
    red: base('red'),
    green: base('green'),
    yellow: base('yellow'),
    blue: base('blue'),
    magenta: base('purple'),
    cyan: base('cyan'),
    white: dark ? solid(p['text-muted']) : solid(p['text-faint']),
    brightBlack: solid(p['text-faint']),
    brightRed: bright('red'),
    brightGreen: bright('green'),
    brightYellow: bright('yellow'),
    brightBlue: bright('blue'),
    brightMagenta: bright('pink'),
    brightCyan: bright('cyan'),
    brightWhite: dark ? fg : solid(p['text-muted'])
  }
}
