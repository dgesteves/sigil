export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Config {
  port: number
  databaseUrl: string
  logLevel: LogLevel
  enableMetrics: boolean
  /** Origins allowed to call the billing API from a browser (CORS). */
  allowedOrigins: string[]
  requestTimeoutMs: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parseInt(env.PORT || '3000'),
    databaseUrl: env.DATABASE_URL!,
    logLevel: (env.LOG_LEVEL as LogLevel) || 'info',
    enableMetrics: Boolean(env.ENABLE_METRICS),
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(','),
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS) || 5000,
  }
}
