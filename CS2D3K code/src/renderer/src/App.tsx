import { useEffect, useState } from 'react'
import { useVault } from '@/store/vault'
import { useLoading } from '@/store/loading'
import { openVault } from '@/lib/bootstrap'
import { initTheme } from '@/theme/theme'
import VaultPicker from '@/components/VaultPicker'
import Shell from '@/components/Shell'
import Overlays from '@/components/Overlays'
import LoadingScreen from '@/components/loading/LoadingScreen'

export default function App() {
  const info = useVault((s) => s.info)
  // while a vault opens, the loading screen covers the window and the workspace mounts only once it is indexed
  const loading = useLoading((s) => s.active)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const cleanup = initTheme()
    void (async () => {
      const last = await window.api.app.getLastVault()
      if (last) await openVault(last)
      setBooting(false)
    })()
    return cleanup
  }, [])

  return (
    <>
      {booting || loading ? <div className="app" /> : info ? <Shell key={info.path} /> : <VaultPicker />}
      <LoadingScreen />
      <Overlays />
    </>
  )
}
