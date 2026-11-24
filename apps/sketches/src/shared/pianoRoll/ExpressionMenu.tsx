// Right-click menu for a breakpoint or velocity marker (Ableton's "Edit Value"):
// Edit Value swaps the menu for a field; Enter applies, Escape cancels. Points
// also offer Delete and, on the pitch envelope, Root / Unroot. Rendered on
// document.body so tldraw's shape clipping and its own context menu stay out.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatExpressionValue, parseExpressionValue } from './expression'
import type { ExpressionMenuTarget } from './state'

export interface ExpressionMenuState {
  x: number
  y: number
  target: ExpressionMenuTarget
}

export interface ExpressionMenuActions {
  setValue: (target: ExpressionMenuTarget, value: number) => void
  deletePoint: (target: Extract<ExpressionMenuTarget, { kind: 'point' }>) => void
  toggleRooted: (target: Extract<ExpressionMenuTarget, { kind: 'point' }>) => void
}

export function ExpressionMenu({ menu, actions, onClose }: { menu: ExpressionMenuState; actions: ExpressionMenuActions; onClose: () => void }) {
  const { target } = menu
  const area = target.kind === 'point' ? target.area : 'velocity'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => formatExpressionValue(area, target.value))
  const [invalid, setInvalid] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('wheel', onClose, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const apply = () => {
    const value = parseExpressionValue(draft)
    if (value === null) {
      setInvalid(true)
      return
    }
    actions.setValue(target, value)
    onClose()
  }

  const left = Math.min(menu.x, window.innerWidth - 170)
  const top = Math.min(menu.y, window.innerHeight - 110)
  return createPortal(
    <div
      ref={rootRef}
      className="ui-chooser__list pr-expression-menu"
      role="menu"
      style={{ left, top, minWidth: 150 }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {editing ? (
        <div className="pr-expression-menu__edit">
          <input
            className={'ui-text pr-expression-menu__input' + (invalid ? ' is-invalid' : '')}
            autoFocus
            value={draft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value)
              setInvalid(false)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') apply()
              if (event.key === 'Escape') onClose()
            }}
          />
          <span className="pr-expression-menu__unit">{area === 'pitch' ? 'semitones' : area === 'velocity' ? '1–127' : '0–127'}</span>
        </div>
      ) : (
        <>
          <div className="ui-chooser__option" role="menuitem" onClick={() => setEditing(true)}>
            Edit Value… <span className="pr-expression-menu__value">{formatExpressionValue(area, target.value)}</span>
          </div>
          {target.kind === 'point' ? (
            <>
              {target.area === 'pitch' ? (
                <div className="ui-chooser__option" role="menuitem" onClick={() => { actions.toggleRooted(target); onClose() }}>
                  {target.rooted ? 'Unroot' : 'Root'}
                </div>
              ) : null}
              <div className="ui-chooser__option" role="menuitem" onClick={() => { actions.deletePoint(target); onClose() }}>
                Delete
              </div>
            </>
          ) : null}
        </>
      )}
    </div>,
    document.body
  )
}
