import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { DEFAULT_RUNNERS, killRun, newRunId, normalizeLang, run } from '../../../src/main/runner'
import { makeTempDir, removeDir } from './helpers'

const NODE = `"${process.execPath}" "{file}"`

interface FakeWc {
  wc: WebContents
  send: ReturnType<typeof vi.fn>
  destroyed: boolean
}

function fakeWebContents(): FakeWc {
  const fake = { send: vi.fn(), destroyed: false } as unknown as FakeWc
  fake.wc = { isDestroyed: () => fake.destroyed, send: fake.send } as unknown as WebContents
  return fake
}

const sameDir = (a: string, b: string): boolean => {
  const n = (p: string): string => fs.realpathSync.native(p.trim())
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

let cwd: string
let fake: FakeWc

beforeEach(() => {
  cwd = makeTempDir()
  fake = fakeWebContents()
})

afterEach(() => {
  removeDir(cwd)
})

describe('main/runner', () => {
  describe('normalizeLang', () => {
    it('maps aliases to canonical runner ids', () => {
      const cases: Record<string, string> = {
        javascript: 'js', mjs: 'js', cjs: 'js', node: 'js', jsx: 'js',
        typescript: 'ts', tsx: 'ts', mts: 'ts',
        py: 'python', python3: 'python',
        sh: 'bash', shell: 'bash', zsh: 'bash',
        ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
        cmd: 'bat', batch: 'bat',
        rb: 'ruby', golang: 'go', rs: 'rust', 'c++': 'cpp', cc: 'cpp'
      }
      for (const [alias, id] of Object.entries(cases)) expect(normalizeLang(alias), alias).toBe(id)
    })

    it('trims and lowercases the language', () => {
      expect(normalizeLang('  JavaScript ')).toBe('js')
      expect(normalizeLang('PYTHON')).toBe('python')
    })

    it('passes unknown languages through (normalized)', () => {
      expect(normalizeLang(' Haskell ')).toBe('haskell')
      expect(normalizeLang('')).toBe('')
    })

    it('every alias target has a default runner', () => {
      for (const alias of ['javascript', 'typescript', 'py', 'sh', 'ps', 'cmd', 'rb', 'golang', 'rs', 'c++']) {
        expect(DEFAULT_RUNNERS[normalizeLang(alias)], alias).toBeDefined()
      }
    })
  })

  describe('newRunId', () => {
    it('returns unique ids', () => {
      const ids = new Set(Array.from({ length: 100 }, () => newRunId()))
      expect(ids.size).toBe(100)
      for (const id of ids) expect(id).toMatch(/^r[0-9a-z]+$/)
    })
  })

  describe('run', () => {
    it('reports a missing runner for unknown languages without spawning anything', async () => {
      const res = await run(fake.wc, { lang: 'brainfuck', code: '+' }, cwd)
      expect(res).toMatchObject({ code: null, stdout: '', stderr: '', durationMs: 0 })
      expect(res.error).toMatch(/No runner configured for language "brainfuck"/)
      expect(res.runId).toBeTruthy()
      expect(fake.send).not.toHaveBeenCalled()
    })

    it('uses the given runId', async () => {
      const res = await run(fake.wc, { runId: 'my-id', lang: 'nope', code: '' }, cwd)
      expect(res.runId).toBe('my-id')
    })

    it('runs JavaScript with the default node runner', async () => {
      const res = await run(fake.wc, { lang: 'javascript', code: 'console.log(6 * 7)' }, cwd)
      expect(res.error).toBeUndefined()
      expect(res.code).toBe(0)
      expect(res.stdout.trim()).toBe('42')
      expect(res.durationMs).toBeGreaterThanOrEqual(0)
    }, 30000)

    it('captures stdout, stderr and the exit code', async () => {
      const code = "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 3"
      const res = await run(fake.wc, { lang: 'js', code, command: NODE }, cwd)
      expect(res).toMatchObject({ code: 3, stdout: 'out', stderr: 'err' })
    }, 30000)

    it('streams output to the renderer as it arrives', async () => {
      const res = await run(fake.wc, { runId: 'stream-1', lang: 'js', code: "console.log('a'); console.error('b')", command: NODE }, cwd)
      const sent = fake.send.mock.calls
      expect(sent.every((c) => c[0] === 'runner:output' && c[1] === 'stream-1')).toBe(true)
      expect(sent.filter((c) => c[2] === 'stdout').map((c) => c[3]).join('')).toBe(res.stdout)
      expect(sent.filter((c) => c[2] === 'stderr').map((c) => c[3]).join('')).toBe(res.stderr)
      expect(res.stdout.trim()).toBe('a')
      expect(res.stderr.trim()).toBe('b')
    }, 30000)

    it('does not stream to a destroyed window but still collects output', async () => {
      fake.destroyed = true
      const res = await run(fake.wc, { lang: 'js', code: "console.log('quiet')", command: NODE }, cwd)
      expect(res.stdout.trim()).toBe('quiet')
      expect(fake.send).not.toHaveBeenCalled()
    }, 30000)

    // regression: chunks used to be decoded one by one, so multi-byte characters split across chunks became U+FFFD
    it('decodes multi-byte UTF-8 output split across chunks', async () => {
      const code = "process.stdout.write('é✓🙂'.repeat(60000))"
      const res = await run(fake.wc, { lang: 'js', code, command: NODE }, cwd)
      expect(res.stdout.includes('�')).toBe(false)
      expect(res.stdout).toBe('é✓🙂'.repeat(60000))
    }, 30000)

    it('runs in the default cwd unless the request gives one', async () => {
      const code = 'console.log(process.cwd())'
      const a = await run(fake.wc, { lang: 'js', code, command: NODE }, cwd)
      expect(sameDir(a.stdout, cwd)).toBe(true)
      const other = makeTempDir()
      try {
        const b = await run(fake.wc, { lang: 'js', code, command: NODE, cwd: other }, cwd)
        expect(sameDir(b.stdout, other)).toBe(true)
      } finally {
        removeDir(other)
      }
    }, 30000)

    it('writes the code to a temp file with the runner extension and removes it afterwards', async () => {
      const res = await run(fake.wc, { lang: 'js', code: 'console.log(process.argv[1])', command: NODE }, cwd)
      const file = res.stdout.trim()
      expect(path.basename(file)).toBe('main.mjs')
      expect(fs.existsSync(path.dirname(file))).toBe(false)
    }, 30000)

    it('honours a custom extension and substitutes {dir}', async () => {
      const code = 'console.log(process.argv[1], process.argv[2])'
      const res = await run(fake.wc, { lang: 'js', code, ext: 'cjs', command: `"${process.execPath}" "{file}" "{dir}"` }, cwd)
      const [file, dir] = res.stdout.trim().split(' ')
      expect(path.basename(file)).toBe('main.cjs')
      expect(path.dirname(file)).toBe(dir)
    }, 30000)

    it('uses a custom command for languages without a default runner', async () => {
      const res = await run(fake.wc, { lang: 'mylang', code: 'console.log("custom")', ext: 'js', command: NODE }, cwd)
      expect(res.code).toBe(0)
      expect(res.stdout.trim()).toBe('custom')
    }, 30000)

    it('reports a non-zero exit code when the command does not exist', async () => {
      const res = await run(fake.wc, { lang: 'x', code: '', command: 'cs2d3k-definitely-not-a-command "{file}"' }, cwd)
      expect(res.code).not.toBe(0)
      expect(res.stderr.length).toBeGreaterThan(0)
    }, 30000)

    it('does not pass ELECTRON_RUN_AS_NODE to the child', async () => {
      const prev = process.env.ELECTRON_RUN_AS_NODE
      process.env.ELECTRON_RUN_AS_NODE = '1'
      try {
        const res = await run(fake.wc, { lang: 'js', code: 'console.log(String(process.env.ELECTRON_RUN_AS_NODE))', command: NODE }, cwd)
        expect(res.stdout.trim()).toBe('undefined')
      } finally {
        if (prev === undefined) delete process.env.ELECTRON_RUN_AS_NODE
        else process.env.ELECTRON_RUN_AS_NODE = prev
      }
    }, 30000)
  })

  describe('killRun', () => {
    it('stops a running program and resolves its run', async () => {
      const runId = newRunId()
      const code = "console.log('started'); setInterval(() => {}, 1000)"
      const pending = run(fake.wc, { runId, lang: 'js', code, command: NODE }, cwd)
      await vi.waitFor(() => expect(fake.send).toHaveBeenCalledWith('runner:output', runId, 'stdout', expect.stringContaining('started')), {
        timeout: 15000,
        interval: 50
      })
      killRun(runId)
      const res = await pending
      expect(res.code).not.toBe(0)
      expect(res.stdout).toContain('started')
    }, 30000)

    it('ignores unknown and finished run ids', async () => {
      expect(() => killRun('does-not-exist')).not.toThrow()
      const res = await run(fake.wc, { lang: 'js', code: '', command: NODE }, cwd)
      expect(() => killRun(res.runId)).not.toThrow()
    }, 30000)
  })
})
