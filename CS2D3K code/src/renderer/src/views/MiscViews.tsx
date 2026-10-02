import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize, ExternalLink } from 'lucide-react'
import type { ViewProps } from './types'
import { executeCommand, hotkeysFor, formatHotkey, useCommands } from '@/store/commands'
import { useVault } from '@/store/vault'
import { ViewHeaderActions } from '@/components/Slots'
import { formatBytes } from '@/lib/util'
import { extname } from '@/lib/path'

export function EmptyView(_: ViewProps) {
  // re-render once commands are registered so hotkey hints show up
  useCommands((s) => s.commands)
  const items: [string, string][] = [
    ['file:new-note', 'Create new note'],
    ['app:quick-switcher', 'Go to file'],
    ['canvas:new', 'Create new canvas'],
    ['graph:open', 'Open graph view'],
    ['terminal:toggle', 'Open terminal'],
    ['tab:close', 'Close']
  ]
  return (
    <div className="empty-view">
      <h2>No file is open</h2>
      {items.map(([cmd, label]) => (
        <div key={cmd} className="empty-action" onClick={() => executeCommand(cmd)}>
          {label}
          {hotkeysFor(cmd)[0] && <kbd>{formatHotkey(hotkeysFor(cmd)[0])}</kbd>}
        </div>
      ))}
    </div>
  )
}

function useFileUrl(path?: string): string {
  const mtime = useVault((s) => (path ? s.files[path]?.mtime : 0))
  return path ? `${window.api.fs.resourceUrl(path)}?v=${Math.round(mtime ?? 0)}` : ''
}

export function ImageView({ tab }: ViewProps) {
  const url = useFileUrl(tab.path)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const size = useVault((s) => (tab.path ? s.files[tab.path]?.size : 0))
  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', background: 'var(--background-primary)', position: 'relative' }}>
      <ViewHeaderActions>
        <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-ui-smaller)', marginRight: 8 }}>
          {dims && `${dims.w} × ${dims.h} · `}
          {formatBytes(size ?? 0)}
        </span>
        <button className="clickable-icon small" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))}>
          <ZoomOut />
        </button>
        <button className="clickable-icon small" title="Zoom in" onClick={() => setZoom((z) => Math.min(10, (z === 'fit' ? 1 : z) * 1.25))}>
          <ZoomIn />
        </button>
        <button className="clickable-icon small" title="Fit" onClick={() => setZoom('fit')}>
          <Maximize />
        </button>
      </ViewHeaderActions>
      <img
        src={url}
        alt=""
        onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={
          zoom === 'fit'
            ? { maxWidth: '100%', maxHeight: '100%', margin: 'auto', objectFit: 'contain' }
            : { width: (dims?.w ?? 0) * zoom, margin: 'auto', flexShrink: 0 }
        }
      />
    </div>
  )
}

export function PdfView({ tab }: ViewProps) {
  const url = useFileUrl(tab.path)
  return <iframe src={url} style={{ flex: 1, border: 'none', width: '100%', height: '100%' }} title={tab.path} />
}

export function MediaView({ tab }: ViewProps) {
  const url = useFileUrl(tab.path)
  const audio = ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extname(tab.path ?? ''))
  const ref = useRef<HTMLMediaElement>(null)
  useEffect(() => () => ref.current?.pause(), [])
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {audio ? (
        <audio ref={ref as React.RefObject<HTMLAudioElement>} src={url} controls style={{ width: '80%' }} />
      ) : (
        <video ref={ref as React.RefObject<HTMLVideoElement>} src={url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
      )}
    </div>
  )
}

export function BinaryView({ tab }: ViewProps) {
  const f = useVault((s) => (tab.path ? s.files[tab.path] : undefined))
  return (
    <div className="empty-view">
      <h2>{f?.name}</h2>
      <div>This file type can't be displayed. ({formatBytes(f?.size ?? 0)})</div>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => tab.path && window.api.fs.openWithDefaultApp(tab.path)}>
        <ExternalLink size={14} /> Open in default app
      </button>
    </div>
  )
}
