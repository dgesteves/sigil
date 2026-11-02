import { resolve } from 'node:path'
import pkg from '../../../package.json' with { type: 'json' }
import { fetchOf, findProjectRoot } from '../../compile/context.js'
import { Catalog } from '../../mcp/catalog.js'
import { serve } from '../../mcp/server.js'
import type { Command } from '../command.js'

export const mcp: Command = {
  name: 'mcp',
  summary:
    'Serve the catalog to agents over MCP (stdio): recommend, search, evidence and install plans',
  usage: 'sigil mcp [--registry <url|path>]',
  options: { registry: { type: 'string' } },
  async run({ values }, ctx) {
    const spec = values.registry as string | undefined
    const catalog = new Catalog(
      await findProjectRoot(ctx.cwd),
      spec && !/^https?:\/\//.test(spec) ? resolve(ctx.cwd, spec) : spec,
      fetchOf(ctx),
    )
    ctx.err(`sigil mcp ${pkg.version}: serving ${catalog.label} over stdio`)
    await serve(process.stdin, process.stdout, {
      catalog,
      version: pkg.version,
      log: (l) => ctx.err(l),
    })
    return 0
  },
}
