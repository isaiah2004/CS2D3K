// Maps file extensions to the view that opens them and to editor languages.

export type ViewType = 'markdown' | 'code' | 'canvas' | 'formmap' | 'graph' | 'image' | 'pdf' | 'media' | 'binary' | 'empty'

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
export const MEDIA_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov'])
export const BINARY_EXTS = new Set([
  'zip', 'gz', 'tar', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'class',
  'jar', 'pyc', 'o', 'a', 'lib', 'obj', 'pdb', 'node', 'wasm', 'psd', 'sqlite', 'db'
])

/** extension -> Monaco language id */
export const MONACO_LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json',
  py: 'python', pyw: 'python',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', fs: 'fsharp',
  rb: 'ruby', php: 'php', lua: 'lua', r: 'r', pl: 'perl', dart: 'dart', ex: 'elixir', exs: 'elixir', clj: 'clojure',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', dockerfile: 'dockerfile', proto: 'protobuf',
  md: 'markdown', mdx: 'markdown', txt: 'plaintext', log: 'plaintext', csv: 'plaintext', tsv: 'plaintext',
  sol: 'sol', zig: 'plaintext', hs: 'plaintext', ml: 'plaintext', jl: 'julia', m: 'objective-c', tf: 'hcl', hcl: 'hcl'
}

export function viewTypeForExt(ext: string): ViewType {
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'canvas') return 'canvas'
  if (ext === 'formmap') return 'formmap'
  if (IMAGE_EXTS.has(ext) && ext !== 'svg') return 'image'
  if (ext === 'pdf') return 'pdf'
  if (MEDIA_EXTS.has(ext)) return 'media'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'code'
}

export function monacoLang(path: string): string {
  const name = path.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'plaintext'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return MONACO_LANGS[ext] ?? 'plaintext'
}

/** language names used in fenced code blocks -> runner lang */
export const RUNNABLE_LANGS = new Set([
  'js', 'javascript', 'mjs', 'node', 'ts', 'typescript', 'py', 'python', 'python3', 'sh', 'bash', 'shell', 'zsh',
  'ps1', 'powershell', 'pwsh', 'bat', 'cmd', 'rb', 'ruby', 'go', 'golang', 'rust', 'rs', 'c', 'cpp', 'c++', 'lua', 'php'
])

/** Map a fence language / extension to a Monaco language id */
export function monacoLangForFence(lang: string): string {
  const l = lang.toLowerCase()
  const aliases: Record<string, string> = {
    javascript: 'javascript', typescript: 'typescript', python: 'python', python3: 'python', node: 'javascript',
    shell: 'shell', powershell: 'powershell', pwsh: 'powershell', golang: 'go', rust: 'rust', 'c++': 'cpp', csharp: 'csharp',
    'c#': 'csharp', html: 'html', css: 'css', json: 'json', yaml: 'yaml', sql: 'sql', markdown: 'markdown', ruby: 'ruby'
  }
  return aliases[l] ?? MONACO_LANGS[l] ?? l
}

export function isTextLike(ext: string): boolean {
  const t = viewTypeForExt(ext)
  return t === 'markdown' || t === 'code' || t === 'canvas' || t === 'formmap'
}
