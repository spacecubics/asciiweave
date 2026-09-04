const MIN_PANE_RATIO = 0.2
const MAX_PANE_RATIO = 1 - MIN_PANE_RATIO
const KEYBOARD_STEP = 0.05
const NARROW_LAYOUT = '(max-width: 800px)'

export type PaneOrientation = 'horizontal' | 'vertical'

export function clampPaneRatio(ratio: number): number {
  return Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio))
}

export function paneRatioAtPosition(position: number, start: number, size: number): number {
  if (size <= 0) {
    return 0.5
  }
  return clampPaneRatio((position - start) / size)
}

export function paneRatioForKey(
  ratio: number,
  key: string,
  orientation: PaneOrientation,
): number | undefined {
  if (key === 'Home') {
    return MIN_PANE_RATIO
  }
  if (key === 'End') {
    return MAX_PANE_RATIO
  }

  const decrease = orientation === 'vertical' ? key === 'ArrowLeft' : key === 'ArrowUp'
  const increase = orientation === 'vertical' ? key === 'ArrowRight' : key === 'ArrowDown'
  if (!decrease && !increase) {
    return undefined
  }
  return clampPaneRatio(ratio + (increase ? KEYBOARD_STEP : -KEYBOARD_STEP))
}

export function createPaneResizer(container: HTMLElement, handle: HTMLElement): void {
  const narrowLayout = matchMedia(NARROW_LAYOUT)
  let orientation: PaneOrientation = narrowLayout.matches ? 'horizontal' : 'vertical'
  let ratio = 0.5

  const applyRatio = (): void => {
    container.style.setProperty('--source-pane-share', `${ratio}fr`)
    container.style.setProperty('--preview-pane-share', `${1 - ratio}fr`)
    handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
  }

  const updateOrientation = (): void => {
    orientation = narrowLayout.matches ? 'horizontal' : 'vertical'
    handle.setAttribute('aria-orientation', orientation)
  }

  const resizeAtPointer = (event: PointerEvent): void => {
    const bounds = container.getBoundingClientRect()
    ratio =
      orientation === 'vertical'
        ? paneRatioAtPosition(event.clientX, bounds.left, bounds.width)
        : paneRatioAtPosition(event.clientY, bounds.top, bounds.height)
    applyRatio()
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return
    }
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('pane-resizer-active')
    resizeAtPointer(event)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (handle.hasPointerCapture(event.pointerId)) {
      resizeAtPointer(event)
    }
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId)
    }
    handle.classList.remove('pane-resizer-active')
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const nextRatio = paneRatioForKey(ratio, event.key, orientation)
    if (nextRatio === undefined) {
      return
    }
    event.preventDefault()
    ratio = nextRatio
    applyRatio()
  }

  const reset = (): void => {
    ratio = 0.5
    applyRatio()
  }

  handle.addEventListener('pointerdown', onPointerDown)
  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', onPointerUp)
  handle.addEventListener('pointercancel', onPointerUp)
  handle.addEventListener('keydown', onKeyDown)
  handle.addEventListener('dblclick', reset)
  narrowLayout.addEventListener('change', updateOrientation)
  updateOrientation()
  applyRatio()
}
