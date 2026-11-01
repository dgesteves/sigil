import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceTemplate,
} from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { loadDocs, searchDocs, wordCount } from './docs.ts'

const docs = loadDocs()

function unknownPage(slug: unknown): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown docs page: ${String(slug)}`)
}

/** One McpServer per connection; serveStdio picks the protocol era (2025 initialize or 2026-07-28). */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'relay-docs', version: '2.1.0' })

  server.registerTool(
    'search_docs',
    {
      description:
        'Search the Relay product docs. Returns matching pages, best match first, with a one-line excerpt.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Words to look for'),
        limit: z.number().int().min(1).max(20).optional().describe('Maximum pages (default 5)'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const hits = searchDocs(docs, query, limit ?? 5)
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: `No docs match "${query}".` }] }
      }
      return {
        content: [
          { type: 'text', text: hits.map((h) => `${h.slug}: ${h.title} - ${h.excerpt}`).join('\n') },
        ],
      }
    },
  )

  server.registerTool(
    'index_stats',
    {
      title: 'Index stats',
      description: 'Re-read every docs page and report how many pages and words there are.',
      inputSchema: z.object({}),
      outputSchema: z.object({ pages: z.number().int(), words: z.number().int() }),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      const progressToken = ctx.mcpReq._meta?.progressToken
      let words = 0
      for (const [i, doc] of docs.entries()) {
        if (ctx.mcpReq.signal.aborted) throw new Error('Cancelled')
        words += wordCount(doc.body)
        if (progressToken !== undefined) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i + 1, total: docs.length },
          })
        }
      }
      const output = { pages: docs.length, words }
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
    },
  )

  server.registerResource(
    'doc',
    new ResourceTemplate('docs://{slug}', {
      list: async () => ({
        resources: docs.map((d) => ({
          uri: `docs://${d.slug}`,
          name: d.title,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { mimeType: 'text/markdown' },
    async (uri, { slug }) => {
      const doc = docs.find((d) => d.slug === slug)
      if (!doc) throw unknownPage(slug)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc.body }] }
    },
  )

  server.registerPrompt(
    'summarize_doc',
    {
      description: 'Ask the model to summarise one docs page for a customer.',
      argsSchema: z.object({ slug: z.string().describe('Page slug, e.g. "deployment"') }),
    },
    ({ slug }) => {
      const doc = docs.find((d) => d.slug === slug)
      if (!doc) throw unknownPage(slug)
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Summarise this page for a customer in three bullet points.\n\n${doc.body}`,
            },
          },
        ],
      }
    },
  )

  return server
}

const handle = serveStdio(createServer)
process.on('SIGINT', () => void handle.close())
console.error('relay-docs MCP server ready on stdio')
