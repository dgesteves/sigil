import type { Hit } from '../types.js'
import { type LineRule, table } from './rule.js'

/**
 * Structural signals, not a dictionary of attack strings. Each rule keys on a shape that a benign
 * capability has no reason to contain: revoking the operator's instructions, steering the agent's own
 * configuration, or pairing an action with keeping the user uninformed. This is the same handful of
 * generic patterns every open-source prompt-injection scanner ships; deeper coverage is the lab's
 * behavioural layer and human review, noted as a gap in RULES.md.
 */

// Canonical override shape: a revoke verb aimed at the standing instructions. One pattern, not a corpus.
const OVERRIDE =
  /\b(?:ignore|disregard|forget|override|bypass|discard)\b[^\n]{0,40}?\b(?:all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+|earlier\s+|system\s+|safety\s+)+(?:instructions?|prompts?|rules|guidelines|directives|guardrails|constraints|policies|restrictions)\b/i
// Fake conversation-role markers used to smuggle a new system turn.
const ROLE_MARKER =
  /<\|im_start\|>|<\|(?:system|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?system(?:[-_]prompt)?>/i

export const instructionOverride: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-030',
  name: 'instruction-override',
  family: 'injection',
  title: "Prompt injection: revokes the agent's standing instructions",
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  mentionAware: true,
  table: table('medium', 'high', 'medium', 'low'),
  message: "tries to revoke or override the agent's standing instructions",
  help: 'A capability adds instructions; it never revokes the operator\'s. A revoke verb aimed at the "previous/system/safety instructions", or a fake `<|im_start|>` / `[INST]` / `<system>` role marker, is injection (OWASP AST01; Snyk found injection beside the code in most confirmed malicious skills). Deep semantic coverage is the lab\'s behavioural layer, not this static rule.',
  falsePositives:
    'Security docs that quote these as examples to detect are downgraded by the mention check ("such as", "detect", quotes) and by sitting in a security section.',
  match(line) {
    const m = OVERRIDE.exec(line.text) ?? ROLE_MARKER.exec(line.text)
    return m ? [{ index: m.index }] : []
  },
}

// The agent's highest-trust surfaces: identity, memory, permissions, sandbox and approval flow.
const HIGH_SURFACE =
  /\b(?:SOUL|MEMORY)\.md\b|\.(?:claude|codex|cursor|gemini|aider|windsurf|opencode)\/(?:settings(?:\.local)?|permissions|hooks|mcp)\b|\bsettings\.local\.json\b|\ballowed[- ]?tools\b|\bpermission(?:s)?[- ]?(?:mode|rules|flow)\b|\bauto[- ]?(?:approve|accept)\b|\bskip[- ]?permissions\b/i
// The project's agent-instruction files: editing these is often legitimate, so it is only a warning.
const LOW_SURFACE = /\b(?:CLAUDE|AGENTS|GEMINI)\.md\b/i
// Writing/injecting, not reading or cleaning up. "set"/"read"/"remove" are left out: too noisy, not the backdoor shape.
const WRITE_VERB =
  /\b(?:add|append|write|insert|inject|register|configure|enable|disable|overwrite|replace)\b/i

export const agentConfigTampering: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-031',
  name: 'agent-config-instruction',
  family: 'injection',
  title: "Instruction that edits the agent's own config, memory or approvals",
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'steers the agent to write to its own identity, memory, permissions or approval flow',
  help: "Injecting into `SOUL.md`/`MEMORY.md`, `.claude/settings.json`, `allowed-tools` or auto-approve plants a backdoor that survives the skill (OWASP AST01, SOUL.md persistence). Editing a project's `CLAUDE.md`/`AGENTS.md` is reported more gently, as it is often legitimate.",
  falsePositives:
    'A config- or prompt-auditing skill that edits CLAUDE.md/AGENTS.md on purpose matches at medium; declare the intent and suppress with a reason.',
  match(line) {
    const high = HIGH_SURFACE.exec(line.text)
    const low = high ? null : LOW_SURFACE.exec(line.text)
    const surface = high ?? low
    if (!surface) return []
    const verb = WRITE_VERB.exec(line.text)
    if (!verb || Math.abs(verb.index - surface.index) > 60) return []
    // Project agent-instruction files: downgrade to a warning (medium in instructions/scripts).
    return [
      {
        index: Math.min(verb.index, surface.index),
        ...(high ? {} : { severity: 'medium' as const }),
      },
    ]
  },
}

// Explicitly keeping the user uninformed about an action. Two narrow shapes, not a dictionary of phrases.
const CONCEAL_USER =
  /\b(?:without\s+(?:telling|informing|notifying|alerting)|do\s+not\s+(?:tell|inform|notify|alert)|don'?t\s+(?:tell|inform|notify|alert)|never\s+(?:tell|inform|notify|alert)|hide\s+(?:this|it|these|that)\s+from|keep\s+(?:this|it|that)\s+(?:secret|hidden)\s+from)\b[^\n]{0,24}\b(?:the\s+)?(?:user|human|operator|owner)\b/i
// A covert adverb immediately driving an action verb: "silently exfiltrate", "secretly upload".
const COVERT_ACTION =
  /\b(?:silently|secretly|covertly|stealthily|surreptitiously|discreetly|behind\s+the\s+user'?s?\s+back)\s+(?:then\s+|also\s+|just\s+)?(?:run|execute|install|send|upload|download|post|transmit|exfiltrat\w*|collect|forward|email|copy|delete|connect|curl|wget)\b/i
const ACTION_VERB =
  /\b(?:run|execute|install|send|upload|download|post|transmit|copy|collect|exfiltrat\w*|delete|modify|forward|add|write|fetch|curl|wget|email|push|connect)\b/i

export const concealedAction: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-032',
  name: 'concealed-action',
  family: 'injection',
  title: 'Action paired with keeping the user uninformed',
  owasp: 'AST08',
  severity: 'high',
  suppressible: true,
  mentionAware: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'tells the agent to act while keeping the user uninformed',
  help: 'A legitimate capability has no reason to hide a step from the person running it. "Without telling the user" near an action verb, or a covert adverb driving an action ("silently upload"), is the concealment signal prompt-injection scanners flag (OWASP AST08). Deliberately narrow; the behavioural layer catches the rest.',
  falsePositives:
    'Prose like "silently overwrites" or "silently falls back" describing an unwanted side effect does not match: the adverb must directly drive a transmit/run/delete verb, or the user must be the explicit object of "do not tell".',
  match(line) {
    const covert = COVERT_ACTION.exec(line.text)
    if (covert) return [{ index: covert.index }]
    const conceal = CONCEAL_USER.exec(line.text)
    if (!conceal) return []
    const action = ACTION_VERB.exec(line.text)
    if (!action) return []
    return [{ index: Math.min(conceal.index, action.index) }]
  },
}

export const paddingConcealment = {
  scope: 'file' as const,
  id: 'SIG-SEC-033',
  name: 'padding-concealment',
  family: 'injection' as const,
  title: 'Large blank padding that pushes content out of view',
  owasp: 'AST08',
  severity: 'medium' as const,
  suppressible: true,
  help: 'Trail of Bits hid a payload behind 100,000 newlines so scanners truncated the file and the web UI scrolled past it. A long run of blank or whitespace-only lines, or a wall of trailing spaces, exists to move content past where a reviewer or a size-capped scanner looks. Sigil scans the whole file regardless.',
  falsePositives:
    'Generated or concatenated files can have large blank gaps; reported at low below 2,000 lines of padding.',
  check({ file }: { file: { lines: { n: number; raw: string }[] } }): Hit[] {
    const hits: Hit[] = []
    let run = 0
    let start = 0
    const flush = (end: number) => {
      if (run >= 50) {
        hits.push({
          line: start,
          kind: 'reference',
          severity: run >= 2000 ? 'high' : run >= 200 ? 'medium' : 'low',
          message: `${run} consecutive blank lines (lines ${start}-${end}): padding that hides content from reviewers and size-capped scanners`,
        })
      }
      run = 0
    }
    for (const l of file.lines) {
      if (l.raw.trim() === '') {
        if (run === 0) start = l.n
        run++
      } else {
        flush(l.n - 1)
        if (/\s{300,}$/.test(l.raw))
          hits.push({
            line: l.n,
            kind: 'reference',
            severity: 'low',
            message: 'line padded with hundreds of trailing spaces to push content off-screen',
          })
      }
    }
    flush(file.lines.at(-1)?.n ?? 0)
    return hits
  },
}

export const INJECTION_RULES = [
  instructionOverride,
  agentConfigTampering,
  concealedAction,
  paddingConcealment,
] as const
