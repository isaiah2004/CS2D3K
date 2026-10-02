// Doc lens: the map as a structured "Project Definition" markdown document, with copy / export-to-note.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Check, FileOutput, ExternalLink, FolderPen } from 'lucide-react'
import type { LensProps } from '../context'
import type { FormMapData } from '../schema'
import { definitionMarkdown } from './definitionDoc'
import { setMeta } from './ops'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import { saveFile } from '@/lib/fileops'
import { fileExists } from '@/store/vault'
import { useWorkspace } from '@/store/workspace'
import { confirmDialog, notice, promptText } from '@/store/ui'
import { dirname, join, stem } from '@/lib/path'
import './widgets.css'
import './lenses.css'

/** last export time per map path (this session only) */
const exportedAt = new Map<string, number>()

const ago = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(t).toLocaleTimeString()
}

export default function DocLens({ ctl }: LensProps) {
  const data = ctl.data as FormMapData
  const mapName = stem(ctl.path)
  const md = useMemo(() => definitionMarkdown(data, mapName), [data, mapName])
  const exportPath = data.formmap?.exportPath
  const [copied, setCopied] = useState(false)
  const [lastExport, setLastExport] = useState<number | undefined>(() => exportedAt.get(ctl.path))
  const [, tick] = useState(0)
  useEffect(() => {
    if (!lastExport || !ctl.visible) return
    const t = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [lastExport, ctl.visible])

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const askPath = async (): Promise<string | null> => {
    const initial = exportPath || join(dirname(ctl.path), `${mapName} - Definition.md`)
    const p = await promptText({
      title: 'Export Project Definition',
      message: 'Vault path of the markdown note to write. Later exports overwrite it.',
      initial,
      selectStem: true,
      okLabel: 'Export',
      validate: (v) => (!v.trim() ? 'Enter a path' : !/\.md$/i.test(v.trim()) ? 'Must end with .md' : null)
    })
    if (!p) return null
    const path = p.trim().replace(/^\/+/, '')
    if (path !== exportPath && fileExists(path)) {
      const ok = await confirmDialog({ title: 'Overwrite note?', message: `“${path}” already exists. Exporting will replace its content.`, okLabel: 'Overwrite', danger: true })
      if (!ok) return null
    }
    setMeta(ctl, { exportPath: path })
    return path
  }

  const doExport = async (choose = false): Promise<void> => {
    const path = !exportPath || choose ? await askPath() : exportPath
    if (!path) return
    try {
      await saveFile(path, md)
      const t = Date.now()
      exportedAt.set(ctl.path, t)
      setLastExport(t)
      notice(`Exported to ${path}`, 'success')
    } catch (e) {
      notice(`Export failed: ${String(e)}`, 'error')
    }
  }

  const openNote = (): void => {
    if (exportPath) useWorkspace.getState().openFile(exportPath, { target: 'tab' })
  }

  return (
    <div className="fm-doc">
      <div className="fm-doc-bar">
        <div className="fm-doc-bar-title">
          <span className="fm-doc-bar-emoji">📄</span>
          Project Definition
          {exportPath && (
            <span className="fm-doc-bar-path" title={exportPath}>
              → {exportPath}
            </span>
          )}
        </div>
        <div className="fm-doc-bar-actions">
          {lastExport && <span className="fm-doc-bar-time">Exported {ago(lastExport)}</span>}
          <button className="btn" onClick={copy} title="Copy the markdown to the clipboard">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy markdown'}
          </button>
          {exportPath && (
            <button className="btn" onClick={openNote} title="Open the exported note" disabled={!fileExists(exportPath)}>
              <ExternalLink size={14} />
              Open note
            </button>
          )}
          {exportPath && (
            <button className="clickable-icon small" onClick={() => void doExport(true)} title="Change export path">
              <FolderPen />
            </button>
          )}
          <button className="btn mod-cta fm-doc-export" onClick={() => void doExport()} title={exportPath ? `Write to ${exportPath}` : 'Choose a note and write the definition'}>
            <FileOutput size={14} />
            Export to note
          </button>
        </div>
      </div>
      <div className="fm-doc-scroll">
        <div className="fm-doc-page">
          <MarkdownPreview source={md} sourcePath={ctl.path} className="fm-doc-md" />
        </div>
      </div>
    </div>
  )
}
