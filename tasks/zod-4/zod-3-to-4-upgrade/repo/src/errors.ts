import type { z } from 'zod'

export interface ApiIssue {
  path: string
  message: string
}

export function toApiIssues(error: z.ZodError): ApiIssue[] {
  return error.errors.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}
