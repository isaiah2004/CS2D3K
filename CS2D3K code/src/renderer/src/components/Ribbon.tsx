import { Map as MapIcon, FilePlus2, LayoutDashboard, Waypoints, SquareTerminal, Command, Shuffle, CalendarDays, Settings, HelpCircle, ArrowLeftRight } from 'lucide-react'
import { executeCommand } from '@/store/commands'

interface RibbonAction {
  icon: React.ReactNode
  title: string
  command: string
}

const TOP: RibbonAction[] = [
  { icon: <ArrowLeftRight />, title: 'Open quick switcher', command: 'app:quick-switcher' },
  { icon: <Waypoints />, title: 'Open graph view', command: 'graph:open' },
  { icon: <LayoutDashboard />, title: 'Create new canvas', command: 'canvas:new' },
  { icon: <MapIcon />, title: 'Create new form-map', command: 'formmap:new' },
  { icon: <FilePlus2 />, title: 'Create new note', command: 'file:new-note' },
  { icon: <CalendarDays />, title: "Open today's daily note", command: 'daily:open' },
  { icon: <Shuffle />, title: 'Open random note', command: 'file:random-note' },
  { icon: <SquareTerminal />, title: 'Toggle terminal', command: 'terminal:toggle' },
  { icon: <Command />, title: 'Open command palette', command: 'app:command-palette' }
]

export default function Ribbon() {
  return (
    <div className="ribbon">
      {TOP.map((a) => (
        <button key={a.command} className="clickable-icon" title={a.title} aria-label={a.title} onClick={() => executeCommand(a.command)}>
          {a.icon}
        </button>
      ))}
      <div className="spacer" />
      <button className="clickable-icon" title="Help" onClick={() => executeCommand('app:help')}>
        <HelpCircle />
      </button>
      <button className="clickable-icon" title="Settings (Ctrl+,)" aria-label="Settings" onClick={() => executeCommand('app:settings')}>
        <Settings />
      </button>
    </div>
  )
}
