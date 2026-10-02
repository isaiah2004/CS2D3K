import { spawn, type ChildProcess } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WebContents } from 'electron'
import type { RunRequest, RunResult } from '@shared/types'

interface LangSpec {
  ext: string
  command: string
}

/** Default commands. `{file}` = temp source file, `{dir}` = its folder. */
export const DEFAULT_RUNNERS: Record<string, LangSpec> = {
  js: { ext: 'mjs', command: 'node "{file}"' },
  ts: { ext: 'ts', command: 'node "{file}"' },
  python: { ext: 'py', command: process.platform === 'win32' ? 'python "{file}"' : 'python3 "{file}"' },
  bash: { ext: 'sh', command: 'bash "{file}"' },
  powershell: { ext: 'ps1', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "{file}"' },
  bat: { ext: 'bat', command: 'cmd /c "{file}"' },
  ruby: { ext: 'rb', command: 'ruby "{file}"' },
  go: { ext: 'go', command: 'go run "{file}"' },
  rust: { ext: 'rs', command: 'rustc "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  c: { ext: 'c', command: 'gcc "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  cpp: { ext: 'cpp', command: 'g++ "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  lua: { ext: 'lua', command: 'lua "{file}"' },
  php: { ext: 'php', command: 'php "{file}"' }
}

const ALIASES: Record<string, string> = {
  javascript: 'js', mjs: 'js', cjs: 'js', node: 'js', jsx: 'js',
  typescript: 'ts', tsx: 'ts', mts: 'ts',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  cmd: 'bat', batch: 'bat',
  rb: 'ruby', golang: 'go', rs: 'rust', 'c++': 'cpp', cc: 'cpp'
}

export function normalizeLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  return ALIASES[l] ?? l
}

const running = new Map<string, ChildProcess>()
let counter = 0

export function newRunId(): string {
  return `r${Date.now().toString(36)}${(++counter).toString(36)}`
}

export function run(wc: WebContents, req: RunRequest, defaultCwd: string): Promise<RunResult> {
  const runId = req.runId || newRunId()
  const lang = normalizeLang(req.lang)
  const spec = DEFAULT_RUNNERS[lang]
  const command = req.command?.trim() || spec?.command
  const started = Date.now()
  if (!command) {
    return Promise.resolve({
      runId,
      code: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      error: `No runner configured for language "${req.lang}". Add one in Settings → Code runner.`
    })
  }
  const dir = mkdtempSync(join(tmpdir(), 'cs2d3k-run-'))
  const ext = req.ext || spec?.ext || lang
  const file = join(dir, `main.${ext}`)
  writeFileSync(file, req.code, 'utf8')
  const cmd = command.split('{file}').join(file).split('{dir}').join(dir)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const env = { ...process.env, FORCE_COLOR: '0', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(cmd, { cwd: req.cwd || defaultCwd, shell: true, env, windowsHide: true })
    running.set(runId, child)
    const send = (stream: 'stdout' | 'stderr', data: string): void => {
      if (!wc.isDestroyed()) wc.send('runner:output', runId, stream, data)
    }
    // decode as streams so multi-byte characters split across chunks stay intact
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (s: string) => {
      stdout += s
      send('stdout', s)
    })
    child.stderr?.on('data', (s: string) => {
      stderr += s
      send('stderr', s)
    })
    const done = (code: number | null, error?: string): void => {
      if (!running.has(runId)) return
      running.delete(runId)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      resolve({ runId, code, stdout, stderr, durationMs: Date.now() - started, error })
    }
    child.on('error', (e) => done(null, e.message))
    child.on('close', (code) => done(code))
  })
}

export function killRun(runId: string): void {
  const c = running.get(runId)
  if (!c) return
  if (process.platform === 'win32' && c.pid) {
    spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }).on('error', () => c.kill())
  } else {
    c.kill('SIGTERM')
  }
}

/** Stop every running snippet (vault closed, window reloaded or quitting). */
export function killAllRuns(): void {
  for (const id of [...running.keys()]) killRun(id)
}
