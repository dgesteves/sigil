import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { AGENTS, CAPABILITY_TYPES, DOMAINS } from '../core/ids.js'
import { type Catalog, CatalogError } from './catalog.js'

export interface Tool {
  name: string
  title: string
  description: string
  input: z.ZodType
  run(args: never, catalog: Catalog): Promise<Record<string, unknown>>
}

const Id = z.string().min(3).describe('Capability id, namespace/slug, e.g. "zod/zod-4"')
const Limit = z.number().int().min(1).max(50).default(10)

const tool = <S extends z.ZodType>(
  t: Omit<Tool, 'input' | 'run'> & {
    input: S
    run(args: z.infer<S>, catalog: Catalog): Promise<Record<string, unknown>>
  },
): Tool => t as Tool

export const TOOLS: Tool[] = [
  tool({
    name: 'recommend',
    title: 'Recommend capabilities for this project',
    description:
      "Detects this project's stack from its manifests and config files (package.json, pyproject.toml, go.mod, Cargo.toml, pom.xml, Dockerfile, ...) and returns catalog capabilities for those technologies, best evidence first. Call it when you start work in an unfamiliar project. Revoked and harmful capabilities are never returned.",
    input: z.strictObject({
      path: z
        .string()
        .optional()
        .describe('A subdirectory to read instead of the project root, e.g. "apps/web"'),
      limit: Limit,
    }),
    async run({ path, limit }, catalog) {
      const dir = resolve(catalog.root, path ?? '.')
      const rel = relative(catalog.root, dir)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new CatalogError(`${path} is outside the project`)
      return catalog.recommend(dir, limit)
    },
  }),
  tool({
    name: 'search',
    title: 'Search proven agent capabilities',
    description:
      'Searches Sigil\'s catalog of agent capabilities (skills, rules, subagents, commands, hooks, MCP servers, policies) by what you need to do, e.g. "migrate to zod 4" or "harden github actions". Every result carries its trust level (submitted, validated, verified) and measured uplift (proven, inconclusive, no-effect, untested). Only "proven" means agents measurably did better with it. Revoked and harmful capabilities are never returned.',
    input: z.strictObject({
      query: z.string().max(300).default('').describe('What you are trying to do, in plain words'),
      type: z.enum(CAPABILITY_TYPES).optional(),
      technology: z
        .string()
        .optional()
        .describe('A technology id from the taxonomy, e.g. "nextjs", "postgresql"'),
      domain: z.enum(DOMAINS).optional(),
      agent: z.enum(AGENTS).optional().describe('Only capabilities that target this agent'),
      proven_only: z.boolean().default(false),
      limit: Limit,
    }),
    run: (a, catalog) =>
      catalog.search(a.query, {
        type: a.type,
        technology: a.technology,
        domain: a.domain,
        agent: a.agent,
        provenOnly: a.proven_only,
        limit: a.limit,
      }),
  }),
  tool({
    name: 'get',
    title: 'Get a capability and its evidence',
    description:
      'Returns the full record for one capability: what it does, its limitations, the permissions it asks for, the payload digest, and every piece of evidence Sigil holds for that exact digest (A/B pass counts with and without it, the delta with its 95% interval, the sandbox canary run, the security scan, maintainer reviews). Read this before you suggest a capability, and quote the evidence rather than the summary.',
    input: z.strictObject({ id: Id }),
    run: ({ id }, catalog) => catalog.get(id),
  }),
  tool({
    name: 'plan_install',
    title: 'Preview an install',
    description:
      "Previews what `sigil add <id>` would change in this project: the files it would create or update for each agent, settings it would merge, hook commands the agent would run, and conflicts. It verifies the payload against the registry's hashes but writes nothing. Show the plan to the user; they install by running the returned command.",
    input: z.strictObject({
      id: Id,
      agents: z
        .array(z.enum(AGENTS))
        .min(1)
        .optional()
        .describe('Agents to install into. Defaults to the agents this project already uses.'),
    }),
    run: ({ id, agents }, catalog) => catalog.plan(id, agents),
  }),
]

/** JSON Schema for tools/list, generated from the same zod schemas that validate the calls. */
export function inputSchema(t: Tool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(t.input, { io: 'input' }) as Record<
    string,
    unknown
  >
  return schema
}
