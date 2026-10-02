import { describe, expect, it } from 'vitest'
import { isTextLike, monacoLang, monacoLangForFence, RUNNABLE_LANGS, viewTypeForExt } from '@/lib/filetypes'

describe('lib/filetypes viewTypeForExt', () => {
  it('maps notes, canvases and form maps to their views', () => {
    expect(viewTypeForExt('md')).toBe('markdown')
    expect(viewTypeForExt('markdown')).toBe('markdown')
    expect(viewTypeForExt('canvas')).toBe('canvas')
    expect(viewTypeForExt('formmap')).toBe('formmap')
  })
  it('maps media and documents to viewer views', () => {
    expect(viewTypeForExt('png')).toBe('image')
    expect(viewTypeForExt('pdf')).toBe('pdf')
    expect(viewTypeForExt('mp4')).toBe('media')
    expect(viewTypeForExt('zip')).toBe('binary')
  })
  it('opens svg as editable code rather than an image', () => {
    expect(viewTypeForExt('svg')).toBe('code')
  })
  it('falls back to the code view for unknown or missing extensions', () => {
    expect(viewTypeForExt('ts')).toBe('code')
    expect(viewTypeForExt('weird')).toBe('code')
    expect(viewTypeForExt('')).toBe('code')
  })
})

describe('lib/filetypes isTextLike', () => {
  it('is true for anything opened in a text-based view', () => {
    expect(['md', 'canvas', 'formmap', 'py', 'svg', ''].map(isTextLike)).toEqual([true, true, true, true, true, true])
  })
  it('is false for images, pdfs, media and binaries', () => {
    expect(['png', 'pdf', 'mp3', 'exe'].map(isTextLike)).toEqual([false, false, false, false])
  })
})

describe('lib/filetypes monacoLang', () => {
  it('maps file extensions case-insensitively', () => {
    expect(monacoLang('src/App.TSX')).toBe('typescript')
    expect(monacoLang('a/b/script.py')).toBe('python')
    expect(monacoLang('x.yml')).toBe('yaml')
  })
  it('recognizes Dockerfile and Makefile by name', () => {
    expect(monacoLang('deploy/Dockerfile')).toBe('dockerfile')
    expect(monacoLang('Makefile')).toBe('plaintext')
  })
  it('treats dotfiles by their name as extension', () => {
    expect(monacoLang('.env')).toBe('ini')
  })
  it('falls back to plaintext', () => {
    expect(monacoLang('README')).toBe('plaintext')
    expect(monacoLang('file.unknownext')).toBe('plaintext')
  })
})

describe('lib/filetypes monacoLangForFence', () => {
  it('maps fence aliases to monaco ids', () => {
    expect(monacoLangForFence('Python3')).toBe('python')
    expect(monacoLangForFence('node')).toBe('javascript')
    expect(monacoLangForFence('c#')).toBe('csharp')
    expect(monacoLangForFence('c++')).toBe('cpp')
    expect(monacoLangForFence('golang')).toBe('go')
  })
  it('maps fence extensions through the extension table', () => {
    expect(monacoLangForFence('ts')).toBe('typescript')
    expect(monacoLangForFence('sh')).toBe('shell')
  })
  it('passes unknown languages through lowercased', () => {
    expect(monacoLangForFence('Mermaid')).toBe('mermaid')
  })
})

describe('lib/filetypes RUNNABLE_LANGS', () => {
  it('contains common runnable fence languages and excludes data formats', () => {
    for (const l of ['js', 'ts', 'python', 'bash', 'powershell', 'go', 'rust', 'c++']) expect(RUNNABLE_LANGS.has(l)).toBe(true)
    for (const l of ['json', 'yaml', 'markdown', 'html']) expect(RUNNABLE_LANGS.has(l)).toBe(false)
  })
})
