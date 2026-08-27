export interface RenderScheduler {
  /** Schedule a (debounced) conversion of the given source. */
  update(source: string): void
  /** Convert immediately, bypassing the debounce (used for initial render). */
  renderNow(source: string): void
  dispose(): void
}

// Conversions are asynchronous and may finish out of submission order. Each
// conversion captures a generation number; a result is applied only if no
// newer conversion has started since, so stale output can never overwrite a
// newer render.
export function createRenderScheduler(
  convert: (source: string) => Promise<string>,
  apply: (html: string) => void,
  onError: (error: unknown) => void,
  { debounceMs = 200 }: { debounceMs?: number } = {},
): RenderScheduler {
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function run(source: string): Promise<void> {
    const gen = ++generation
    try {
      const html = await convert(source)
      if (!disposed && gen === generation) {
        apply(html)
      }
    } catch (error) {
      if (!disposed && gen === generation) {
        onError(error)
      }
    }
  }

  return {
    update(source) {
      clearTimeout(timer)
      timer = setTimeout(() => void run(source), debounceMs)
    },
    renderNow(source) {
      clearTimeout(timer)
      void run(source)
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
