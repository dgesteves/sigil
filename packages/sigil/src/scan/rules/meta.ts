import type { Hit } from '../types.js'
import type { UnitRule } from './rule.js'

/** Rules the engine reports from its own bookkeeping (symlinks, unscannable files, bad suppressions). */

export const symlinkEscape: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-084',
  name: 'symlink',
  family: 'bundled',
  title: 'Symbolic link in the payload',
  owasp: 'AST08',
  severity: 'medium',
  suppressible: true,
  help: 'A symlink can point outside the capability and change what is read or installed after review; one that escapes the directory can leak or clobber a file beyond it. The digest refuses symlinks for catalog capabilities; scan reports them everywhere. Ship real files.',
  falsePositives:
    'A symlink staying inside the payload (into a shared references dir) is reported at low. Any link escaping the unit is medium.',
  check({ entries }) {
    const hits: Hit[] = []
    for (const e of entries)
      if (e.type === 'symlink')
        hits.push({
          file: e.path,
          severity: e.escapes ? 'medium' : 'low',
          message: e.escapes
            ? `symlink escapes the payload: ${e.path} -> ${e.target}`
            : `symlink inside the payload: ${e.path} -> ${e.target}`,
        })
    return hits
  },
}

export const unscannableFile: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-085',
  name: 'unscannable-file',
  family: 'bundled',
  title: 'File could not be scanned',
  owasp: 'AST08',
  severity: 'low',
  suppressible: true,
  help: "A file the scanner cannot read as text or open as a known container is a blind spot: Trail of Bits' bypasses all lived in formats scanners skipped. It is reported so a reviewer looks by hand. Convert it to a reviewable form or justify it.",
  falsePositives:
    'Legitimate media and data assets are reported here at low; large media is expected in some capabilities.',
  check({ entries }) {
    return entries
      .filter((e): e is Extract<typeof e, { type: 'unscannable' }> => e.type === 'unscannable')
      .map((e) => ({ file: e.path, severity: 'low' as const, message: `not scanned: ${e.reason}` }))
  },
}

export const invalidSuppression: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-900',
  name: 'invalid-suppression',
  family: 'meta',
  title: 'sigil-scan-ignore without rule ids and a reason',
  suppressible: false,
  severity: 'low',
  help: 'A suppression must name the rule ids it waives and give a reason: `sigil-scan-ignore SIG-SEC-001: vendored installer, reviewed`. An ignore comment without both is itself reported, so suppressions cannot silently swallow findings.',
  falsePositives: 'None: the comment is either well-formed or it is reported.',
  check: () => [],
}

export const META_RULES = [symlinkEscape, unscannableFile, invalidSuppression] as const
