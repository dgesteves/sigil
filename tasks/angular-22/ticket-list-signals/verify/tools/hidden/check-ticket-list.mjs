// Source checks for what the request names explicitly: built-in control flow instead of
// NgIf/NgFor, no decorator inputs/outputs/queries, and no Eager change detection marker.
import { readFileSync } from 'node:fs'

const ts = readFileSync('src/app/tickets/ticket-list.ts', 'utf8')
const html = (() => {
  try {
    return readFileSync('src/app/tickets/ticket-list.html', 'utf8')
  } catch {
    return ''
  }
})()
const source = `${ts}\n${html}`

const problems = []
const forbid = (re, what) => {
  if (re.test(source)) problems.push(what)
}
forbid(/\*ngIf\b|\*ngFor\b|\bNgIf\b|\bNgFor(Of)?\b|\bCommonModule\b/, 'still uses NgIf/NgFor structural directives')
forbid(/@Input\s*\(|@Output\s*\(|@ViewChild\s*\(|@ViewChildren\s*\(/, 'still uses decorator inputs, outputs or queries')
forbid(/\bEventEmitter\b/, 'still uses EventEmitter')
forbid(/ChangeDetectionStrategy\s*\.\s*(Eager|Default)\b/, 'still opts out of OnPush with ChangeDetectionStrategy.Eager/Default')
if (!/@for\s*\(/.test(source)) problems.push('no @for block found')
if (!/\bviewChild\b/.test(ts)) problems.push('no signal view query (viewChild) found')

if (problems.length) {
  console.error(`ticket-list source checks failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('ticket-list source checks passed')
