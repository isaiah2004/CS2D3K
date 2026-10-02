// Vault path helpers. Paths are forward-slash, vault-relative, no leading slash.

export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase()
}

/** basename without extension */
export function stem(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? b : b.slice(0, i)
}

export function join(...parts: string[]): string {
  const out: string[] = []
  for (const part of parts) {
    for (const seg of part.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') out.pop()
      else out.push(seg)
    }
  }
  return out.join('/')
}

export function isChildOf(child: string, parent: string): boolean {
  if (!parent) return true
  return child === parent || child.startsWith(parent + '/')
}

/** Picks a non-colliding path like "Untitled 2.md" */
export function uniquePath(desired: string, exists: (p: string) => boolean): string {
  if (!exists(desired)) return desired
  const dir = dirname(desired)
  const ext = extname(desired)
  const base = stem(desired)
  for (let i = 1; i < 10000; i++) {
    const cand = join(dir, `${base} ${i}${ext ? '.' + ext : ''}`)
    if (!exists(cand)) return cand
  }
  return desired
}

export const INVALID_NAME_CHARS = /[\\/:*?"<>|]/

export function validateName(name: string): string | null {
  if (!name.trim()) return 'Name cannot be empty'
  if (INVALID_NAME_CHARS.test(name)) return 'Name cannot contain \\ / : * ? " < > |'
  if (name.startsWith('.')) return 'Name cannot start with a dot'
  return null
}
