import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, Gem, X } from 'lucide-react'
import type { RecentVault } from '@shared/types'
import { openVault, createVault } from '@/lib/bootstrap'
import { promptText } from '@/store/ui'
import { validateName } from '@/lib/path'

export default function VaultPicker() {
  const [recent, setRecent] = useState<RecentVault[]>([])
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.app.getRecentVaults().then(setRecent)
    void window.api.app.getVersion().then(setVersion)
  }, [])

  const openFolder = async (): Promise<void> => {
    const p = await window.api.app.pickFolder('Open folder as vault')
    if (p) await openVault(p)
  }

  const create = async (): Promise<void> => {
    const name = await promptText({ title: 'Create new vault', message: 'Vault name', placeholder: 'My vault', validate: validateName, okLabel: 'Next' })
    if (!name) return
    const parent = await window.api.app.pickFolder('Choose where to create the vault')
    if (parent) await createVault(parent, name)
  }

  const remove = async (e: React.MouseEvent, p: string): Promise<void> => {
    e.stopPropagation()
    await window.api.app.removeRecentVault(p)
    setRecent(await window.api.app.getRecentVaults())
  }

  return (
    <div className="vault-picker">
      <div className="vault-picker-recent">
        {recent.length === 0 && <div className="empty-state">No recent vaults</div>}
        {recent.map((v) => (
          <div key={v.path} className="vault-recent-item" onClick={() => void openVault(v.path)} title={v.path}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{v.name}</div>
              <div className="path">{v.path}</div>
            </div>
            <button className="clickable-icon small" onClick={(e) => void remove(e, v.path)} aria-label="Remove from list">
              <X />
            </button>
          </div>
        ))}
      </div>
      <div className="vault-picker-main">
        <div className="vault-picker-logo">
          <Gem size={44} />
        </div>
        <h1>CS2D3K</h1>
        <div style={{ color: 'var(--text-faint)', fontSize: 'var(--font-ui-small)' }}>Version {version}</div>
        <div className="vault-picker-actions">
          <div className="vault-action">
            <div className="desc">
              <div className="t">Create new vault</div>
              <div className="d">Create a new vault under a folder.</div>
            </div>
            <button className="btn mod-cta" onClick={() => void create()}>
              <FolderPlus size={15} /> Create
            </button>
          </div>
          <div className="vault-action">
            <div className="desc">
              <div className="t">Open folder as vault</div>
              <div className="d">Choose an existing folder of notes or a code project.</div>
            </div>
            <button className="btn" onClick={() => void openFolder()}>
              <FolderOpen size={15} /> Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
