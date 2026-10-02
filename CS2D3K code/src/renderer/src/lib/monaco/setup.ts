// Monaco bootstrap: local bundle, Vite workers, TypeScript defaults and the app theme bridge.
// Imported lazily through `loadMonaco()` (./index.ts) the first time a code tab opens.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { onThemeChange } from '@/theme/theme'
import { buildMonacoTheme, monoFontFamily, MONACO_THEME } from './theme'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

// ------------------------------------------------------------- TypeScript / JavaScript

const ts = monaco.typescript
const compilerOptions: monaco.typescript.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  // 100 = ModuleResolutionKind.Bundler (not in Monaco's enum typings, supported by its TS version)
  moduleResolution: 100 as monaco.typescript.ModuleResolutionKind,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['esnext', 'dom', 'dom.iterable'],
  allowJs: true,
  checkJs: false,
  strict: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  allowNonTsExtensions: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  isolatedModules: true,
  skipLibCheck: true,
  noEmit: true
}
// noisy in a vault without node_modules: missing modules / node types / declaration files, and the
// implicit-any errors that unresolved imports cause in callbacks
const IGNORED_DIAGNOSTICS = [2307, 2792, 2580, 2591, 2584, 7016, 2868, 2867, 1375, 1378, 2686, 7006, 7031]
for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  d.setCompilerOptions(compilerOptions)
  d.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: IGNORED_DIAGNOSTICS })
  d.setEagerModelSync(true)
}
ts.javascriptDefaults.setCompilerOptions({ ...compilerOptions, strict: false })

// ------------------------------------------------------------- theme bridge

/** live editors, so font changes can be pushed to them */
export const liveEditors = new Set<monaco.editor.IStandaloneCodeEditor>()

function applyTheme(): void {
  monaco.editor.defineTheme(MONACO_THEME, buildMonacoTheme())
  monaco.editor.setTheme(MONACO_THEME)
  const fontFamily = monoFontFamily()
  for (const ed of liveEditors) {
    if (ed.getOption(monaco.editor.EditorOption.fontFamily) !== fontFamily) ed.updateOptions({ fontFamily })
  }
}
applyTheme()
onThemeChange(() => {
  applyTheme()
  // fonts may have changed: let Monaco measure character widths again
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts())
})
// webfonts loading after the first editor measured them would misplace the cursor
void document.fonts.ready.then(() => monaco.editor.remeasureFonts())

export { monaco }
export * from './models'
export { loadVaultLibs, isScriptPath } from './vaultLibs'
export { monoFontFamily }
