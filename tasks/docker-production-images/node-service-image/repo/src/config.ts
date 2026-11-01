export interface Config {
  port: number
  logLevel: string
  shutdownTimeoutMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT must be a TCP port, got ${env.PORT}`)
  return {
    port,
    logLevel: env.LOG_LEVEL ?? 'info',
    shutdownTimeoutMs: Number(env.SHUTDOWN_TIMEOUT_MS ?? 10_000),
  }
}
