// Resets the catalog to known fixtures, then runs `next build` and keeps its output for the tests.
import { spawnSync } from 'node:child_process'
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'

for (const file of readdirSync('test/hidden/fixtures')) {
  copyFileSync(`test/hidden/fixtures/${file}`, `data/${file}`)
}
writeFileSync('data/reads.log', '')

const build = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  encoding: 'utf8',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
})
const output = `${build.stdout ?? ''}${build.stderr ?? ''}`
writeFileSync('test/hidden/build.log', output)
if (build.status !== 0) {
  console.error(`next build failed (exit ${build.status}):\n${output.split('\n').slice(-60).join('\n')}`)
  process.exit(1)
}
