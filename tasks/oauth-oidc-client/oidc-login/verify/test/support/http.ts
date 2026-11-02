import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'

export interface Running {
  url: string
  close(): Promise<void>
}

export function listen(app: Express): Promise<Running> {
  return new Promise((resolve) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}
