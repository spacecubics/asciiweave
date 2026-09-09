// Access itself can throw when storage is disabled, as can individual reads
// and writes. Preferences must never prevent editing in such a browser.
export const browserPreferences: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // The caller retains its current preference in memory.
    }
  },
}
