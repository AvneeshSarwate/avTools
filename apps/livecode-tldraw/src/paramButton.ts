import type { LivecodeEvent } from '@avtools/livecode-protocol'

/** Momentary semantics on a real Tweakpane button, including keyboard and cancellation. */
export function bindParamButton(
  element: HTMLButtonElement,
  message: LivecodeEvent<Record<string, unknown>>,
  send: (event: LivecodeEvent) => void,
): () => void {
  let active: { pointerId: number } | { key: string } | null = null
  const emit = (state: 'down' | 'up') => send({
    type: message.type,
    body: { ...message.body, state },
  })
  const release = () => {
    if (!active) return
    active = null
    element.setAttribute('aria-pressed', 'false')
    emit('up')
  }
  const down = (event: PointerEvent) => {
    if (element.disabled || event.button !== 0 || active) return
    active = { pointerId: event.pointerId }
    element.setAttribute('aria-pressed', 'true')
    element.setPointerCapture(event.pointerId)
    emit('down')
  }
  const up = (event: PointerEvent) => {
    if (active && 'pointerId' in active && active.pointerId === event.pointerId) release()
  }
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (element.disabled || event.repeat || active) return
    active = { key: event.key }
    element.setAttribute('aria-pressed', 'true')
    emit('down')
  }
  const keyUp = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (active && 'key' in active && active.key === event.key) {
      event.preventDefault()
      release()
    }
  }
  // Assistive technology can activate a button without pointer/key events.
  const click = (event: MouseEvent) => {
    if (event.detail !== 0 || active || element.disabled) return
    // Native keyboard clicks are suppressed by keyDown.preventDefault().
    emit('down')
    emit('up')
  }
  const hidden = () => { if (document.hidden) release() }
  element.dataset.paramEventButton = ''
  element.setAttribute('aria-pressed', 'false')
  element.style.touchAction = 'none'
  element.addEventListener('pointerdown', down)
  element.addEventListener('lostpointercapture', up)
  element.addEventListener('keydown', keyDown)
  element.addEventListener('keyup', keyUp)
  element.addEventListener('click', click)
  element.addEventListener('blur', release)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', release)
  window.addEventListener('pagehide', release)
  document.addEventListener('visibilitychange', hidden)
  return () => {
    release()
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('lostpointercapture', up)
    element.removeEventListener('keydown', keyDown)
    element.removeEventListener('keyup', keyUp)
    element.removeEventListener('click', click)
    element.removeEventListener('blur', release)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    window.removeEventListener('blur', release)
    window.removeEventListener('pagehide', release)
    document.removeEventListener('visibilitychange', hidden)
  }
}
