import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'

// The asciiweave document ID doubles as the Yjs room name, so everyone on
// /doc/<id> shares one room at /collab/<id>. Only Yjs updates and
// awareness travel over this socket — never rendered HTML.
export function connectCollaboration(ydoc: Y.Doc, documentId: string): WebsocketProvider {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebsocketProvider(`${scheme}//${location.host}/collab`, documentId, ydoc)
}
