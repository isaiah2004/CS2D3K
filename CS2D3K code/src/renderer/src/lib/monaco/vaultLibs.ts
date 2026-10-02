// Cross-file IntelliSense: other TS/JS files of the vault are fed to the TypeScript worker as
// extra libs (under the same file:/// URIs the models use) so relative imports resolve.
import * as monaco from 'monaco-editor'
import { useVault } from '@/store/vault'

const SCRIPT_EXTS = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'])
const MAX_FILES = 300
const MAX_SIZE = 256 * 1024

const libs = new Map<string, monaco.IDisposable>()
let loading: Promise<void> | null = null

const uriFor = (path: string): string => monaco.Uri.from({ scheme: 'file', path: '/' + path }).toString()

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTS.has(path.split('.').pop()?.toLowerCase() ?? '')
}

function addLib(path: string, content: string): void {
  dropVaultLib(path)
  const uri = uriFor(path)
  const a = monaco.typescript.typescriptDefaults.addExtraLib(content, uri)
  const b = monaco.typescript.javascriptDefaults.addExtraLib(content, uri)
  libs.set(path, { dispose: () => (a.dispose(), b.dispose()) })
}

/** A model now owns this file — remove the lib copy so it isn't declared twice. */
export function dropVaultLib(path: string): void {
  libs.get(path)?.dispose()
  libs.delete(path)
}

/** The model of a file was disposed — keep its latest content visible to other files. */
export function restoreVaultLib(path: string, content: string): void {
  if (loading && isScriptPath(path) && content.length < MAX_SIZE) addLib(path, content)
}

/** Load the vault's script files once (lazily, when the first TS/JS file opens). */
export function loadVaultLibs(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    const files = Object.values(useVault.getState().files)
      .filter((f) => !f.isDir && SCRIPT_EXTS.has(f.ext) && f.size < MAX_SIZE && !/(^|\/)node_modules\//.test(f.path))
      .slice(0, MAX_FILES)
    for (const f of files) {
      if (monaco.editor.getModel(monaco.Uri.parse(uriFor(f.path)))) continue
      try {
        const content = await window.api.fs.readText(f.path)
        if (!monaco.editor.getModel(monaco.Uri.parse(uriFor(f.path)))) addLib(f.path, content)
      } catch {
        /* unreadable — skip */
      }
    }
  })()
  return loading
}
