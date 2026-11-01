import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { loadDocs, searchDocs, wordCount } from './docs.ts'

const docs = loadDocs()
const server = new McpServer({ name: 'relay-docs', version: '2.1.0' })

server.tool(
  'search_docs',
  'Search the Relay product docs. Returns matching pages, best match first, with a one-line excerpt.',
  {
    query: z.string().min(1).describe('Words to look for'),
    limit: z.number().int().min(1).max(20).optional().describe('Maximum pages (default 5)'),
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
    inputSchema: {},
    outputSchema: { pages: z.number().int(), words: z.number().int() },
  },
  async (_args, extra) => {
    const progressToken = extra._meta?.progressToken
    let words = 0
    for (const [i, doc] of docs.entries()) {
      if (extra.signal.aborted) throw new McpError(ErrorCode.InvalidRequest, 'Cancelled')
      words += wordCount(doc.body)
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: i + 1, total: docs.length },
        })
      }
    }
    const output = { pages: docs.length, words }
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
  },
)

server.resource(
  'doc',
  new ResourceTemplate('docs://{slug}', {
    list: async () => ({
      resources: docs.map((d) => ({ uri: `docs://${d.slug}`, name: d.title, mimeType: 'text/markdown' })),
    }),
  }),
  async (uri, { slug }) => {
    const doc = docs.find((d) => d.slug === slug)
    if (!doc) throw new McpError(ErrorCode.InvalidParams, `Unknown docs page: ${slug}`)
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc.body }] }
  },
)

server.prompt(
  'summarize_doc',
  'Ask the model to summarise one docs page for a customer.',
  { slug: z.string().describe('Page slug, e.g. "deployment"') },
  ({ slug }) => {
    const doc = docs.find((d) => d.slug === slug)
    if (!doc) throw new McpError(ErrorCode.InvalidParams, `Unknown docs page: ${slug}`)
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

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('relay-docs MCP server ready on stdio')
