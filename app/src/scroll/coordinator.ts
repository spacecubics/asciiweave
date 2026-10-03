export type ScrollPane = 'source' | 'preview'

export interface SourcePosition {
  line: number
  atEnd: boolean
}

export type ScrollRequest = () => boolean

export interface ScrollBookmark {
  position: SourcePosition
  restore(current: ScrollRequest): void
}

export interface ScrollAdapter {
  capture(): ScrollBookmark | undefined
  follow(position: SourcePosition, current: ScrollRequest): void
  poll(): void
  refresh?(): void
}

/** Own navigation order independently of each pane's measurement schedule. */
export function createScrollCoordinator(
  schedule: (callback: () => void) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
) {
  const panes: Partial<Record<ScrollPane, ScrollAdapter>> = {}
  const requests: Record<ScrollPane, number> = { source: 0, preview: 0 }
  let owner: ScrollPane = 'source'
  let revision = 0
  let bookmark: ScrollBookmark | undefined
  let navigation = false
  let frame: number | undefined
  let disposed = false
  const layouts = new Set<ScrollPane>()

  const flush = (): void => {
    if (frame !== undefined) cancel(frame)
    frame = undefined
    if (disposed) return
    panes.source?.refresh?.()
    panes.preview?.refresh?.()
    const moved = navigation
    if (!bookmark) bookmark = panes[owner]?.capture()
    navigation = false
    const restoreOwner = layouts.has(owner)
    const follower = owner === 'source' ? 'preview' : 'source'
    const follow = moved || restoreOwner || layouts.has(follower)
    layouts.clear()
    if (!bookmark) return
    const version = revision
    const request = (pane: ScrollPane): ScrollRequest => {
      const id = ++requests[pane]
      return () => !disposed && revision === version && requests[pane] === id
    }
    if (restoreOwner) bookmark.restore(request(owner))
    if (follow) panes[follower]?.follow(bookmark.position, request(follower))
  }

  const enqueue = (): void => {
    if (!disposed && frame === undefined) frame = schedule(flush)
  }

  const layoutChanged = (pane: ScrollPane): void => {
    if (disposed) return
    layouts.add(pane)
    enqueue()
  }

  return {
    attach(pane: ScrollPane, adapter: ScrollAdapter) {
      panes[pane] = adapter
    },
    navigate(pane: ScrollPane) {
      if (disposed) return
      owner = pane
      revision++
      bookmark = panes[pane]?.capture()
      navigation = true
      enqueue()
    },
    layoutChanged,
    changeLayout(change: () => void) {
      // Poll the owner last to break ties between movements without events.
      const active = owner
      panes[active === 'source' ? 'preview' : 'source']?.poll()
      panes[active]?.poll()
      flush()
      change()
      layoutChanged('source')
      layoutChanged('preview')
    },
    dispose() {
      disposed = true
      revision++
      if (frame !== undefined) cancel(frame)
      frame = undefined
    },
  }
}

export type ScrollCoordinator = ReturnType<typeof createScrollCoordinator>
