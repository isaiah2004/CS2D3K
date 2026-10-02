// Mouse / drag & drop / context-menu behavior of the markdown editor.
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { Scissors, Copy, ClipboardPaste, Bold, Italic, Code, Link, ListChecks, ExternalLink, Play, Highlighter, Strikethrough } from 'lucide-react'
import { openLinkText } from '@/lib/fileops'
import { emit } from '@/lib/events'
import { IMAGE_EXTS, RUNNABLE_LANGS } from '@/lib/filetypes'
import { extname } from '@/lib/path'
import { formatHotkey } from '@/store/commands'
import { linkTextFor } from '@/store/metadata'
import { showContextMenu, type MenuItem } from '@/store/ui'
import { useWorkspace } from '@/store/workspace'
import { notePath, livePreview } from './state'
import { toggleWrap, insertWikiLink, toggleChecklist } from './formatting'
import { fencedCodeAt, runCodeBlockAt, codeBlockInfo } from './codeRun'

/** MIME type used by the file explorer for dragged vault paths (newline separated). */
export const FILE_MIME = 'application/x-cs2d3k-file'

const isMod = (e: MouseEvent): boolean => e.ctrlKey || e.metaKey

export function openHref(href: string, external: boolean, sourcePath: string, newTab: boolean): void {
  if (external) void window.api.app.openExternal(href)
  else void openLinkText(href, sourcePath, newTab)
}

export function searchTag(tag: string): void {
  useWorkspace.getState().revealPane('search')
  setTimeout(() => emit('focus-search', { query: `#${tag}` }), 30)
}

/** Inserts links to the given vault paths at `pos` (images become embeds). */
export function insertFileLinks(view: EditorView, paths: string[], pos: number): void {
  const text = paths.map((p) => `${IMAGE_EXTS.has(extname(p)) ? '!' : ''}[[${linkTextFor(p)}]]`).join('\n')
  view.dispatch({ changes: { from: pos, insert: text }, selection: EditorSelection.cursor(pos + text.length), userEvent: 'input.drop' })
  view.focus()
}

async function paste(view: EditorView): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    view.dispatch(view.state.replaceSelection(text))
  } catch {
    view.focus()
    document.execCommand('paste')
  }
}

function contextMenu(e: MouseEvent, view: EditorView): void {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
  const sel = view.state.selection.main
  // move the cursor to the click (keeps rendered links rendered: don't reveal their source)
  const onRendered = !!(e.target as HTMLElement).closest('.cm-lp-link, .cm-lp-tag')
  if (pos !== null && !onRendered && (pos < sel.from || pos > sel.to)) view.dispatch({ selection: EditorSelection.cursor(pos) })
  const path = view.state.facet(notePath)
  const target = e.target as HTMLElement
  const linkEl = target.closest<HTMLElement>('[data-href]')
  const hasSel = !view.state.selection.main.empty
  const run = (fn: (v: EditorView) => unknown) => () => {
    fn(view)
    view.focus()
  }
  const items: MenuItem[] = []
  if (linkEl) {
    const href = linkEl.dataset.href!
    const external = linkEl.dataset.external !== undefined
    items.push(
      { label: 'Open link', icon: <ExternalLink />, onClick: () => openHref(href, external, path, false) },
      ...(external ? [] : [{ label: 'Open link in new tab', onClick: () => openHref(href, false, path, true) }]),
      { label: 'Copy link', icon: <Copy />, onClick: () => void navigator.clipboard.writeText(href) },
      { separator: true }
    )
  }
  const code = pos !== null ? fencedCodeAt(view.state, pos) : null
  if (code) {
    const { lang } = codeBlockInfo(view.state, code)
    if (RUNNABLE_LANGS.has(lang.toLowerCase())) {
      items.push({ label: 'Run code block', icon: <Play />, hint: formatHotkey('Mod+Shift+Enter'), onClick: run((v) => runCodeBlockAt(v, code.from)) }, { separator: true })
    }
  }
  items.push(
    {
      label: 'Cut',
      icon: <Scissors />,
      hint: formatHotkey('Mod+X'),
      disabled: !hasSel,
      onClick: () => {
        const r = view.state.selection.main
        void navigator.clipboard.writeText(view.state.sliceDoc(r.from, r.to))
        view.dispatch({ changes: { from: r.from, to: r.to }, userEvent: 'delete.cut' })
        view.focus()
      }
    },
    {
      label: 'Copy',
      icon: <Copy />,
      hint: formatHotkey('Mod+C'),
      disabled: !hasSel,
      onClick: () => {
        const r = view.state.selection.main
        void navigator.clipboard.writeText(view.state.sliceDoc(r.from, r.to))
        view.focus()
      }
    },
    { label: 'Paste', icon: <ClipboardPaste />, hint: formatHotkey('Mod+V'), onClick: () => void paste(view) },
    { separator: true },
    { label: 'Bold', icon: <Bold />, hint: formatHotkey('Mod+B'), onClick: run((v) => toggleWrap(v, '**')) },
    { label: 'Italic', icon: <Italic />, hint: formatHotkey('Mod+I'), onClick: run((v) => toggleWrap(v, '*')) },
    { label: 'Code', icon: <Code />, onClick: run((v) => toggleWrap(v, '`')) },
    {
      label: 'More formatting',
      submenu: [
        { label: 'Strikethrough', icon: <Strikethrough />, onClick: run((v) => toggleWrap(v, '~~')) },
        { label: 'Highlight', icon: <Highlighter />, onClick: run((v) => toggleWrap(v, '==')) },
        { label: 'Comment', onClick: run((v) => toggleWrap(v, '%%')) }
      ]
    },
    { separator: true },
    { label: 'Insert link', icon: <Link />, hint: formatHotkey('Mod+K'), onClick: run(insertWikiLink) },
    { label: 'Toggle checklist', icon: <ListChecks />, hint: formatHotkey('Mod+L'), onClick: run(toggleChecklist) }
  )
  showContextMenu(e, items)
}

export const editorInteractions = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = e.target as HTMLElement
    if (e.button === 2 && target.closest('.cm-lp-link, .cm-lp-tag')) {
      // right-click on a rendered link: keep the caret where it is so the link stays rendered
      e.preventDefault()
      return true
    }
    if (e.button !== 0 && e.button !== 1) return false
    const live = view.state.facet(livePreview)
    const path = view.state.facet(notePath)
    const link = target.closest<HTMLElement>('[data-href]')
    if (link && view.contentDOM.contains(link) && (isMod(e) || e.button === 1 || (live && link.classList.contains('cm-lp-link')))) {
      // Live Preview: click follows; Mod+click / middle click opens in a new tab. Source mode: Mod+click follows.
      e.preventDefault()
      const external = link.dataset.external !== undefined
      const newTab = e.button === 1 || (live && isMod(e))
      openHref(link.dataset.href!, external, path, newTab)
      return true
    }
    const tag = target.closest<HTMLElement>('[data-tag]')
    if (tag && e.button === 0 && (isMod(e) || (live && tag.classList.contains('cm-lp-tag')))) {
      e.preventDefault()
      searchTag(tag.dataset.tag!)
      return true
    }
    return false
  },
  contextmenu(e, view) {
    contextMenu(e, view)
    return true
  },
  dragover(e) {
    if (!e.dataTransfer?.types.includes(FILE_MIME)) return false
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    return false
  },
  drop(e, view) {
    const data = e.dataTransfer?.getData(FILE_MIME)
    if (!data) return false
    e.preventDefault()
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
    insertFileLinks(view, data.split('\n').filter(Boolean), pos)
    return true
  }
})
