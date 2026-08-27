// Collaborator identity and presence. All of this is ephemeral Yjs
// Awareness state: names, colors, cursors, and online status are never
// part of the AsciiDoc document and are never persisted by the server.

export interface UserInfo {
  name: string
  color: string
  colorLight: string
}

export interface PresenceEntry {
  name: string
  color: string
  isLocal: boolean
}

export const USER_COLORS = [
  '#30bced',
  '#6eeb83',
  '#ffbc42',
  '#ecd444',
  '#ee6352',
  '#9ac2c9',
  '#8acb88',
  '#1be7ff',
]

const ADJECTIVES = [
  'Brave',
  'Calm',
  'Clever',
  'Eager',
  'Gentle',
  'Jolly',
  'Keen',
  'Lively',
  'Nimble',
  'Quiet',
  'Swift',
  'Witty',
]

const ANIMALS = [
  'Crane',
  'Dolphin',
  'Falcon',
  'Fox',
  'Heron',
  'Lynx',
  'Otter',
  'Owl',
  'Panda',
  'Rabbit',
  'Tanuki',
  'Wolf',
]

const NAME_KEY = 'asciiweave.userName'
const COLOR_KEY = 'asciiweave.userColor'

type NameColorStorage = Pick<Storage, 'getItem' | 'setItem'>

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length] as T
}

export function randomUserName(random: () => number = Math.random): string {
  return `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`
}

export function withColorLight(name: string, color: string): UserInfo {
  return { name, color, colorLight: `${color}33` }
}

// Load (or create and remember) this browser's collaborator identity.
// Stored per browser so the same person keeps their name and color
// across documents and visits.
export function loadLocalUser(
  storage: NameColorStorage,
  random: () => number = Math.random,
): UserInfo {
  let name = storage.getItem(NAME_KEY)
  if (!name) {
    name = randomUserName(random)
    storage.setItem(NAME_KEY, name)
  }
  let color = storage.getItem(COLOR_KEY)
  if (!color || !USER_COLORS.includes(color)) {
    color = pick(USER_COLORS, random)
    storage.setItem(COLOR_KEY, color)
  }
  return withColorLight(name, color)
}

export function storeUserName(storage: NameColorStorage, name: string): void {
  storage.setItem(NAME_KEY, name)
}

// Derive the connected-user list from the raw awareness states, local
// user first and the rest in stable client-ID order.
export function presenceList(
  states: Map<number, { user?: Partial<UserInfo> }>,
  localClientId: number,
): PresenceEntry[] {
  const entries = [...states.entries()]
    .sort(([a], [b]) => a - b)
    .map(([clientId, state]) => ({
      name: state.user?.name || 'Anonymous',
      color: state.user?.color || '#808080',
      isLocal: clientId === localClientId,
    }))
  return [...entries.filter((e) => e.isLocal), ...entries.filter((e) => !e.isLocal)]
}
