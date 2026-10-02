// Theme helpers: resolve CSS variables to colors as the user sees them.
import type { Page } from '@playwright/test'

/** resolve `var(--name)` on <body> to "#rrggbb" through a probe element */
export function cssColor(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${n})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
    return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : c
  }, name)
}

/** raw (computed) value of a custom property on <body> */
export function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), name)
}

/** max per-channel distance between two "#rrggbb" colors */
export function colorDistance(a: string, b: string): number {
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return Math.max(...[0, 1, 2].map((i) => Math.abs(ch(a, i) - ch(b, i))))
}
