import { createRoot } from 'react-dom/client'
import './styles/variables.css'
import './styles/app.css'
import App from './App'
import { flushAll } from './lib/fileops'
import { flushWorkspace } from './store/workspace'
import { flushSettings } from './store/settings'

document.body.classList.add('theme-dark', `is-${window.api.platform === 'darwin' ? 'mac' : window.api.platform === 'win32' ? 'windows' : 'linux'}`)

window.addEventListener('beforeunload', () => {
  flushAll()
  flushWorkspace()
  flushSettings()
})

// test hook (like Logseq's dev API): lets e2e specs read/drive app state directly
if (window.api.testMode) void import('./lib/testHooks').then((m) => m.installTestHooks())

createRoot(document.getElementById('root')!).render(<App />)
