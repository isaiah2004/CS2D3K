// Keeps a crash inside one view / pane from unmounting the whole app (React drops the entire tree
// on an uncaught render error). Shows the error in place with a retry button.
import { Component, type ReactNode } from 'react'

interface Props {
  /** what crashed, for the message ("this view", "the Search pane"…) */
  label?: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.warn(`${this.props.label ?? 'view'} crashed:`, error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="empty-state error-boundary">
        <div>Something went wrong in {this.props.label ?? 'this view'}.</div>
        <div className="error-boundary-message" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-monospace)', userSelect: 'text' }}>
          {error.message || String(error)}
        </div>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
