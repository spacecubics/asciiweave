import { env } from 'cloudflare:test'
import { createD1Store } from '../src/persistence/d1'
import { describeStoreContract } from '../tests/store-contract'

// The shared behavioral contract, against a real local D1 database in
// the Workers runtime. Isolated storage gives every test a database
// freshly created from the migration series (see apply-migrations.ts).
describeStoreContract(() => createD1Store(env.DB))
