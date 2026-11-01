import type * as z from 'zod'

export interface ApiIssue {
  path: string
  message: string
}

export function toApiIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
}
