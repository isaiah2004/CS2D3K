import {
  File,
  FileText,
  FileCode2,
  FileImage,
  FileJson,
  FileVideo,
  FileAudio,
  FileArchive,
  FileType,
  LayoutDashboard,
  Map as MapIcon,
  Waypoints,
  FileTerminal,
  Settings2,
  FileSpreadsheet,
  type LucideProps
} from 'lucide-react'
import { IMAGE_EXTS, MEDIA_EXTS } from '@/lib/filetypes'
import type { ViewType } from '@/lib/filetypes'

const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'lua',
  'swift', 'scala', 'dart', 'html', 'css', 'scss', 'less', 'vue', 'svelte', 'sql', 'r', 'zig', 'hs', 'ex', 'exs'
])

export function FileIcon({ ext, ...props }: { ext: string } & LucideProps) {
  if (ext === 'md') return <FileText {...props} />
  if (ext === 'canvas') return <LayoutDashboard {...props} />
  if (ext === 'formmap') return <MapIcon {...props} />
  if (ext === 'json' || ext === 'jsonc') return <FileJson {...props} />
  if (ext === 'pdf') return <FileType {...props} />
  if (ext === 'csv' || ext === 'tsv' || ext === 'xlsx') return <FileSpreadsheet {...props} />
  if (['sh', 'bash', 'ps1', 'bat', 'cmd', 'zsh'].includes(ext)) return <FileTerminal {...props} />
  if (['yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg'].includes(ext)) return <Settings2 {...props} />
  if (CODE.has(ext)) return <FileCode2 {...props} />
  if (IMAGE_EXTS.has(ext)) return <FileImage {...props} />
  if (MEDIA_EXTS.has(ext)) return ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) ? <FileAudio {...props} /> : <FileVideo {...props} />
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return <FileArchive {...props} />
  return <File {...props} />
}

export function ViewIcon({ type, ext, ...props }: { type: ViewType; ext?: string } & LucideProps) {
  if (type === 'graph') return <Waypoints {...props} />
  if (type === 'empty') return <File {...props} />
  return <FileIcon ext={ext ?? ''} {...props} />
}
