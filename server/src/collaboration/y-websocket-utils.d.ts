declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http'
  import type { WebSocket } from 'ws'
  import type * as Y from 'yjs'

  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean },
  ): void

  export function setPersistence(
    persistence: {
      provider: unknown
      bindState: (docName: string, ydoc: Y.Doc) => Promise<void>
      // Must return a promise: y-websocket chains .then() on it.
      writeState: (docName: string, ydoc: Y.Doc) => Promise<void>
    } | null,
  ): void

  export const docs: Map<string, Y.Doc>
}
