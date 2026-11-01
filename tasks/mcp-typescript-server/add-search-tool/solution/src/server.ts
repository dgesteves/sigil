import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { loadNotes, newestFirst, summarize } from './notes.ts'

const NoteSummary = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string().describe('ISO 8601 timestamp of the last edit'),
})
const NoteList = z.object({ notes: z.array(NoteSummary) })

export function createServer(): McpServer {
  const notes = loadNotes()
  const server = new McpServer({ name: 'notes', version: '0.3.0' })

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description: 'List notes, most recently updated first. Optionally only notes with a given tag.',
      inputSchema: z.object({
        tag: z.string().optional().describe('Only return notes with this tag'),
      }),
      outputSchema: NoteList,
    },
    async ({ tag }) => {
      const matches = notes.filter((n) => tag === undefined || n.tags.includes(tag))
      const output = { notes: matches.sort(newestFirst).map(summarize) }
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      }
    },
  )

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description:
        'Find notes whose title or body contains the query (case-insensitive), most recently updated first.',
      inputSchema: z.object({
        query: z.string().trim().min(1, 'query must not be blank').describe('Text to look for'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum results (1-50)'),
      }),
      outputSchema: NoteList,
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const needle = query.toLowerCase()
      const matches = notes.filter(
        (n) => n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle),
      )
      const output = { notes: matches.sort(newestFirst).slice(0, limit).map(summarize) }
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      }
    },
  )

  server.registerTool(
    'get_note',
    {
      title: 'Get note',
      description: 'Get one note, including its full body, by id.',
      inputSchema: z.object({ id: z.string().describe('Note id, e.g. "n-104"') }),
    },
    async ({ id }) => {
      const note = notes.find((n) => n.id === id)
      if (!note) {
        return {
          content: [{ type: 'text', text: `No note with id "${id}". Use list_notes to find ids.` }],
          isError: true,
        }
      }
      return { content: [{ type: 'text', text: `# ${note.title}\n\n${note.body}` }] }
    },
  )

  return server
}

serveStdio(createServer)
console.error('notes-mcp ready on stdio')
