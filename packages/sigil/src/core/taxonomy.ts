import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { type Finding, Slug } from './schema.js'

/** Package ecosystems the Oracle can read, plus `files` (paths or simple globs). */
export const ECOSYSTEMS = [
  'npm',
  'pypi',
  'cargo',
  'go',
  'maven',
  'nuget',
  'composer',
  'gem',
  'pub',
  'hex',
] as const

export const TECHNOLOGY_KINDS = [
  'language',
  'runtime',
  'framework',
  'library',
  'database',
  'platform',
  'infrastructure',
  'tool',
  'ai-provider',
  'ai-framework',
  'protocol',
  'practice',
] as const

const Detect = z.strictObject({
  ...Object.fromEntries(ECOSYSTEMS.map((e) => [e, z.array(z.string().min(1)).optional()])),
  files: z.array(z.string().min(1)).optional(),
})

export const Technology = z.strictObject({
  id: Slug,
  name: z.string().min(1),
  kind: z.enum(TECHNOLOGY_KINDS),
  /** A more general technology this one implies (nextjs → react). */
  parent: Slug.optional(),
  detect: Detect.optional(),
})
export type Technology = z.infer<typeof Technology>

export const Taxonomy = z
  .strictObject({ sigil: z.literal(1), technologies: z.array(Technology).min(1) })
  .superRefine((t, ctx) => {
    const ids = new Set<string>()
    for (const [i, tech] of t.technologies.entries()) {
      if (ids.has(tech.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['technologies', i, 'id'],
          message: `duplicate id ${tech.id}`,
        })
      }
      ids.add(tech.id)
    }
    for (const [i, tech] of t.technologies.entries()) {
      if (tech.parent && !ids.has(tech.parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['technologies', i, 'parent'],
          message: `unknown parent ${tech.parent}`,
        })
      }
    }
  })
export type Taxonomy = z.infer<typeof Taxonomy>

export async function loadTaxonomy(root: string): Promise<Taxonomy | undefined> {
  let raw: string
  try {
    raw = await readFile(join(root, 'taxonomy', 'technologies.yaml'), 'utf8')
  } catch {
    return undefined
  }
  return Taxonomy.parse(parse(raw, { strict: true, uniqueKeys: true }))
}

/** Unknown technology tags are allowed but flagged, so the vocabulary grows on purpose. */
export function checkTechnologies(technologies: readonly string[], taxonomy: Taxonomy): Finding[] {
  const known = new Set(taxonomy.technologies.map((t) => t.id))
  return technologies
    .filter((t) => !known.has(t))
    .map((t) => ({
      rule: 'SIG-STR-019',
      severity: 'low' as const,
      message: `technology "${t}" is not in taxonomy/technologies.yaml; add it there or use an existing id`,
      file: 'sigil.yaml',
    }))
}
