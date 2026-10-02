import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, join, stem, isChildOf, uniquePath, validateName } from '@/lib/path'

describe('lib/path', () => {
  it('splits paths', () => {
    expect(basename('a/b/c.md')).toBe('c.md')
    expect(dirname('a/b/c.md')).toBe('a/b')
    expect(dirname('c.md')).toBe('')
    expect(extname('a/B.MD')).toBe('md')
    expect(extname('.gitignore')).toBe('')
    expect(stem('a/b/c.tar.gz')).toBe('c.tar')
  })
  it('joins and normalizes', () => {
    expect(join('a', 'b/../c', './d.md')).toBe('a/c/d.md')
    expect(join('', 'x')).toBe('x')
  })
  it('detects children', () => {
    expect(isChildOf('a/b', 'a')).toBe(true)
    expect(isChildOf('ab', 'a')).toBe(false)
    expect(isChildOf('anything', '')).toBe(true)
  })
  it('makes unique paths', () => {
    const taken = new Set(['Untitled.md', 'Untitled 1.md'])
    expect(uniquePath('Untitled.md', (p) => taken.has(p))).toBe('Untitled 2.md')
  })
  it('validates names', () => {
    expect(validateName('ok name')).toBeNull()
    expect(validateName('')).toMatch(/empty/)
    expect(validateName('a/b')).toMatch(/cannot contain/)
    expect(validateName('.hidden')).toMatch(/dot/)
  })
})

describe('lib/path edge cases', () => {
  it('basename and dirname handle empty strings and trailing slashes', () => {
    expect(basename('')).toBe('')
    expect(dirname('')).toBe('')
    expect(basename('a/b/')).toBe('')
    expect(dirname('a/b/')).toBe('a/b')
  })
  it('extname ignores dots in folder names and handles trailing dots', () => {
    expect(extname('dir.v2/file')).toBe('')
    expect(extname('file.')).toBe('')
    expect(extname('a/b/c.tar.gz')).toBe('gz')
  })
  it('stem keeps dotfiles and extension-less names whole', () => {
    expect(stem('.gitignore')).toBe('.gitignore')
    expect(stem('dir.v2/README')).toBe('README')
    expect(stem('Note.md')).toBe('Note')
  })
  it('join drops leading, trailing and duplicate slashes', () => {
    expect(join('/a/', '//b//', 'c/')).toBe('a/b/c')
  })
  it('join never climbs above the vault root', () => {
    expect(join('a', '../../..', 'b')).toBe('b')
    expect(join('..')).toBe('')
  })
  it('join of nothing is the vault root', () => {
    expect(join()).toBe('')
    expect(join('', '.')).toBe('')
  })
  it('isChildOf treats a path as a child of itself but not of a sibling prefix', () => {
    expect(isChildOf('a', 'a')).toBe(true)
    expect(isChildOf('a/b/c', 'a/b')).toBe(true)
    expect(isChildOf('a/bc', 'a/b')).toBe(false)
    expect(isChildOf('a', 'a/b')).toBe(false)
  })
  it('uniquePath returns the desired path when it is free', () => {
    expect(uniquePath('x.md', () => false)).toBe('x.md')
  })
  it('uniquePath keeps the folder and handles names without extension', () => {
    const taken = new Set(['notes/Untitled.md', 'Folder'])
    expect(uniquePath('notes/Untitled.md', (p) => taken.has(p))).toBe('notes/Untitled 1.md')
    expect(uniquePath('Folder', (p) => taken.has(p))).toBe('Folder 1')
  })
  it('uniquePath gives up and returns the desired path when everything is taken', () => {
    expect(uniquePath('x.md', () => true)).toBe('x.md')
  })
  it('validateName rejects whitespace-only names and every reserved character', () => {
    expect(validateName('   ')).toMatch(/empty/)
    for (const c of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) expect(validateName(`a${c}b`)).toMatch(/cannot contain/)
  })
  it('validateName accepts unicode, dots inside and spaces', () => {
    expect(validateName('Über notes v1.2')).toBeNull()
  })
})
