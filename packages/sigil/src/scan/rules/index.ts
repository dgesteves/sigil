import { BUNDLED_RULES } from './bundled.js'
import { CONFORMANCE_RULES } from './conformance.js'
import { CREDENTIAL_RULES, EXFILTRATION_RULES } from './credentials.js'
import { INJECTION_RULES } from './injection.js'
import { META_RULES } from './meta.js'
import { OBFUSCATION_RULES } from './obfuscation.js'
import { POLICY_RULES } from './policy.js'
import { REMOTE_CODE_RULES } from './remote-code.js'
import type { FileRule, LineRule, Rule, UnitRule } from './rule.js'
import { DESTRUCTIVE_RULES, PERSISTENCE_RULES } from './system.js'
import { UNICODE_RULES } from './unicode.js'

export const RULES: readonly Rule[] = [
  ...REMOTE_CODE_RULES,
  ...OBFUSCATION_RULES,
  ...UNICODE_RULES,
  ...INJECTION_RULES,
  ...CREDENTIAL_RULES,
  ...EXFILTRATION_RULES,
  ...PERSISTENCE_RULES,
  ...DESTRUCTIVE_RULES,
  ...BUNDLED_RULES,
  ...CONFORMANCE_RULES,
  ...POLICY_RULES,
  ...META_RULES,
]

export const LINE_RULES = RULES.filter((r): r is LineRule => r.scope === 'line')
export const FILE_RULES = RULES.filter((r): r is FileRule => r.scope === 'file')
export const UNIT_RULES = RULES.filter((r): r is UnitRule => r.scope === 'unit')

/** Rule metadata by id, deduplicated (a few ids have both a line and a file form). */
export const RULE_META = new Map<string, Rule>()
for (const r of RULES) if (!RULE_META.has(r.id)) RULE_META.set(r.id, r)

/** Every distinct OWASP id a rule maps to, for SARIF taxa. */
export const OWASP_IDS = [
  ...new Set(RULES.map((r) => r.owasp).filter((x): x is string => Boolean(x))),
].sort()

export * from './rule.js'
