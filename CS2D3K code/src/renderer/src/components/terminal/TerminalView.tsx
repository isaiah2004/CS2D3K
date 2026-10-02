// One xterm.js terminal connected to a pty in the main process.
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Copy, ClipboardPaste, Eraser, TextSelect, Trash2 } from 'lucide-react'
import { useSettings, getSettings } from '@/store/settings'
import { useVault } from '@/store/vault'
import { showContextMenu } from '@/store/ui'
import { nextTerminalCwd } from '@/lib/terminalCwd'
import { isMac } from '@/lib/util'
import { onThemeChange, cssVar } from '@/theme/theme'
import { xtermTheme } from './xtermTheme'
import { attachPty, killTerminalTab, markFocused, prepareRouting, registerTerminal, takeShell } from './registry'

interface Props {
  tabId: string
  /** the tab is active and the panel is open */
  visible: boolean
}

interface TermState {
  term: Terminal
  fit: FitAddon
  ptyId: string | null
  exited: boolean
  disposed: boolean
}

// Nerd Font fallbacks so fancy prompts (oh-my-posh, starship, p10k) render when one is installed
const SYMBOL_FONTS = "'Symbols Nerd Font Mono', 'CaskaydiaCove Nerd Font Mono', 'CaskaydiaCove NF', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'FiraCode Nerd Font Mono'"
const monoFont = (): string => `${cssVar('--font-monospace') || 'Consolas, monospace'}, ${SYMBOL_FONTS}`

function copySelection(term: Terminal): void {
  const text = term.getSelection()
  if (text) void navigator.clipboard.writeText(text)
}

function pasteInto(term: Terminal): void {
  void navigator.clipboard.readText().then((t) => {
    if (t) term.paste(t)
  })
}

export default function TerminalView({ tabId, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stRef = useRef<TermState | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const host = hostRef.current!
    const s = getSettings()
    const term = new Terminal({
      fontFamily: monoFont(),
      fontSize: s.terminalFontSize,
      cursorBlink: s.terminalCursorBlink,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      theme: xtermTheme(),
      scrollback: 10000,
      lineHeight: 1.15,
      macOptionIsMeta: true,
      drawBoldTextInBrightColors: true,
      allowTransparency: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    const st: TermState = { term, fit, ptyId: null, exited: false, disposed: false }
    stRef.current = st

    const safeFit = (): void => {
      if (st.disposed || host.clientWidth < 20 || host.clientHeight < 20) return
      try {
        fit.fit()
      } catch {
        /* not measurable yet */
      }
    }
    requestAnimationFrame(safeFit)

    // ------------------------------------------------ pty
    let detach = (): void => {}
    const onExit = (code: number): void => {
      st.exited = true
      st.ptyId = null
      term.write(`\r\n\x1b[2m[Process exited with code ${code}] — press any key to close\x1b[0m`)
    }
    prepareRouting()
    const cwd = nextTerminalCwd.take() ?? useVault.getState().info?.path ?? undefined
    const shell = takeShell(tabId) || s.terminalShell.trim() || undefined
    window.api.term.create({ cwd, shell, cols: term.cols, rows: term.rows }).then(
      (id) => {
        if (st.disposed) {
          window.api.term.kill(id)
          return
        }
        st.ptyId = id
        detach = attachPty(id, (d) => term.write(d), onExit)
        // the size may have changed while the shell was spawning
        window.api.term.resize(id, term.cols, term.rows)
      },
      (err: Error) => {
        if (st.disposed) return
        st.exited = true
        term.write(`\x1b[31mFailed to start ${shell ? `"${shell}"` : 'the shell'}: ${err.message}\x1b[0m\r\n\x1b[2mPress any key to close\x1b[0m`)
      }
    )

    const subs = [
      term.onData((d) => {
        if (st.exited) {
          killTerminalTab(tabId)
          return
        }
        if (st.ptyId) window.api.term.write(st.ptyId, d)
      }),
      term.onResize(({ cols, rows }) => {
        if (st.ptyId) window.api.term.resize(st.ptyId, cols, rows)
      })
    ]

    // ------------------------------------------------ keys: copy / paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = isMac() ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && !e.altKey && key === 'c' && (term.hasSelection() || e.shiftKey)) {
        copySelection(term)
        e.preventDefault()
        return false
      }
      if (mod && !e.altKey && key === 'v') {
        pasteInto(term)
        e.preventDefault()
        return false
      }
      return true
    })

    // ------------------------------------------------ resize, theme, settings
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(safeFit, 40)
    })
    ro.observe(host)

    const unTheme = onThemeChange(() => {
      term.options.theme = xtermTheme()
      const f = monoFont()
      if (term.options.fontFamily !== f) {
        term.options.fontFamily = f
        safeFit()
      }
    })
    const unSettings = useSettings.subscribe((state, prev) => {
      const a = state.settings
      const b = prev.settings
      if (a.terminalFontSize !== b.terminalFontSize) {
        term.options.fontSize = a.terminalFontSize
        safeFit()
      }
      if (a.terminalCursorBlink !== b.terminalCursorBlink) term.options.cursorBlink = a.terminalCursorBlink
    })

    const onFocusIn = (): void => markFocused(tabId)
    host.addEventListener('focusin', onFocusIn)

    const unregister = registerTerminal(tabId, {
      clear: () => term.clear(),
      focus: () => term.focus(),
      exited: () => st.exited
    })

    // webfonts may finish loading after the first measurement
    void document.fonts.ready.then(() => {
      if (st.disposed) return
      term.options.fontFamily = monoFont()
      safeFit()
    })

    return () => {
      st.disposed = true
      if (fitTimer) clearTimeout(fitTimer)
      ro.disconnect()
      unTheme()
      unSettings()
      unregister()
      host.removeEventListener('focusin', onFocusIn)
      subs.forEach((d) => d.dispose())
      detach()
      if (st.ptyId) window.api.term.kill(st.ptyId)
      term.dispose()
      stRef.current = null
    }
  }, [tabId])

  // fit + focus when the tab becomes visible
  useEffect(() => {
    const st = stRef.current
    if (!visible || !st) return
    const raf = requestAnimationFrame(() => {
      const host = hostRef.current
      if (!host || st.disposed || host.clientWidth < 20) return
      try {
        st.fit.fit()
      } catch {
        /* ignore */
      }
      st.term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible])

  const onContextMenu = (e: React.MouseEvent): void => {
    const st = stRef.current
    if (!st) return
    const { term } = st
    showContextMenu(e, [
      { label: 'Copy', icon: <Copy />, disabled: !term.hasSelection(), onClick: () => copySelection(term) },
      { label: 'Paste', icon: <ClipboardPaste />, onClick: () => pasteInto(term) },
      { label: 'Select all', icon: <TextSelect />, onClick: () => term.selectAll() },
      { separator: true },
      { label: 'Clear', icon: <Eraser />, onClick: () => term.clear() },
      { label: 'Kill terminal', icon: <Trash2 />, danger: true, onClick: () => killTerminalTab(tabId) }
    ])
  }

  return <div className="terminal-host" ref={hostRef} onContextMenu={onContextMenu} />
}
