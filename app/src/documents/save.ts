export type SaveState = 'saving' | 'saved' | 'error'

export interface Autosaver {
  /** Record the latest source and (re)start the save debounce. */
  update(source: string): void
  /** Latest source not yet confirmed saved, or null when clean. */
  pendingSource(): string | null
  dispose(): void
}

// Debounced autosave: rapid edits coalesce into one PUT, edits made while a
// save is in flight are saved afterwards, and failures retry with the newest
// source. Pure logic with injected save/onState so it is unit-testable.
export function createAutosaver(
  save: (source: string) => Promise<void>,
  onState: (state: SaveState) => void,
  { debounceMs = 750, retryMs = 3000 }: { debounceMs?: number; retryMs?: number } = {},
): Autosaver {
  let pending: string | null = null
  let inflight = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(delay: number): void {
    if (disposed) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), delay)
  }

  async function flush(): Promise<void> {
    if (disposed || inflight || pending === null) {
      return
    }
    const source = pending
    pending = null
    inflight = true
    onState('saving')
    try {
      await save(source)
      if (pending === null) {
        onState('saved')
      } else {
        schedule(debounceMs)
      }
    } catch {
      // Keep newer edits made during the failed save; otherwise retry this one.
      pending ??= source
      onState('error')
      schedule(retryMs)
    } finally {
      inflight = false
    }
  }

  return {
    update(source) {
      pending = source
      schedule(debounceMs)
    },
    pendingSource() {
      return pending
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
