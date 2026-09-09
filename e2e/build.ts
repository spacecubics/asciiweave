import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Exercise deployment-time discovery without depending on the bundled samples.
// Normal production builds never add these styles.
const directory = new URL('../app/src/preview/styles/', import.meta.url)
const created: URL[] = []
try {
  mkdirSync(directory, { recursive: true })
  for (const [name, color] of [
    ['test-first', 'rgb(20, 40, 60)'],
    ['test-second', 'rgb(60, 40, 20)'],
  ]) {
    const file = new URL(`${name}.css`, directory)
    writeFileSync(file, `h2 { color: ${color}; }`, { flag: 'wx' })
    created.push(file)
  }
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Browser test build failed')
} finally {
  for (const file of created) rmSync(file)
}
