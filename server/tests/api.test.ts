import { codec } from '../src/collaboration/state'
import { openStore } from '../src/persistence/sqlite'
import { describeApiContract } from './api-contract'

// The shared API contract, against node:sqlite and the Node CJS Yjs codec.
describeApiContract(() => ({ store: openStore(':memory:'), codec }))
