import type { Severity } from '../../core/index.js'
import type { Hit } from '../types.js'
import type { UnitRule } from './rule.js'

/**
 * Manifest conformance: the hosts, commands and environment variables a capability actually uses, set
 * against what sigil.yaml declares. Undeclared use is a finding (permission understatement, OWASP AST03);
 * declared-but-unused is a hygiene note. These run only when the unit has a valid manifest.
 */

/** A declared network host matches a used host if equal or a parent domain (host is a subdomain of it). */
function hostDeclared(used: string, declared: readonly string[]): boolean {
  const u = used.replace(/:\d+$/, '')
  return declared.some((d) => {
    const base = d.replace(/:\d+$/, '')
    return u === base || u.endsWith(`.${base}`)
  })
}

/** A declared shell prefix matches a used command if the command starts with the prefix tokens. */
function commandDeclared(used: string, declared: readonly string[]): boolean {
  const u = used.split(/\s+/)
  return declared.some((d) => {
    const p = d.trim().split(/\s+/)
    return p.length <= u.length && p.every((tok, i) => tok === u[i])
  })
}

const kindCap = (s: Severity, kind: string): Severity =>
  kind === 'example' || kind === 'reference' ? 'low' : s

export const undeclaredNetwork: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-090',
  name: 'undeclared-network',
  family: 'conformance',
  title: 'Contacts a host not declared in permissions.network',
  owasp: 'AST03',
  severity: 'medium',
  suppressible: true,
  help: 'A capability\'s scripts and instructions may only reach hosts its manifest declares. An undeclared host is either an honest omission or an understatement hiding exfiltration (the AST04 "network: false while curl runs" case). Add the host to `permissions.network`, or remove the call.',
  falsePositives:
    'Documentation links (vendor docs, GitHub repos the text references) count as used hosts; add them or move them to a declared docs host. Placeholder hosts (example.com, localhost) are ignored.',
  check({ manifest, facts }) {
    if (!manifest) return []
    const declared = manifest.permissions.network
    const hits: Hit[] = []
    for (const [host, use] of facts.hosts) {
      if (hostDeclared(host, declared)) continue
      hits.push({
        file: use.file,
        line: use.line,
        kind: use.kind,
        severity: kindCap(use.kind === 'script' ? 'high' : 'medium', use.kind),
        message: `contacts ${host}, which is not in permissions.network (declared: ${declared.length ? declared.join(', ') : 'none'})`,
      })
    }
    return hits
  },
}

export const undeclaredCommand: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-091',
  name: 'undeclared-command',
  family: 'conformance',
  title: 'Runs a command not declared in permissions.shell',
  owasp: 'AST03',
  severity: 'low',
  suppressible: true,
  help: 'The commands a capability runs, or tells the agent to run, should match `permissions.shell`. A command outside that list is undeclared authority. This is a hygiene and transparency check; the dangerous-command rules fire independently.',
  falsePositives:
    'Example commands in documentation are counted; keep them in fenced examples (reported at low) or declare the prefix. Shell builtins (cd, echo, test) are ignored.',
  check({ manifest, facts }) {
    if (!manifest) return []
    const declared = manifest.permissions.shell
    const hits: Hit[] = []
    for (const [cmd, use] of facts.commands) {
      if (commandDeclared(cmd, declared)) continue
      hits.push({
        file: use.file,
        line: use.line,
        kind: use.kind,
        severity: kindCap(use.kind === 'script' ? 'medium' : 'low', use.kind),
        message: `runs "${cmd}", not covered by permissions.shell (declared: ${declared.length ? declared.join(', ') : 'none'})`,
      })
    }
    return hits
  },
}

export const undeclaredEnv: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-092',
  name: 'undeclared-env',
  family: 'conformance',
  title: 'Reads an environment variable not declared in permissions.env',
  owasp: 'AST03',
  severity: 'low',
  suppressible: true,
  help: 'Environment variables a capability reads should be declared in `permissions.env` so the user knows what it consumes. Undeclared reads of credential-shaped names (`*_TOKEN`, `*_KEY`, `*_SECRET`) are raised, since that is how a skill quietly harvests secrets.',
  falsePositives:
    'Common runtime variables (PATH, HOME, PWD, CI, language-specific ones) are ignored. A variable the capability sets itself is not a read.',
  check({ manifest, facts }) {
    if (!manifest) return []
    const declared = new Set(manifest.permissions.env)
    const hits: Hit[] = []
    for (const [name, use] of facts.env) {
      if (declared.has(name)) continue
      const secretish = /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|AUTH|PRIVATE)/.test(
        name,
      )
      hits.push({
        file: use.file,
        line: use.line,
        kind: use.kind,
        severity: kindCap(secretish ? 'medium' : 'low', use.kind),
        message: `reads $${name}, not declared in permissions.env${secretish ? ' (looks like a secret)' : ''}`,
      })
    }
    return hits
  },
}

export const undeclaredWrite: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-093',
  name: 'undeclared-filesystem-write',
  family: 'conformance',
  title: 'Writes files while permissions.filesystem forbids it',
  owasp: 'AST03',
  severity: 'medium',
  suppressible: true,
  help: 'When `permissions.filesystem` is `none` or `read`, the capability must not write. A write under a read-only declaration is an understated permission. Set `filesystem: write` if writing is intended, or remove the write.',
  falsePositives:
    'Writing to a temp dir for scratch work still counts; declare `write`. Output redirection in a fenced example is reported at low.',
  check({ manifest, facts }) {
    if (!manifest || manifest.permissions.filesystem === 'write') return []
    return facts.writes.map((use) => ({
      file: use.file,
      line: use.line,
      kind: use.kind,
      severity: kindCap('medium', use.kind) as Severity,
      message: `writes files, but permissions.filesystem is "${manifest.permissions.filesystem}"`,
    }))
  },
}

export const declaredUnused: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-094',
  name: 'declared-unused-permission',
  family: 'conformance',
  title: 'Declares a permission it never uses',
  owasp: 'AST03',
  severity: 'info',
  suppressible: true,
  help: 'A declared host or command that the payload never uses is over-permission: least privilege means declaring only what is needed (OWASP AST03). This is informational; trim the manifest.',
  falsePositives:
    'A capability whose commands are constructed dynamically, or whose network use is in content this scanner cannot see, may trip this. Informational only.',
  check({ manifest, facts }) {
    if (!manifest) return []
    const hits: Hit[] = []
    for (const host of manifest.permissions.network) {
      if (![...facts.hosts.keys()].some((u) => u === host || u.endsWith(`.${host}`)))
        hits.push({
          file: 'sigil.yaml',
          severity: 'info',
          message: `permissions.network declares ${host}, which is never used`,
        })
    }
    for (const cmd of manifest.permissions.shell) {
      if (![...facts.commands.keys()].some((u) => commandDeclared(u, [cmd])))
        hits.push({
          file: 'sigil.yaml',
          severity: 'info',
          message: `permissions.shell declares "${cmd}", which is never used`,
        })
    }
    return hits
  },
}

export const CONFORMANCE_RULES = [
  undeclaredNetwork,
  undeclaredCommand,
  undeclaredEnv,
  undeclaredWrite,
  declaredUnused,
] as const
