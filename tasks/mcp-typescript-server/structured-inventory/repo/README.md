# inventory-mcp

MCP server that answers stock and price questions for the shop's support assistant. The catalogue
lives in `data/inventory.json`; the server speaks MCP over stdio and uses the official TypeScript
SDK (v2).

```sh
npm install
npm start          # node src/server.ts
npm test
npm run typecheck
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_items` | Every SKU with its price and total stock. |
| `get_item` | Price and per-warehouse stock for one SKU. |

Warehouse codes: `LIS` (Lisbon), `NYC` (New York), `BER` (Berlin).
