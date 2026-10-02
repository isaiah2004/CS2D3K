import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUi, notice, promptText, confirmDialog, showContextMenu, type MenuItem } from '@/store/ui'

const ui = () => useUi.getState()

beforeEach(() => {
  useUi.setState({ menu: null, notices: [], prompt: null, confirm: null, modal: null, settingsTab: 'editor', renaming: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('store/ui context menu', () => {
  const items: MenuItem[] = [{ label: 'Open' }, { separator: true }]

  it('showMenu accepts a mouse position or plain coordinates', () => {
    ui().showMenu({ clientX: 10, clientY: 20 }, items)
    expect(ui().menu).toEqual({ x: 10, y: 20, items })
    ui().showMenu({ x: 5, y: 6 }, items)
    expect(ui().menu).toEqual({ x: 5, y: 6, items })
  })

  it('closeMenu hides it', () => {
    ui().showMenu({ x: 1, y: 1 }, items)
    ui().closeMenu()
    expect(ui().menu).toBeNull()
  })

  it('showContextMenu opens at the pointer and consumes the native event', () => {
    const e = new MouseEvent('contextmenu', { clientX: 30, clientY: 40, cancelable: true, bubbles: true })
    const stop = vi.spyOn(e, 'stopPropagation')
    showContextMenu(e, items)
    expect(ui().menu).toEqual({ x: 30, y: 40, items })
    expect(e.defaultPrevented).toBe(true)
    expect(stop).toHaveBeenCalled()
  })
})

describe('store/ui modals and renaming', () => {
  it('openModal remembers the settings tab until another is requested', () => {
    ui().openModal('settings', 'hotkeys')
    expect(ui()).toMatchObject({ modal: 'settings', settingsTab: 'hotkeys' })
    ui().closeModal()
    expect(ui().modal).toBeNull()
    ui().openModal('settings')
    expect(ui().settingsTab).toBe('hotkeys')
    ui().openModal('palette')
    expect(ui().modal).toBe('palette')
  })

  it('setRenaming tracks the path being renamed inline', () => {
    ui().setRenaming('a.md')
    expect(ui().renaming).toBe('a.md')
    ui().setRenaming(null)
    expect(ui().renaming).toBeNull()
  })
})

describe('store/ui notices', () => {
  it('shows a notice and removes it after the timeout', () => {
    vi.useFakeTimers()
    notice('Saved', 'success', 1000)
    notice('Hello')
    expect(ui().notices.map((n) => [n.message, n.kind])).toEqual([
      ['Saved', 'success'],
      ['Hello', 'info']
    ])
    vi.advanceTimersByTime(1000)
    expect(ui().notices.map((n) => n.message)).toEqual(['Hello'])
    vi.advanceTimersByTime(3000)
    expect(ui().notices).toEqual([])
  })

  it('gives each notice a unique id', () => {
    vi.useFakeTimers()
    notice('a')
    notice('a')
    const [x, y] = ui().notices
    expect(x.id).not.toBe(y.id)
  })
})

describe('store/ui promptText', () => {
  it('publishes the request and resolves with the entered value', async () => {
    const p = promptText({ title: 'Rename', initial: 'a.md', selectStem: true })
    const req = ui().prompt!
    expect(req).toMatchObject({ title: 'Rename', initial: 'a.md', selectStem: true })
    expect(req.id).toBeTruthy()
    req.resolve('b.md')
    await expect(p).resolves.toBe('b.md')
  })

  it('resolves with null when cancelled', async () => {
    const p = promptText({ title: 'Name' })
    ui().prompt!.resolve(null)
    await expect(p).resolves.toBeNull()
  })

  it('a newer prompt cancels a pending one instead of leaving it hanging', async () => {
    const first = promptText({ title: 'First' })
    const second = promptText({ title: 'Second' })
    await expect(first).resolves.toBeNull()
    expect(ui().prompt!.title).toBe('Second')
    ui().prompt!.resolve('ok')
    await expect(second).resolves.toBe('ok')
  })
})

describe('store/ui confirmDialog', () => {
  it('resolves true when confirmed', async () => {
    const p = confirmDialog({ title: 'Delete', message: 'Sure?', danger: true })
    expect(ui().confirm).toMatchObject({ title: 'Delete', message: 'Sure?', danger: true })
    ui().confirm!.resolve(true)
    await expect(p).resolves.toBe(true)
  })

  it('resolves false when cancelled', async () => {
    const p = confirmDialog({ title: 'Delete', message: 'Sure?' })
    ui().confirm!.resolve(false)
    await expect(p).resolves.toBe(false)
  })

  it('a newer confirmation cancels a pending one', async () => {
    const first = confirmDialog({ title: 'A', message: '' })
    confirmDialog({ title: 'B', message: '' })
    await expect(first).resolves.toBe(false)
    expect(ui().confirm!.title).toBe('B')
  })
})
