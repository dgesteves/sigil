// Writes the published JSON Schemas in spec/ from the zod source of truth (run after build).
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  Evidence,
  Manifest,
  Registry,
  SPEC_VERSION,
  Task,
  Taxonomy,
  Trace,
} from '../dist/core/index.js'

const spec = new URL('../../../spec/', import.meta.url)
const base = 'https://raw.githubusercontent.com/dgesteves/sigil/main/spec/'
const schemas = {
  capability: Manifest,
  evidence: Evidence,
  task: Task,
  registry: Registry,
  trace: Trace,
  taxonomy: Taxonomy,
}

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  json.$id = `${base}${name}.schema.json`
  json.title = `Sigil ${name} (spec ${SPEC_VERSION})`
  await writeFile(new URL(`${name}.schema.json`, spec), `${JSON.stringify(json, null, 2)}\n`)
  console.log(`spec/${name}.schema.json`)
}
