import { useEffect, useRef, useState } from 'react'
import { useUi } from '@/store/ui'

/** Remembers the focused element when a dialog opens and restores it when it closes. */
function useRestoreFocus(open: boolean): void {
  const prev = useRef<Element | null>(null)
  useEffect(() => {
    if (!open) return
    prev.current = document.activeElement
    return () => {
      const el = prev.current as HTMLElement | null
      if (el && document.contains(el)) requestAnimationFrame(() => el.focus())
    }
  }, [open])
}

export function PromptModal() {
  const req = useUi((s) => s.prompt)
  useRestoreFocus(!!req)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!req) return
    setValue(req.initial ?? '')
    setError(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      if (req.selectStem && req.initial) {
        const dot = req.initial.lastIndexOf('.')
        el.setSelectionRange(0, dot > 0 ? dot : req.initial.length)
      } else el.select()
    })
  }, [req])

  if (!req) return null
  const finish = (v: string | null): void => {
    if (v !== null && req.validate) {
      const err = req.validate(v)
      if (err) {
        setError(err)
        return
      }
    }
    useUi.setState({ prompt: null })
    req.resolve(v)
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => finish(null)}>
      <div className="modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{req.title}</div>
        <div className="modal-content">
          {req.message && <div style={{ marginBottom: 8 }}>{req.message}</div>}
          <input
            ref={inputRef}
            className="input"
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish(value)
              if (e.key === 'Escape') finish(null)
              e.stopPropagation()
            }}
          />
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-buttons">
          <button className="btn" onClick={() => finish(null)}>
            Cancel
          </button>
          <button className="btn mod-cta" onClick={() => finish(value)}>
            {req.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmModal() {
  const req = useUi((s) => s.confirm)
  useRestoreFocus(!!req)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (req) requestAnimationFrame(() => okRef.current?.focus())
  }, [req])
  if (!req) return null
  const finish = (ok: boolean): void => {
    useUi.setState({ confirm: null })
    req.resolve(ok)
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => finish(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(false)
      }}
    >
      <div className="modal" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{req.title}</div>
        <div className="modal-content">{req.message}</div>
        <div className="modal-buttons">
          <button className="btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button ref={okRef} className={`btn ${req.danger ? 'mod-warning' : 'mod-cta'}`} onClick={() => finish(true)}>
            {req.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
