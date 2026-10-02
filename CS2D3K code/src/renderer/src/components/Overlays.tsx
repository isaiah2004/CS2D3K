import { lazy, Suspense } from 'react'
import { useUi } from '@/store/ui'
import ContextMenu from './ContextMenu'
import { PromptModal, ConfirmModal } from './Dialogs'
import CommandPalette from './CommandPalette'
import QuickSwitcher from './QuickSwitcher'

const SettingsModal = lazy(() => import('@/settings/SettingsModal'))

/** All floating UI: menus, notices, dialogs, palettes, settings. */
export default function Overlays() {
  const notices = useUi((s) => s.notices)
  const modal = useUi((s) => s.modal)
  return (
    <>
      <ContextMenu />
      {modal === 'palette' && <CommandPalette />}
      {modal === 'switcher' && <QuickSwitcher />}
      {modal === 'settings' && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}
      <PromptModal />
      <ConfirmModal />
      <div className="notices">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`}>
            {n.message}
          </div>
        ))}
      </div>
    </>
  )
}
