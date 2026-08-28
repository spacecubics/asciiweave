import { applyMigrations, migrationStatus, openDatabase } from './db'

// Migration runner for the local SQLite database:
//   npm run db:status  — list applied and pending migrations
//   npm run db:migrate — apply pending migrations

const command = process.argv[2]
const dbPath = process.env.ASCIIWEAVE_DB ?? 'data/asciiweave.db'

if (command !== 'status' && command !== 'apply') {
  console.error('usage: migrate-cli.ts <status|apply>')
  process.exit(2)
}

const db = openDatabase(dbPath)
try {
  if (command === 'apply') {
    const applied = applyMigrations(db)
    if (applied.length === 0) {
      console.log(`${dbPath}: already up to date`)
    } else {
      for (const name of applied) {
        console.log(`${dbPath}: applied ${name}`)
      }
    }
  } else {
    const status = migrationStatus(db)
    console.log(`database: ${dbPath}`)
    for (const name of status.applied) {
      console.log(`  applied: ${name}`)
    }
    for (const name of status.pending) {
      console.log(`  pending: ${name}`)
    }
    if (status.pending.length > 0) {
      process.exitCode = 1
    }
  }
} finally {
  db.close()
}
