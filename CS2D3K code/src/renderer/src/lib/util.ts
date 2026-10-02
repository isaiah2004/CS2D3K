let idCounter = 0

/** short random id, unique per session */
export function uid(prefix = ''): string {
  idCounter = (idCounter + 1) % 1e6
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + idCounter.toString(36)
}

/** 16 hex chars like JSON Canvas node ids */
export function hexId(): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { flush(): void; cancel(): void } {
  let t: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null
  const d = (...args: A): void => {
    lastArgs = args
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      const a = lastArgs!
      lastArgs = null
      fn(...a)
    }, ms)
  }
  d.flush = (): void => {
    if (t) {
      clearTimeout(t)
      t = null
      const a = lastArgs!
      lastArgs = null
      fn(...a)
    }
  }
  d.cancel = (): void => {
    if (t) clearTimeout(t)
    t = null
    lastArgs = null
  }
  return d
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Simple fuzzy scorer: returns score (higher better) and matched indices, or null. */
export function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const indices: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    if (c === ' ') continue
    const found = t.indexOf(c, ti)
    if (found < 0) return null
    indices.push(found)
    // contiguous bonus, word-start bonus
    if (found === prev + 1) score += 5
    if (found === 0 || /[\s/_\-.]/.test(t[found - 1])) score += 8
    score -= Math.min(found - ti, 10) * 0.5
    prev = found
    ti = found + 1
  }
  // shorter targets rank higher; exact substring big bonus
  const sub = t.indexOf(q)
  if (sub >= 0) score += 20 + (sub === 0 ? 10 : 0)
  score -= t.length * 0.05
  return { score, indices }
}

export function isMac(): boolean {
  return window.api?.platform === 'darwin'
}
