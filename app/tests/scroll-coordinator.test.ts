import { describe, expect, it } from 'vitest'
import {
  createScrollCoordinator,
  type ScrollPane,
  type SourcePosition,
} from '../src/scroll/coordinator'

function setup() {
  const frames = new Map<number, () => void>()
  let id = 0
  const sync = createScrollCoordinator(
    (callback) => {
      frames.set(++id, callback)
      return id
    },
    (frame) => {
      frames.delete(frame)
    },
  )
  const positions: Record<ScrollPane, number> = { source: 1, preview: 1 }
  const observed = { ...positions }
  const visible = { source: true, preview: true }
  const writes: Array<{ pane: ScrollPane; line: number; restore: boolean }> = []
  const deferred: Array<() => void> = []
  let delay = false
  for (const pane of ['source', 'preview'] as const) {
    const write = (line: number, current: () => boolean, restore: boolean) => {
      const apply = () => {
        if (!current()) return
        positions[pane] = observed[pane] = line
        writes.push({ pane, line, restore })
      }
      if (delay) deferred.push(apply)
      else apply()
    }
    sync.attach(pane, {
      isVisible: () => visible[pane],
      capture() {
        const line = positions[pane]
        // The cross-pane projection deliberately loses within-block progress.
        const position: SourcePosition = { line: Math.floor(line), atEnd: false }
        return { position, restore: (current) => write(line, current, true) }
      },
      follow: (position, current) => write(position.line, current, false),
      poll() {
        if (positions[pane] === observed[pane]) return
        observed[pane] = positions[pane]
        sync.navigate(pane)
      },
    })
  }
  return {
    sync,
    visible,
    positions,
    observed,
    writes,
    deferred,
    delay() {
      delay = true
    },
    move(pane: ScrollPane, line: number) {
      positions[pane] = observed[pane] = line
      sync.navigate(pane)
    },
    tick() {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback())
    },
  }
}

describe('scroll ownership', () => {
  for (const order of [
    ['source', 'preview'],
    ['preview', 'source'],
    ['source', 'preview', 'source'],
    ['preview', 'source', 'preview'],
  ] as const) {
    it(`follows the latest navigation in ${order.join(' → ')}`, () => {
      const h = setup()
      order.forEach((pane, index) => h.move(pane, (index + 1) * 10))
      h.tick()
      const owner = order.at(-1)!
      expect(h.writes).toEqual([
        {
          pane: owner === 'source' ? 'preview' : 'source',
          line: order.length * 10,
          restore: false,
        },
      ])
    })
  }

  it('invalidates a measured follow when newer navigation arrives', () => {
    const h = setup()
    h.delay()
    h.move('preview', 20)
    h.tick()
    h.move('source', 40)
    h.tick()
    h.deferred.reverse().forEach((apply) => apply())
    expect(h.writes).toEqual([{ pane: 'preview', line: 40, restore: false }])
    expect(h.positions.source).toBe(40)
  })

  it('does not resurrect an observed preview scroll when changing layout', () => {
    const h = setup()
    h.move('preview', 10)
    h.move('source', 30)
    h.sync.changeLayout(() => {})
    h.tick()
    expect(h.positions).toEqual({ source: 30, preview: 30 })
    expect(h.writes.some((write) => write.line === 10)).toBe(false)
  })

  it.each(['source', 'preview'] as const)(
    'captures unreported %s movement before layout',
    (pane) => {
      const h = setup()
      h.positions[pane] = 25
      h.sync.changeLayout(() => {
        h.positions[pane] = 0
      })
      h.tick()
      expect(h.positions).toEqual({ source: 25, preview: 25 })
    },
  )

  it.each(['source', 'preview'] as const)(
    'restores the native %s bookmark after reflow',
    (pane) => {
      const h = setup()
      h.move(pane, 10.6)
      h.tick()
      h.positions[pane] = 0
      h.sync.layoutChanged(pane)
      h.tick()
      expect(h.positions[pane]).toBe(10.6)
      expect(h.positions[pane === 'source' ? 'preview' : 'source']).toBe(10)
    },
  )

  it.each(['source', 'preview'] as const)(
    'retains %s navigation when reflow precedes the next frame',
    (pane) => {
      const h = setup()
      h.move(pane, 10.6)
      h.positions[pane] = 0
      h.sync.layoutChanged(pane)
      h.tick()
      expect(h.positions[pane]).toBe(10.6)
      expect(h.positions[pane === 'source' ? 'preview' : 'source']).toBe(10)
    },
  )

  it('keeps an outstanding source restore valid when only preview geometry changes', () => {
    const h = setup()
    h.move('source', 12.5)
    h.tick()
    h.delay()
    h.sync.layoutChanged('source')
    h.tick()
    h.sync.layoutChanged('preview')
    h.tick()
    h.deferred.forEach((apply) => apply())
    expect(h.positions.source).toBe(12.5)
  })

  it('ignores programmatic scroll echoes during a layout poll', () => {
    const h = setup()
    h.move('preview', 20.4)
    h.tick()
    h.sync.changeLayout(() => {})
    h.tick()
    expect(h.positions.preview).toBe(20.4)
  })

  it('invalidates deferred work on disposal', () => {
    const h = setup()
    h.delay()
    h.move('preview', 20)
    h.tick()
    h.sync.dispose()
    h.deferred.forEach((apply) => apply())
    h.tick()
    expect(h.writes).toEqual([])
  })

  it.each(['source', 'preview'] as const)(
    'retains the %s bookmark while its pane is hidden',
    (pane) => {
      const h = setup()
      const other = pane === 'source' ? 'preview' : 'source'
      h.move(pane, 12.5)
      h.tick()
      h.writes.length = 0
      h.sync.changeLayout(() => {
        h.visible[pane] = false
        h.positions[pane] = 0
      })
      h.tick()
      h.move(pane, 1)
      h.sync.layoutChanged(pane)
      h.tick()
      expect(h.positions[other]).toBe(12)
      expect(h.writes.every((write) => write.pane === other)).toBe(true)
      h.sync.changeLayout(() => {
        h.visible[pane] = true
      })
      h.tick()
      expect(h.positions[pane]).toBe(12.5)
    },
  )

  it.each(['source', 'preview'] as const)(
    'follows newer visible navigation when revealing %s',
    (pane) => {
      const h = setup()
      const other = pane === 'source' ? 'preview' : 'source'
      h.move(pane, 12.5)
      h.tick()
      h.sync.changeLayout(() => {
        h.visible[pane] = false
      })
      h.tick()
      h.move(other, 31.5)
      h.tick()
      expect(h.positions[pane]).toBe(12.5)
      h.sync.changeLayout(() => {
        h.visible[pane] = true
      })
      h.tick()
      expect(h.positions).toEqual({ [pane]: 31, [other]: 31.5 })
    },
  )

  it('invalidates a pending scroll across hiding and showing before the next frame', () => {
    const h = setup()
    h.delay()
    h.move('preview', 20)
    h.tick()
    const oldFollow = h.deferred[0]!
    h.sync.changeLayout(() => {
      h.visible.source = false
    })
    h.sync.changeLayout(() => {
      h.visible.source = true
    })
    oldFollow()
    expect(h.positions.source).toBe(1)
    h.tick()
    h.deferred.forEach((apply) => apply())
    expect(h.positions.source).toBe(20)
  })
})
