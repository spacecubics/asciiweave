import { describe, expect, it } from 'vitest'
import { clampPaneRatio, paneRatioAtPosition, paneRatioForKey } from '../src/layout/pane-resizer'

describe('pane resizer', () => {
  it('keeps both panes above their minimum share', () => {
    expect(clampPaneRatio(-1)).toBe(0.2)
    expect(clampPaneRatio(0.6)).toBe(0.6)
    expect(clampPaneRatio(2)).toBe(0.8)
  })

  it('turns a pointer coordinate into a clamped pane share', () => {
    expect(paneRatioAtPosition(350, 100, 500)).toBe(0.5)
    expect(paneRatioAtPosition(100, 100, 500)).toBe(0.2)
    expect(paneRatioAtPosition(600, 100, 500)).toBe(0.8)
    expect(paneRatioAtPosition(100, 100, 0)).toBe(0.5)
  })

  it('uses left and right keys for a vertical separator', () => {
    expect(paneRatioForKey(0.5, 'ArrowLeft', 'vertical')).toBe(0.45)
    expect(paneRatioForKey(0.5, 'ArrowRight', 'vertical')).toBe(0.55)
    expect(paneRatioForKey(0.5, 'ArrowDown', 'vertical')).toBeUndefined()
  })

  it('uses up and down keys for a horizontal separator', () => {
    expect(paneRatioForKey(0.5, 'ArrowUp', 'horizontal')).toBe(0.45)
    expect(paneRatioForKey(0.5, 'ArrowDown', 'horizontal')).toBe(0.55)
    expect(paneRatioForKey(0.5, 'ArrowRight', 'horizontal')).toBeUndefined()
  })

  it('supports keyboard jumps to either limit', () => {
    expect(paneRatioForKey(0.5, 'Home', 'vertical')).toBe(0.2)
    expect(paneRatioForKey(0.5, 'End', 'horizontal')).toBe(0.8)
  })
})
