import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { ViewType } from '@/lib/filetypes'
import type { ViewProps } from './types'
import { EmptyView, ImageView, PdfView, MediaView, BinaryView } from './MiscViews'

type ViewComponent = ComponentType<ViewProps> | LazyExoticComponent<ComponentType<ViewProps>>

const loaders = {
  markdown: () => import('./markdown/MarkdownView'),
  code: () => import('./code/CodeView'),
  canvas: () => import('./canvas/CanvasView'),
  formmap: () => import('./formmap/FormMapView'),
  graph: () => import('./graph/GraphView')
}

/** Load view modules in the background: makes first open instant and registers their commands. */
export function preloadViews(): void {
  for (const load of Object.values(loaders)) void load().catch(() => {})
}

export const VIEWS: Partial<Record<ViewType, ViewComponent>> = {
  markdown: lazy(loaders.markdown),
  code: lazy(loaders.code),
  canvas: lazy(loaders.canvas),
  formmap: lazy(loaders.formmap),
  graph: lazy(loaders.graph),
  image: ImageView,
  pdf: PdfView,
  media: MediaView,
  binary: BinaryView,
  empty: EmptyView
}
