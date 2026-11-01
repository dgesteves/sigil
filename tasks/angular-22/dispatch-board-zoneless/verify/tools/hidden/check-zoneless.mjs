// The request rules out bringing zone.js back. Check the places it would come back through.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const problems = []
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  if (pkg[field]?.['zone.js']) problems.push(`package.json ${field} lists zone.js`)
}
const angular = readFileSync('angular.json', 'utf8')
if (/zone\.js/.test(angular)) problems.push('angular.json loads zone.js')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
for (const file of walk('src').filter((f) => /\.(ts|js|mjs)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  if (/provideZoneChangeDetection\s*\(/.test(text)) problems.push(`${file} uses provideZoneChangeDetection`)
  if (/import\s+['"]zone\.js/.test(text)) problems.push(`${file} imports zone.js`)
}

if (problems.length) {
  console.error(`zoneless checks failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('zoneless checks passed')
