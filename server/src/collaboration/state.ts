import { createRequire } from 'node:module'
import type * as YTypes from 'yjs'
import { createCodec } from './codec'

// The one yjs module instance for all Node server-side code. It must be
// the same CommonJS build that y-websocket/bin/utils requires: mixing
// the ESM and CJS builds puts structs from two class hierarchies into
// one document and corrupts sync encoding (see docs/architecture.md).
// The Cloudflare Worker has no y-websocket and bundles the ESM build.
export const Y = createRequire(import.meta.url)('yjs') as typeof YTypes

export const codec = createCodec(Y)
export const { encodeSourceAsState, decodeStateToSource } = codec
