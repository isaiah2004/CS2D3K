import type { WebContents } from 'electron'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import type { TerminalCreateOptions } from '@shared/types'

type Pty = import('@lydell/node-pty').IPty

const terms = new Map<string, Pty>()
let counter = 0

function findOnPath(exe: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, exe)
    if (existsSync(p)) return p
  }
  return null
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    // prefer PowerShell 7 (standard install, then anywhere on PATH), then Windows PowerShell
    const std = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    if (existsSync(std)) return std
    return findOnPath('pwsh.exe') ?? 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

export async function createTerminal(wc: WebContents, opts: TerminalCreateOptions, fallbackCwd: string): Promise<string> {
  const pty = await import('@lydell/node-pty')
  const id = `t${++counter}`
  const shell = opts.shell?.trim() || defaultShell()
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : fallbackCwd
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  env.TERM_PROGRAM = 'CS2D3K'
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols | 0),
    rows: Math.max(2, opts.rows | 0),
    cwd,
    env
  })
  terms.set(id, p)
  p.onData((d) => {
    if (!wc.isDestroyed()) wc.send('term:data', id, d)
  })
  p.onExit(({ exitCode }) => {
    terms.delete(id)
    if (!wc.isDestroyed()) wc.send('term:exit', id, exitCode)
  })
  return id
}

export function writeTerminal(id: string, data: string): void {
  terms.get(id)?.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  try {
    terms.get(id)?.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
  } catch {
    /* pty may have exited */
  }
}

export function killTerminal(id: string): void {
  const p = terms.get(id)
  if (!p) return
  terms.delete(id)
  try {
    p.kill()
  } catch {
    /* ignore */
  }
}

export function killAllTerminals(): void {
  for (const id of [...terms.keys()]) killTerminal(id)
}
