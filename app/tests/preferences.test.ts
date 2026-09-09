import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserPreferences } from '../src/preferences'

afterEach(() => vi.unstubAllGlobals())

describe('optional browser preferences', () => {
  it('survives unavailable storage and rejected reads/writes', () => {
    // An absent global also exercises failure when evaluating localStorage itself.
    vi.stubGlobal('localStorage', undefined)
    expect(browserPreferences.getItem('style')).toBeNull()
    expect(() => browserPreferences.setItem('style', 'git-docs')).not.toThrow()
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('disabled')
      },
      setItem() {
        throw new Error('quota')
      },
    })
    expect(browserPreferences.getItem('style')).toBeNull()
    expect(() => browserPreferences.setItem('style', 'git-docs')).not.toThrow()
  })
})
