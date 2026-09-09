import { env } from 'cloudflare:test'
import * as Y from 'yjs'
import { createCodec } from '../src/collaboration/codec'
import { createD1Store } from '../src/persistence/d1'
import { describeApiContract } from '../tests/api-contract'

// The shared Hono app against D1 in workerd, using the Worker ESM Yjs codec.
// This does not exercise Worker entry-point routing or Durable Objects.
describeApiContract(() => ({ store: createD1Store(env.DB), codec: createCodec(Y) }))
