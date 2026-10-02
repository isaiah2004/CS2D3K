import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** Fresh temp directory under the OS temp dir (never inside the repo). */
export function makeTempDir(prefix = 'cs2d3k-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removeDir(dir: string | undefined): void {
  if (!dir) return
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    /* best effort (Windows may still hold a handle briefly) */
  }
}

/** Write `{ 'rel/path': content }` fixtures under `root`, creating folders as needed. */
export function writeTree(root: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

/**
 * Temp dir whose names are case-sensitive: plain temp dir where the FS already is, otherwise (Windows) try enabling
 * NTFS per-directory case sensitivity. Returns null when that isn't possible.
 */
export function makeCaseSensitiveDir(): string | null {
  const dir = makeTempDir('cs2d3k-cs-')
  if (process.platform === 'win32') {
    try {
      execFileSync('fsutil', ['file', 'setCaseSensitiveInfo', dir, 'enable'], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* not supported here */
    }
  }
  fs.writeFileSync(path.join(dir, 'CaseProbe'), '')
  const sensitive = !fs.existsSync(path.join(dir, 'caseprobe'))
  fs.rmSync(path.join(dir, 'CaseProbe'))
  if (sensitive) return dir
  removeDir(dir)
  return null
}

/** True when the temp dir's file system treats names case-insensitively (Windows, default macOS). */
export function isCaseInsensitiveFs(): boolean {
  const dir = makeTempDir('cs2d3k-case-')
  try {
    fs.writeFileSync(path.join(dir, 'CaseProbe'), '')
    return fs.existsSync(path.join(dir, 'caseprobe'))
  } finally {
    removeDir(dir)
  }
}
