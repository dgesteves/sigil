/** Absolute origin for metadata, OG images and llms.txt. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:4317')

export const TAGLINE = 'Every AI agent capability, proven.'
export const DESCRIPTION =
  'The open proving ground for AI agent capabilities. Sigil measures whether a skill, rule, hook, subagent or MCP server makes a coding agent better, scans it for malicious behaviour, seals the exact content it tested and installs it into any agent.'
