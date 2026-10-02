import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { RecentVault } from '@shared/types'

interface AppState {
  recentVaults: RecentVault[]
  lastVault: string | null
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean }
}

const defaults: AppState = { recentVaults: [], lastVault: null }

function file(): string {
  return join(app.getPath('userData'), 'cs2d3k-state.json')
}

let cache: AppState | null = null

export function getState(): AppState {
  if (cache) return cache
  try {
    cache = { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    cache = { ...defaults }
  }
  return cache!
}

export function setState(patch: Partial<AppState>): void {
  cache = { ...getState(), ...patch }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file(), JSON.stringify(cache, null, 2))
  } catch (e) {
    console.error('failed to persist state', e)
  }
}

export function touchRecent(path: string, name: string): void {
  const list = getState().recentVaults.filter((v) => v.path !== path)
  list.unshift({ path, name, lastOpened: Date.now() })
  setState({ recentVaults: list.slice(0, 20), lastVault: path })
}

export function removeRecent(path: string): void {
  const s = getState()
  setState({
    recentVaults: s.recentVaults.filter((v) => v.path !== path),
    lastVault: s.lastVault === path ? null : s.lastVault
  })
}
