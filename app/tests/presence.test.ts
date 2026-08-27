import { describe, expect, it } from 'vitest'
import {
  USER_COLORS,
  loadLocalUser,
  presenceList,
  randomUserName,
  storeUserName,
  withColorLight,
} from '../src/collaboration/presence'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('collaborator identity', () => {
  it('generates and persists a name and color on first load', () => {
    const storage = fakeStorage()
    const user = loadLocalUser(storage, () => 0.4)
    expect(user.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(USER_COLORS).toContain(user.color)
    expect(user.colorLight).toBe(`${user.color}33`)

    // A later visit (different randomness) keeps the same identity.
    const again = loadLocalUser(storage, () => 0.9)
    expect(again).toEqual(user)
  })

  it('keeps a stored name after the user changes it', () => {
    const storage = fakeStorage()
    loadLocalUser(storage, () => 0.1)
    storeUserName(storage, '庄司')
    expect(loadLocalUser(storage).name).toBe('庄司')
  })

  it('replaces a stored color that is not in the palette', () => {
    const storage = fakeStorage({ 'asciiweave.userColor': '#000000' })
    const user = loadLocalUser(storage, () => 0.2)
    expect(USER_COLORS).toContain(user.color)
  })

  it('derives a translucent selection color', () => {
    expect(withColorLight('X', '#ee6352')).toEqual({
      name: 'X',
      color: '#ee6352',
      colorLight: '#ee635233',
    })
  })

  it('varies generated names with randomness', () => {
    expect(randomUserName(() => 0.05)).not.toBe(randomUserName(() => 0.95))
  })
})

describe('presence list', () => {
  it('puts the local user first and keeps the rest in client order', () => {
    const states = new Map([
      [7, { user: { name: 'Carol', color: '#ffbc42' } }],
      [3, { user: { name: 'Alice', color: '#30bced' } }],
      [5, { user: { name: 'Bob', color: '#6eeb83' } }],
    ])
    const list = presenceList(states, 5)
    expect(list.map((e) => e.name)).toEqual(['Bob', 'Alice', 'Carol'])
    expect(list[0]?.isLocal).toBe(true)
    expect(list.slice(1).every((e) => !e.isLocal)).toBe(true)
  })

  it('falls back to defaults when a client has no user state yet', () => {
    const states = new Map([[1, {}]])
    expect(presenceList(states, 2)).toEqual([
      { name: 'Anonymous', color: '#808080', isLocal: false },
    ])
  })
})
