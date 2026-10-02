import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { Vault } from './vault'
import { getState, setState, touchRecent, removeRecent } from './store'
import { createTerminal, writeTerminal, resizeTerminal, killTerminal, killAllTerminals } from './terminal'
import { run, killRun, killAllRuns, newRunId } from './runner'
import pkg from '../../package.json'

app.setName('CS2D3K')

// test / automation hooks
if (process.env.CS2D3K_USER_DATA) app.setPath('userData', process.env.CS2D3K_USER_DATA)
// benchmark mode: uncap the frame rate so measured FPS shows real headroom instead of the display's vsync
if (process.env.CS2D3K_BENCH === '1') {
  app.commandLine.appendSwitch('disable-frame-rate-limit')
  app.commandLine.appendSwitch('disable-gpu-vsync')
  app.commandLine.appendSwitch('enable-precise-memory-info')
}

// no bypassCSP: vault files are only allowed where the page CSP lists `vault:` (never as scripts)
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let win: BrowserWindow | null = null
let vault: Vault | null = null
/** the last vault, opened while the window starts up (see `prefetchLastVault`) */
let eager: { path: string; opened: Promise<{ path: string; name: string }> } | null = null

/** caches the renderer reads while a vault opens (prefetched together with the file list) */
const PREFETCH_CACHES = ['metadata']
/** test hook: delay every batch read by this many ms (listing the vault: 10×) so the loading screen stays up long
 * enough to inspect */
const READ_DELAY = process.env.CS2D3K_TEST === '1' ? Number(process.env.CS2D3K_READ_DELAY) || 0 : 0

function requireVault(): Vault {
  if (!vault) throw new Error('No vault open')
  return vault
}

function createWindow(): void {
  const st = getState().window
  win = new BrowserWindow({
    width: st?.width ?? 1400,
    height: st?.height ?? 900,
    x: st?.x,
    y: st?.y,
    minWidth: 700,
    minHeight: 450,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'CS2D3K',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: '#262626', symbolColor: '#bababa', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  if (st?.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

  const saveBounds = (): void => {
    if (!win || win.isDestroyed()) return
    const b = win.getNormalBounds()
    setState({ window: { ...b, maximized: win.isMaximized() } })
  }
  win.on('close', saveBounds)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The app is a single page: the window never navigates away from it. A link, form or <meta refresh> in a
  // note must not load another page (it would get the preload's window.api). Web links open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    const current = win?.webContents.getURL().split('#')[0]
    if (current && url.split('#')[0] === current) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  // reload / renderer crash: the renderer forgot its terminals and runs, so stop them
  // (did-navigate = committed main-frame load; navigations blocked above never get here)
  win.webContents.on('did-navigate', () => {
    killAllTerminals()
    killAllRuns()
  })
  win.webContents.on('render-process-gone', () => {
    killAllTerminals()
    killAllRuns()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openVault(absPath: string): Promise<{ path: string; name: string }> {
  if (!existsSync(absPath)) mkdirSync(absPath, { recursive: true })
  if (vault) {
    await vault.idle()
    await vault.dispose()
  }
  killAllTerminals()
  killAllRuns()
  vault = new Vault(absPath)
  const v = vault
  // finish any save interrupted by a crash before the renderer reads the vault
  const restored = await v.recoverInterruptedWrites()
  if (restored.length) console.warn('recovered interrupted saves:', restored)
  // another vault was opened meanwhile (e.g. the prefetched last vault while the renderer opened a different one)
  if (vault !== v) throw new Error(`Opening ${v.name} was superseded`)
  v.startWatching(
    (events) => {
      if (vault === v && win && !win.isDestroyed()) win.webContents.send('fs:change', events)
    },
    () => {
      if (vault === v && win && !win.isDestroyed()) win.webContents.send('config:css-change')
    }
  )
  // the renderer lists the vault and reads the metadata cache next: start both now
  v.prefetch(PREFETCH_CACHES)
  touchRecent(v.root, v.name)
  win?.setTitle(`${v.name} - CS2D3K`)
  return { path: v.root, name: v.name }
}

function lastVaultPath(): string | null {
  const p = process.env.CS2D3K_VAULT || getState().lastVault
  return p && existsSync(p) ? p : null
}

/**
 * Opens the last vault while the window and the renderer are still starting, so listing the files and reading the
 * metadata cache overlap with them. The renderer's `vault:open` for the same path then picks up this result.
 */
function prefetchLastVault(): void {
  const p = lastVaultPath()
  if (!p) return
  const opened = openVault(p)
  opened.catch(() => {})
  eager = { path: resolve(p), opened }
}

type Handler = (e: IpcMainInvokeEvent, ...args: any[]) => unknown
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, fn)
}

function registerIpc(): void {
  // app
  handle('app:recent', () => getState().recentVaults)
  handle('app:removeRecent', (_e, p: string) => removeRecent(p))
  handle('app:lastVault', () => lastVaultPath())
  handle('app:pickFolder', async (_e, title?: string) => {
    const r = await dialog.showOpenDialog(win!, { title: title ?? 'Choose folder', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  handle('app:openExternal', (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url)
    return undefined
  })
  handle('app:version', () => pkg.version)
  handle('app:toggleDevTools', (e) => e.sender.toggleDevTools())
  handle('app:reload', (e) => e.sender.reload())
  ipcMain.on('app:titleBarOverlay', (_e, color: string, symbolColor: string) => {
    if (process.platform === 'darwin' || !win || win.isDestroyed()) return
    try {
      win.setTitleBarOverlay({ color, symbolColor, height: 36 })
    } catch {
      /* not supported */
    }
  })

  // vault
  handle('vault:open', (_e, p: string) => {
    const pre = eager
    eager = null
    if (pre && pre.path === resolve(p))
      return pre.opened.then((info) => {
        // opened before the window existed
        win?.setTitle(`${info.name} - CS2D3K`)
        return info
      })
    return openVault(p)
  })
  handle('vault:create', (_e, parent: string, name: string) => {
    eager = null
    return openVault(join(parent, name))
  })
  handle('vault:close', async () => {
    eager = null
    await vault?.idle()
    await vault?.dispose()
    vault = null
    killAllTerminals()
    killAllRuns()
    setState({ lastVault: null })
    win?.setTitle('CS2D3K')
  })
  handle('vault:current', () => (vault ? { path: vault.root, name: vault.name } : null))

  // fs
  handle('fs:list', async () => {
    const v = requireVault()
    if (READ_DELAY) await new Promise((r) => setTimeout(r, READ_DELAY * 10))
    return v.takeList()
  })
  handle('fs:readText', (_e, p: string) => requireVault().readText(p))
  handle('fs:writeText', (_e, p: string, c: string) => requireVault().writeText(p, c))
  handle('fs:createFile', (_e, p: string, c?: string) => requireVault().createFile(p, c))
  handle('fs:mkdir', (_e, p: string) => requireVault().mkdir(p))
  handle('fs:rename', (_e, a: string, b: string) => requireVault().rename(a, b))
  handle('fs:trash', (_e, p: string) => requireVault().trash(p))
  handle('fs:copy', (_e, a: string, b: string) => requireVault().copy(a, b))
  handle('fs:exists', (_e, p: string) => requireVault().exists(p))
  handle('fs:stat', (_e, p: string) => requireVault().stat(p))
  handle('fs:readAll', (_e, exts: string[]) => requireVault().readAll(exts))
  handle('fs:readMany', async (_e, paths: string[]) => {
    const v = requireVault()
    if (READ_DELAY) await new Promise((r) => setTimeout(r, READ_DELAY))
    return v.readMany(paths)
  })
  handle('fs:search', (_e, opts) => requireVault().search(opts))
  handle('fs:absPath', (_e, p: string) => requireVault().abs(p))
  handle('fs:showInFolder', (_e, p: string) => shell.showItemInFolder(requireVault().abs(p)))
  handle('fs:openDefault', (_e, p: string) => shell.openPath(requireVault().abs(p)))

  // config
  handle('config:read', (_e, n: string) => (vault ? vault.readConfig(n) : null))
  handle('config:write', (_e, n: string, d: unknown) => requireVault().writeConfig(n, d))
  handle('config:listThemes', () => (vault ? vault.listThemes() : []))
  handle('config:listSnippets', () => (vault ? vault.listSnippets() : []))
  handle('config:readCss', (_e, p: string) => requireVault().readCss(p))
  handle('config:openFolder', async (_e, sub: string) => {
    if (sub !== 'themes' && sub !== 'snippets') throw new Error(`Unknown config folder: ${sub}`)
    const dir = requireVault().configPath(sub)
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // caches
  handle('cache:read', (_e, n: string) => (vault ? vault.takeCache(n) : null))
  handle('cache:write', (_e, n: string, text: string) => requireVault().writeCache(n, text))

  // terminal
  handle('term:create', (e, opts) => createTerminal(e.sender, opts, vault?.root ?? app.getPath('home')))
  ipcMain.on('term:write', (_e, id: string, d: string) => writeTerminal(id, d))
  ipcMain.on('term:resize', (_e, id: string, c: number, r: number) => resizeTerminal(id, c, r))
  ipcMain.on('term:kill', (_e, id: string) => killTerminal(id))

  // runner
  handle('runner:run', (e, req) => run(e.sender, req, vault?.root ?? app.getPath('home')))
  ipcMain.on('runner:kill', (_e, id: string) => killRun(id))
  ipcMain.on('runner:newId', (e) => {
    e.returnValue = newRunId()
  })
}

// file system work doesn't need Electron to be ready: start on the last vault while Electron and the window start
prefetchLastVault()

app.whenReady().then(() => {
  protocol.handle('vault', (req) => {
    try {
      const url = new URL(req.url)
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(requireVault().abs(rel)).toString())
    } catch (e) {
      return new Response(String(e), { status: 404 })
    }
  })
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllTerminals()
  killAllRuns()
  // let saves flushed by the closing window finish before the process exits
  const v = vault
  void (v ? v.idle().then(() => v.dispose()) : Promise.resolve()).finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})


