import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, type SaveState } from '../src/documents/save'

describe('autosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(saveImpl?: (source: string) => Promise<void>) {
    const saved: string[] = []
    const states: SaveState[] = []
    const save = vi.fn(
      saveImpl ??
        (async (source: string) => {
          saved.push(source)
        }),
    )
    const autosaver = createAutosaver(save, (state) => states.push(state), {
      debounceMs: 750,
      retryMs: 3000,
    })
    return { autosaver, save, saved, states }
  }

  it('coalesces rapid edits into a single save of the latest source', async () => {
    const { autosaver, save, saved, states } = setup()
    autosaver.update('a')
    autosaver.update('ab')
    autosaver.update('abc')
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(750)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saved).toEqual(['abc'])
    expect(states).toEqual(['saving', 'saved'])
    expect(autosaver.pendingSource()).toBeNull()
  })

  it('saves edits made while a save is in flight', async () => {
    let release: (() => void) | undefined
    const saved: string[] = []
    const { autosaver, save } = setup(
      (source) =>
        new Promise<void>((resolve) => {
          release = () => {
            saved.push(source)
            resolve()
          }
        }),
    )

    autosaver.update('first')
    await vi.advanceTimersByTimeAsync(750)
    expect(save).toHaveBeenCalledTimes(1)

    autosaver.update('second')
    release?.()
    await vi.advanceTimersByTimeAsync(750)
    release?.()
    await vi.runAllTimersAsync()

    expect(saved).toEqual(['first', 'second'])
    expect(autosaver.pendingSource()).toBeNull()
  })

  it('retries after a failure with the newest source', async () => {
    let fail = true
    const saved: string[] = []
    const { autosaver, states } = setup(async (source) => {
      if (fail) {
        throw new Error('network down')
      }
      saved.push(source)
    })

    autosaver.update('draft')
    await vi.advanceTimersByTimeAsync(750)
    expect(states).toEqual(['saving', 'error'])
    expect(autosaver.pendingSource()).toBe('draft')

    fail = false
    await vi.advanceTimersByTimeAsync(3000)
    expect(saved).toEqual(['draft'])
    expect(states).toEqual(['saving', 'error', 'saving', 'saved'])
    expect(autosaver.pendingSource()).toBeNull()
  })

  it('stops saving after dispose', async () => {
    const { autosaver, save } = setup()
    autosaver.update('late edit')
    autosaver.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).not.toHaveBeenCalled()
  })
})
