import { useCallback } from 'react'
import SuggestModal, { Highlighted } from './SuggestModal'
import { useCommands, hotkeysFor, formatHotkey, type Command } from '@/store/commands'
import { useUi } from '@/store/ui'
import { fuzzyMatch } from '@/lib/util'

interface Item {
  cmd: Command
  indices: number[]
}

export default function CommandPalette() {
  const close = useUi((s) => s.closeModal)
  const getItems = useCallback((q: string): Item[] => {
    const { commands, recent } = useCommands.getState()
    const avail = Object.values(commands).filter((c) => !c.check || c.check())
    if (!q.trim()) {
      const rec = recent.filter((id) => id !== 'app:command-palette').map((id) => commands[id]).filter((c): c is Command => !!c && avail.includes(c))
      const rest = avail.filter((c) => !rec.includes(c)).sort((a, b) => a.name.localeCompare(b.name))
      return [...rec, ...rest].map((cmd) => ({ cmd, indices: [] }))
    }
    return avail
      .map((cmd) => ({ cmd, m: fuzzyMatch(q, cmd.name) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .map((x) => ({ cmd: x.cmd, indices: x.m!.indices }))
  }, [])

  return (
    <SuggestModal<Item>
      placeholder="Type a command..."
      getItems={getItems}
      onClose={close}
      emptyText="No commands found."
      onChoose={(it) => useCommands.getState().execute(it.cmd.id)}
      instructions={[
        { keys: '↑↓', label: 'to navigate' },
        { keys: '↵', label: 'to use' },
        { keys: 'esc', label: 'to dismiss' }
      ]}
      render={(it) => (
        <>
          <div className="suggestion-main">
            <Highlighted text={it.cmd.name} indices={it.indices} />
          </div>
          <div className="suggestion-aux">
            {hotkeysFor(it.cmd.id).map((h) => (
              <kbd key={h}>{formatHotkey(h)}</kbd>
            ))}
          </div>
        </>
      )}
    />
  )
}
