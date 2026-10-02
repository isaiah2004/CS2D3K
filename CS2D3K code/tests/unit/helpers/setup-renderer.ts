// Runs before every renderer unit test file: installs an in-memory window.api.
import { createMemoryVault } from './memoryApi'

const mem = createMemoryVault()
;(globalThis as unknown as { __mem: typeof mem }).__mem = mem
window.api = mem.api

// jsdom lacks these
if (!window.matchMedia)
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
if (!globalThis.structuredClone) globalThis.structuredClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
