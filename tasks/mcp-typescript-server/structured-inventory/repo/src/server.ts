import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { formatPrice, loadInventory, totalStock } from './inventory.ts'

export function createServer(): McpServer {
  const items = loadInventory()
  const server = new McpServer({ name: 'inventory', version: '1.2.0' })

  server.registerTool(
    'list_items',
    {
      title: 'List items',
      description: 'List every item in the catalogue with its SKU, price and total stock.',
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: items
            .map((i) => `${i.sku}  ${i.name}  ${formatPrice(i.priceCents)}  ${totalStock(i)} in stock`)
            .join('\n'),
        },
      ],
    }),
  )

  server.registerTool(
    'get_item',
    {
      title: 'Get item',
      description: 'Price and stock for one item, by SKU.',
      inputSchema: z.object({ sku: z.string().describe('SKU, e.g. "SKU-1001"') }),
    },
    async ({ sku }) => {
      const item = items.find((i) => i.sku === sku)
      if (!item) {
        return { content: [{ type: 'text', text: `No item with SKU ${sku}.` }] }
      }
      const where = Object.entries(item.stock)
        .map(([warehouse, qty]) => `${warehouse} ${qty}`)
        .join(', ')
      return {
        content: [
          {
            type: 'text',
            text: `${item.name} (${item.sku}): ${formatPrice(item.priceCents)}, ${totalStock(item)} in stock (${where})`,
          },
        ],
      }
    },
  )

  return server
}

serveStdio(createServer)
console.error('inventory-mcp ready on stdio')
