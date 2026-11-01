import type { Hit } from '../types.js'
import type { FileContext, FileRule } from './rule.js'

/**
 * Policy payloads and agent settings fragments declare what an agent may do. A policy that broadens
 * authority — allow-all Bash, no approvals, no sandbox, a wildcard MCP trust — is the capability
 * weakening the user's defences (OWASP AST06). We read the structure, not just the text.
 */

const ALLOW_FIELDS = [
  'allow',
  'permissions',
  'allowedTools',
  'allowed_tools',
  'autoApprove',
  'auto_approve',
  'tools',
  'allowlist',
]
const WILDCARD_TOOL =
  /^(?:\*|all|Bash|Bash\(\s*\*?\s*\)|Bash\(\s*:\s*\*\s*\)|Shell|Execute|.*\(\s*\*\s*\))$/i
const DANGEROUS_BASH = /^Bash\(\s*(?:\*|:?\s*\*|rm\b|sudo\b|curl\b|wget\b|chmod\b|eval\b)/i

function values(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (v && typeof v === 'object') return Object.keys(v as object)
  return []
}

export const overbroadPermissions: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-100',
  name: 'overbroad-permission-policy',
  family: 'conformance',
  title: 'Policy grants all or dangerous tools',
  owasp: 'AST03',
  severity: 'high',
  suppressible: true,
  help: 'An allowlist containing `*`, `Bash`, `Bash(*)` or `Bash(sudo:*)` lets the agent run anything without asking, which is the whole point of the approval system (OWASP AST03/AST06). A policy should enumerate the exact tools and command prefixes it needs.',
  falsePositives:
    'A deny-list using `*` as a base before narrowing is legitimate; this rule only flags `*`-style entries under allow/permission fields, not under deny.',
  check({ file, config }) {
    if (!isPolicyFile(file, config)) return []
    const data = config?.data
    if (!data || typeof data !== 'object') return []
    const hits: Hit[] = []
    const visit = (node: unknown, path: string[]): void => {
      if (Array.isArray(node)) {
        for (const x of node) visit(x, path)
        return
      }
      if (!node || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      const parent = path.at(-1) ?? ''
      const denyContext = path.some((p) => /deny|disallow|block|reject/i.test(p))
      for (const [k, v] of Object.entries(o)) {
        if (ALLOW_FIELDS.includes(k) && !denyContext && !/deny|disallow|block/i.test(k)) {
          for (const entry of values(v)) {
            const line = lineOf(file, entry) ?? lineOf(file, k) ?? 1
            if (WILDCARD_TOOL.test(entry.trim()))
              hits.push({
                line,
                severity: 'high',
                message: `policy allows "${entry}" — unrestricted tool or shell access`,
                snippet: entry,
              })
            else if (DANGEROUS_BASH.test(entry.trim()))
              hits.push({
                line,
                severity: 'high',
                message: `policy allows a dangerous command pattern "${entry}"`,
                snippet: entry,
              })
          }
        }
        visit(v, [...path, k])
      }
      void parent
    }
    visit(data, [])
    return hits
  },
}

const SANDBOX_KEYS = /^(?:sandbox|sandbox_mode|sandboxMode|isolation|containment)$/i
const SANDBOX_OFF_VALUE = /^(?:none|off|false|disabled|danger-full-access|host|no)$/i
const APPROVAL_KEYS =
  /^(?:approval|approvalPolicy|approval_policy|approvalMode|approval_mode|permissionMode|permission_mode|defaultMode|askForApproval|ask_for_approval|requireApproval|require_approval|confirm|confirmations?)$/i
const APPROVAL_OFF_VALUE =
  /^(?:never|none|off|false|no|bypass|bypassPermissions|auto|full-auto|yolo|untrusted|disabled|0)$/i
const BOOL_OFF = new Set([false, 0, 'false', 'no', '0'])

export const sandboxPolicyOff: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-101',
  name: 'sandbox-policy-disabled',
  family: 'conformance',
  title: 'Policy turns off the sandbox or approvals',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  help: 'A settings fragment setting `sandbox: none`, `approval_policy: never`, `permissionMode: bypassPermissions` or `requireApproval: false` removes the containment and human-in-the-loop the user relies on (OWASP AST06). A capability should never ship a policy that disables these.',
  falsePositives:
    'A capability that documents how to raise the sandbox (turning things on) is not matched; only disabling values are. Suppress with a reason for a policy whose purpose is to relax a specific setting.',
  check({ file, config }) {
    if (!isPolicyFile(file, config)) return []
    const data = config?.data
    if (!data || typeof data !== 'object') return []
    const hits: Hit[] = []
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const x of node) visit(x)
        return
      }
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const val = typeof v === 'string' ? v.trim() : v
        if (
          SANDBOX_KEYS.test(k) &&
          typeof val !== 'object' &&
          (SANDBOX_OFF_VALUE.test(String(val)) || BOOL_OFF.has(val as never))
        ) {
          hits.push({
            line: lineOf(file, k) ?? 1,
            severity: 'high',
            message: `policy disables the sandbox (${k}: ${String(val)})`,
            snippet: `${k}: ${String(val)}`,
          })
        }
        if (
          APPROVAL_KEYS.test(k) &&
          typeof val !== 'object' &&
          (APPROVAL_OFF_VALUE.test(String(val)) || BOOL_OFF.has(val as never))
        ) {
          hits.push({
            line: lineOf(file, k) ?? 1,
            severity: 'high',
            message: `policy removes approval prompts (${k}: ${String(val)})`,
            snippet: `${k}: ${String(val)}`,
          })
        }
        if (/^enableAllProjectMcpServers$/i.test(k) && val === true) {
          hits.push({
            line: lineOf(file, k) ?? 1,
            severity: 'medium',
            message: 'policy auto-enables every project MCP server without review',
          })
        }
        visit(v)
      }
    }
    visit(data)
    return hits
  },
}

export const wildcardMcpTrust: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-102',
  name: 'wildcard-mcp-trust',
  family: 'conformance',
  title: 'MCP configuration trusts all servers or tools',
  owasp: 'AST06',
  severity: 'medium',
  suppressible: true,
  help: 'Auto-approving every MCP tool (`alwaysAllow: ["*"]`, `trust: all`, `autoApprove: true`) lets any connected server run any tool without a prompt. Trust specific tools, not a wildcard.',
  falsePositives:
    'A single-server dev setup that trusts its one named tool is fine; the rule targets `*` and all-servers switches.',
  check({ file, config }) {
    if (!config?.data || typeof config.data !== 'object') return []
    const hits: Hit[] = []
    const visit = (node: unknown, inMcp: boolean): void => {
      if (Array.isArray(node)) {
        for (const x of node) visit(x, inMcp)
        return
      }
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const here = inMcp || /mcp|context_servers|mcpServers/i.test(k)
        if (
          here &&
          /^(?:alwaysAllow|always_allow|autoApprove|auto_approve|trust|trustedTools)$/i.test(k)
        ) {
          const vals = values(v)
          if (
            v === true ||
            v === 'all' ||
            vals.some((e) => e.trim() === '*' || /^all$/i.test(e.trim()))
          )
            hits.push({
              line: lineOf(file, k) ?? 1,
              severity: 'medium',
              message: `MCP config trusts all tools (${k})`,
              snippet: k,
            })
        }
        visit(v, here)
      }
    }
    visit(config.data, false)
    return hits
  },
}

function isPolicyFile(file: FileContext['file'], config?: FileContext['config']): boolean {
  if (!config) return false
  const base = file.path.split('/').at(-1) ?? ''
  return (
    /settings(?:\.local)?\.json$/.test(base) ||
    base === '.mcp.json' ||
    base === 'mcp.json' ||
    /(?:^|\/)\.(?:claude|codex|cursor|gemini|windsurf|opencode|aider)\//.test(file.path) ||
    /permissions?|policy|policies/i.test(file.path)
  )
}

/** First line whose text contains the JSON-encoded or plain form of a value. */
function lineOf(file: FileContext['file'], value: string): number | undefined {
  const needle = value.slice(0, 50)
  return file.lines.find((l) => l.raw.includes(needle))?.n
}

export const POLICY_RULES = [overbroadPermissions, sandboxPolicyOff, wildcardMcpTrust] as const
