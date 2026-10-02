import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDir, removeDir } from './helpers'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? userData.dir : path.join(userData.dir, name)) }
}))

type Store = typeof import('../../../src/main/store')

let root: string
let store: Store

const stateFile = (): string => path.join(userData.dir, 'cs2d3k-state.json')
const onDisk = (): any => JSON.parse(fs.readFileSync(stateFile(), 'utf8'))

/** fresh module instance (the store caches its state in module scope) */
async function load(): Promise<Store> {
  vi.resetModules()
  return import('../../../src/main/store')
}

beforeEach(async () => {
  root = makeTempDir()
  userData.dir = path.join(root, 'userData')
  store = await load()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeDir(root)
})

describe('main/store', () => {
  describe('getState / setState', () => {
    it('starts with defaults when nothing is persisted', () => {
      expect(store.getState()).toEqual({ recentVaults: [], lastVault: null })
    })

    it('starts with defaults when the state file is corrupt', async () => {
      fs.mkdirSync(userData.dir, { recursive: true })
      fs.writeFileSync(stateFile(), '{ nope')
      store = await load()
      expect(store.getState()).toEqual({ recentVaults: [], lastVault: null })
    })

    it('fills in missing keys from defaults', async () => {
      fs.mkdirSync(userData.dir, { recursive: true })
      fs.writeFileSync(stateFile(), JSON.stringify({ window: { width: 800, height: 600 } }))
      store = await load()
      expect(store.getState()).toEqual({ recentVaults: [], lastVault: null, window: { width: 800, height: 600 } })
    })

    it('persists patches to disk, creating the userData folder', () => {
      store.setState({ window: { width: 1, height: 2, maximized: true } })
      expect(onDisk()).toEqual({ recentVaults: [], lastVault: null, window: { width: 1, height: 2, maximized: true } })
    })

    it('merges patches with the current state', () => {
      store.setState({ lastVault: '/a' })
      store.setState({ window: { width: 1, height: 2 } })
      expect(store.getState()).toMatchObject({ lastVault: '/a', window: { width: 1, height: 2 } })
    })

    it('reloads persisted state in a new session', async () => {
      store.touchRecent('/vaults/a', 'a')
      store = await load()
      expect(store.getState().lastVault).toBe('/vaults/a')
      expect(store.getState().recentVaults.map((v) => v.path)).toEqual(['/vaults/a'])
    })

    it('keeps the in-memory state when writing to disk fails', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(userData.dir, 'a file, not a folder')
      store.setState({ lastVault: '/x' })
      expect(store.getState().lastVault).toBe('/x')
      expect(err).toHaveBeenCalled()
    })
  })

  describe('touchRecent', () => {
    it('adds the vault to the front and makes it the last vault', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1000)
      store.touchRecent('/vaults/a', 'a')
      vi.setSystemTime(2000)
      store.touchRecent('/vaults/b', 'b')
      expect(store.getState()).toEqual({
        recentVaults: [
          { path: '/vaults/b', name: 'b', lastOpened: 2000 },
          { path: '/vaults/a', name: 'a', lastOpened: 1000 }
        ],
        lastVault: '/vaults/b'
      })
      expect(onDisk()).toEqual(store.getState())
    })

    it('moves an already-known vault to the front without duplicating it', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1000)
      store.touchRecent('/vaults/a', 'a')
      store.touchRecent('/vaults/b', 'b')
      vi.setSystemTime(5000)
      store.touchRecent('/vaults/a', 'renamed')
      const list = store.getState().recentVaults
      expect(list.map((v) => v.path)).toEqual(['/vaults/a', '/vaults/b'])
      expect(list[0]).toEqual({ path: '/vaults/a', name: 'renamed', lastOpened: 5000 })
    })

    it('keeps at most 20 recent vaults, dropping the oldest', () => {
      for (let i = 0; i < 25; i++) store.touchRecent(`/vaults/${i}`, `v${i}`)
      const list = store.getState().recentVaults
      expect(list).toHaveLength(20)
      expect(list[0].path).toBe('/vaults/24')
      expect(list[19].path).toBe('/vaults/5')
    })

    it('preserves unrelated state such as the window bounds', () => {
      store.setState({ window: { width: 10, height: 20 } })
      store.touchRecent('/vaults/a', 'a')
      expect(store.getState().window).toEqual({ width: 10, height: 20 })
    })
  })

  describe('removeRecent', () => {
    it('removes the vault from the recent list', () => {
      store.touchRecent('/vaults/a', 'a')
      store.touchRecent('/vaults/b', 'b')
      store.removeRecent('/vaults/a')
      expect(store.getState().recentVaults.map((v) => v.path)).toEqual(['/vaults/b'])
      expect(onDisk().recentVaults.map((v: { path: string }) => v.path)).toEqual(['/vaults/b'])
    })

    it('clears lastVault when removing the last opened vault', () => {
      store.touchRecent('/vaults/a', 'a')
      store.touchRecent('/vaults/b', 'b')
      store.removeRecent('/vaults/b')
      expect(store.getState().lastVault).toBeNull()
    })

    it('keeps lastVault when removing another vault', () => {
      store.touchRecent('/vaults/a', 'a')
      store.touchRecent('/vaults/b', 'b')
      store.removeRecent('/vaults/a')
      expect(store.getState().lastVault).toBe('/vaults/b')
    })

    it('is a no-op for unknown vaults', () => {
      store.touchRecent('/vaults/a', 'a')
      const before = store.getState()
      store.removeRecent('/vaults/zzz')
      expect(store.getState()).toEqual(before)
    })
  })
})
