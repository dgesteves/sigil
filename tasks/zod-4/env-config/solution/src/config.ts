import * as z from 'zod'

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

// Deploy tooling exports unset variables as "", so blank means "not set".
const unset = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const env = <T extends z.ZodType>(schema: T) => z.preprocess(unset, schema)

// z.coerce.number() would turn "" into 0 and accept "0x1f"; parse decimal integers explicitly.
const integer = z
  .string()
  .trim()
  .regex(/^-?\d+$/, 'must be an integer')
  .transform(Number)

const EnvSchema = z.object({
  PORT: env(integer.pipe(z.int().min(1).max(65535)).default(3000)),
  DATABASE_URL: env(z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' })),
  LOG_LEVEL: env(z.enum(['debug', 'info', 'warn', 'error']).default('info')),
  // z.coerce.boolean() is Boolean(value): "false" would become true.
  ENABLE_METRICS: env(z.stringbool({ truthy: ['true', '1', 'yes'], falsy: ['false', '0', 'no'] }).default(false)),
  ALLOWED_ORIGINS: env(
    z
      .string()
      .transform((list) =>
        list
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url({ protocol: /^https$/, error: 'must be an https origin' })))
      .default([]),
  ),
  REQUEST_TIMEOUT_MS: env(integer.pipe(z.int().positive()).default(5000)),
})

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(source)
  if (!result.success) {
    // Issues never carry the input value unless reportInput is set, so secrets stay out of the message.
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`)
  }
  const parsed = result.data
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    logLevel: parsed.LOG_LEVEL,
    enableMetrics: parsed.ENABLE_METRICS,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
  }
}
