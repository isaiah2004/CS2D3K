import { contextBridge, ipcRenderer } from 'electron'
import type { Cs2d3kApi } from '@shared/api'

const inv = ipcRenderer.invoke.bind(ipcRenderer)

function sub<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const l = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, l)
  return () => ipcRenderer.removeListener(channel, l)
}

const api: Cs2d3kApi = {
  testMode: process.env.CS2D3K_TEST === '1',
  platform: process.platform,
  app: {
    getRecentVaults: () => inv('app:recent'),
    removeRecentVault: (p) => inv('app:removeRecent', p),
    pickFolder: (t) => inv('app:pickFolder', t),
    openExternal: (u) => inv('app:openExternal', u),
    getLastVault: () => inv('app:lastVault'),
    getVersion: () => inv('app:version'),
    toggleDevTools: () => inv('app:toggleDevTools'),
    reload: () => inv('app:reload'),
    setTitleBarOverlay: (c, sc) => ipcRenderer.send('app:titleBarOverlay', c, sc)
  },
  vault: {
    open: (p) => inv('vault:open', p),
    create: (parent, name) => inv('vault:create', parent, name),
    close: () => inv('vault:close'),
    current: () => inv('vault:current')
  },
  fs: {
    list: () => inv('fs:list'),
    readText: (p) => inv('fs:readText', p),
    writeText: (p, c) => inv('fs:writeText', p, c),
    createFile: (p, c) => inv('fs:createFile', p, c),
    mkdir: (p) => inv('fs:mkdir', p),
    rename: (a, b) => inv('fs:rename', a, b),
    trash: (p) => inv('fs:trash', p),
    copy: (a, b) => inv('fs:copy', a, b),
    exists: (p) => inv('fs:exists', p),
    stat: (p) => inv('fs:stat', p),
    readAll: (e) => inv('fs:readAll', e),
    readMany: (p) => inv('fs:readMany', p),
    search: (o) => inv('fs:search', o),
    absPath: (p) => inv('fs:absPath', p),
    resourceUrl: (p) => 'vault://local/' + p.split('/').map(encodeURIComponent).join('/'),
    showInFolder: (p) => inv('fs:showInFolder', p),
    openWithDefaultApp: (p) => inv('fs:openDefault', p),
    onChange: (cb) => sub('fs:change', cb)
  },
  config: {
    read: (n) => inv('config:read', n),
    write: (n, d) => inv('config:write', n, d),
    listThemes: () => inv('config:listThemes'),
    listSnippets: () => inv('config:listSnippets'),
    readCss: (p) => inv('config:readCss', p),
    openFolder: (s) => inv('config:openFolder', s),
    onCssChange: (cb) => sub('config:css-change', cb)
  },
  cache: {
    read: (n) => inv('cache:read', n),
    write: (n, t) => inv('cache:write', n, t)
  },
  term: {
    create: (o) => inv('term:create', o),
    write: (id, d) => ipcRenderer.send('term:write', id, d),
    resize: (id, c, r) => ipcRenderer.send('term:resize', id, c, r),
    kill: (id) => ipcRenderer.send('term:kill', id),
    onData: (cb) => sub('term:data', cb),
    onExit: (cb) => sub('term:exit', cb)
  },
  runner: {
    run: (r) => inv('runner:run', r),
    kill: (id) => ipcRenderer.send('runner:kill', id),
    onOutput: (cb) => sub('runner:output', cb),
    newRunId: () => ipcRenderer.sendSync('runner:newId')
  }
}

contextBridge.exposeInMainWorld('api', api)
