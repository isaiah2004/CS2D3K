// .canvas view: the canvas engine with its own document and no extension.
import type { ViewProps } from '../types'
import { useCanvasDoc } from './useCanvasDoc'
import CanvasEngine from './CanvasEngine'

export default function CanvasView({ tab, visible, focused }: ViewProps) {
  const path = tab.path ?? ''
  const doc = useCanvasDoc(path)
  return <CanvasEngine tab={tab} visible={visible} focused={focused} doc={doc} path={path} />
}
