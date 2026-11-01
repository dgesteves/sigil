import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { formatPrice, type Item, loadInventory, totalStock } from './inventory.ts'

const ItemDetails = z.object({
  sku: z.string(),
  name: z.string(),
  priceCents: z.number().int().describe('Unit price in euro cents'),
  stock: z.object({
    total: z.number().int(),
    byWarehouse: z.array(
      z.object({
        warehouse: z.string().describe('Warehouse code: LIS, NYC or BER'),
        qty: z.number().int(),
      }),
    ),
  }),
})
type ItemDetails = z.infer<typeof ItemDetails>

function details(item: Item): ItemDetails {
  return {
    sku: item.sku,
    name: item.name,
    priceCents: item.priceCents,
    stock: {
      total: totalStock(item),
      byWarehouse: Object.entries(item.stock).map(([warehouse, qty]) => ({ warehouse, qty })),
    },
  }
}

const itemUri = (sku: string) => `inventory://items/${encodeURIComponent(sku)}`

export function createServer(): McpServer {
  const items = loadInventory()
  const find = (sku: string) => items.find((i) => i.sku === sku)
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
      outputSchema: ItemDetails,
      annotations: { readOnlyHint: true },
    },
    async ({ sku }) => {
      const item = find(sku)
      if (!item) {
        return {
          content: [{ type: 'text', text: `No item with SKU ${sku}. Use list_items to see valid SKUs.` }],
          isError: true,
        }
      }
      const output = details(item)
      const where = output.stock.byWarehouse.map((w) => `${w.warehouse} ${w.qty}`).join(', ')
      return {
        content: [
          {
            type: 'text',
            text: `${item.name} (${item.sku}): ${formatPrice(item.priceCents)}, ${output.stock.total} in stock (${where})`,
          },
        ],
        structuredContent: output,
      }
    },
  )

  server.registerResource(
    'item',
    new ResourceTemplate('inventory://items/{sku}', {
      list: async () => ({
        resources: items.map((i) => ({
          uri: itemUri(i.sku),
          name: i.sku,
          title: i.name,
          mimeType: 'application/json',
        })),
      }),
    }),
    { title: 'Inventory item', description: 'One catalogue item as JSON', mimeType: 'application/json' },
    async (uri, { sku }) => {
      const item = typeof sku === 'string' ? find(decodeURIComponent(sku)) : undefined
      if (!item) throw new ResourceNotFoundError(uri.href)
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(details(item)) },
        ],
      }
    },
  )

  return server
}

serveStdio(createServer)
console.error('inventory-mcp ready on stdio')
