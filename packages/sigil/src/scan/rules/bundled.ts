import type { Hit } from '../types.js'
import type { FileRule, UnitRule } from './rule.js'

/* ------------------------------------------------------------------------------------------------
 * Risky bundled files (unit scope: it reasons over the whole file inventory)
 * ---------------------------------------------------------------------------------------------- */

export const bundledBinary: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-080',
  name: 'bundled-executable',
  family: 'bundled',
  title: 'Executable, bytecode or disguised binary in the payload',
  owasp: 'AST08',
  severity: 'high',
  suppressible: true,
  help: 'Compiled executables (ELF, Mach-O, PE, Wasm) and bytecode (`.pyc`, `.class`) cannot be reviewed as source and are not scanned for behaviour; Trail of Bits hid a payload in a `.pyc` whose source looked clean. A disguised type (a ZIP named `.txt`) is worse. Ship source, and let the lab build artefacts.',
  falsePositives:
    'A `tool` capability legitimately ships a binary; declare it and suppress with a reason, or publish the source and a reproducible build.',
  check({ entries }) {
    const hits: Hit[] = []
    for (const e of entries) {
      if (e.type === 'binary' && (e.class === 'executable' || e.class === 'bytecode')) {
        hits.push({
          file: e.path,
          severity: e.class === 'bytecode' ? 'high' : 'high',
          message: `${e.format} ${e.class} in the payload (${e.bytes} bytes): not reviewable as source`,
        })
      } else if (e.type === 'disguised') {
        hits.push({
          file: e.path,
          severity: 'high',
          message: `file is actually ${e.format}, not what its extension claims: a classic way to hide a payload from scanners`,
        })
      }
    }
    return hits
  },
}

export const bundledArchive: UnitRule = {
  scope: 'unit',
  id: 'SIG-SEC-081',
  name: 'bundled-archive',
  family: 'bundled',
  title: 'Archive in the payload, especially encrypted or holding code',
  owasp: 'AST08',
  severity: 'medium',
  suppressible: true,
  help: "Archives let code ride along unscanned: a `.docx` is a ZIP, and Trail of Bits' `context-loader` carried a shell script inside one. Sigil opens archives and scans text members; an encrypted member cannot be opened and is treated as high (the password exists to stop scanners).",
  falsePositives:
    'Test fixtures and sample documents are legitimate; a media archive with no code member is reported at low.',
  check({ entries }) {
    const hits: Hit[] = []
    for (const e of entries) {
      if (e.type === 'binary' && e.class === 'archive') {
        hits.push({
          file: e.path,
          severity: e.office ? 'medium' : 'low',
          message: `${e.format} archive in the payload${e.office ? ' (Office document: a ZIP that can carry scripts)' : ''}`,
        })
      } else if (e.type === 'archive-member' && e.encrypted) {
        hits.push({
          file: `${e.archive}!/${e.member}`,
          severity: 'high',
          message:
            'encrypted archive member cannot be inspected; encryption inside a payload hides content from scanners',
        })
      } else if (e.type === 'archive-member' && e.executable) {
        hits.push({
          file: `${e.archive}!/${e.member}`,
          severity: 'medium',
          message: 'archive contains an executable or script member',
        })
      } else if (e.type === 'archive-incomplete') {
        hits.push({
          file: e.archive,
          severity: 'low',
          message: `archive could not be fully inspected (${e.reason})`,
        })
      }
    }
    return hits
  },
}

const MINIFIED = /(?:^|\n)[^\n]{1200,}/ // one very long line
const PACKER =
  /\b(?:eval\(function\(p,a,c,k,e,[dr]\)|_0x[0-9a-f]{4,}|\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){40,})/i

export const packedCode: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-082',
  name: 'packed-code',
  family: 'bundled',
  title: 'Minified or packed script',
  owasp: 'AST08',
  severity: 'medium',
  suppressible: true,
  help: 'Minified or obfuscated JavaScript (one enormous line, `eval(function(p,a,c,k,e,d)…)`, `_0x`-mangled names, long `\\x` runs) cannot be reviewed and is a standard way to hide behaviour. Ship readable source and let the build minify.',
  falsePositives:
    'A legitimately minified vendored library matches; move it out of the payload or suppress with a reason. Reported only for script/data files.',
  check({ file }) {
    if (file.role !== 'script' && file.language !== 'html') return []
    const packer = PACKER.exec(file.text)
    if (packer) {
      const line = file.text.slice(0, packer.index).split('\n').length
      return [
        {
          line,
          severity: 'medium',
          message: 'script looks packed or obfuscated (not human-readable source)',
        },
      ]
    }
    if (MINIFIED.test(file.text) && file.language === 'js') {
      const line = file.lines.find((l) => l.raw.length >= 1200)?.n ?? 1
      return [
        {
          line,
          severity: 'low',
          message: 'minified script (very long lines): review the original source instead',
        },
      ]
    }
    return []
  },
}

const INSTALL_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'preuninstall',
  'postuninstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'preprepare',
  'postprepare',
])

export const packageInstallScript: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-083',
  name: 'package-install-script',
  family: 'bundled',
  title: 'package.json lifecycle install script',
  owasp: 'AST02',
  severity: 'medium',
  suppressible: true,
  help: 'npm runs `preinstall`/`install`/`postinstall`/`prepare` automatically on `npm install`, before any code is reviewed; this is the classic npm supply-chain foothold (and CVE-2025-59536-style repo-open RCE). A capability should not need install-time execution. Its contents are also scanned as scripts.',
  falsePositives:
    'A build `prepare` that compiles TypeScript is common; it still runs automatically, so it is reported at low when it only calls a local build.',
  check({ file, config }) {
    if (
      (file.path.split('/').at(-1) ?? '') !== 'package.json' ||
      !config?.data ||
      typeof config.data !== 'object'
    )
      return []
    const scripts = (config.data as { scripts?: Record<string, unknown> }).scripts
    if (!scripts) return []
    const hits: Hit[] = []
    for (const [name, cmd] of Object.entries(scripts)) {
      if (!INSTALL_SCRIPTS.has(name) || typeof cmd !== 'string') continue
      const local =
        /^(?:node\s+|npm\s+run\s+|tsc\b|tsup\b|tsdown\b|rollup\b|vite\s+build|pnpm\s+run\s+)/.test(
          cmd.trim(),
        )
      const line = file.lines.find((l) => l.raw.includes(`"${name}"`))?.n ?? 1
      hits.push({
        line,
        severity: local ? 'low' : 'medium',
        message: `"${name}" runs automatically on install: ${cmd.slice(0, 80)}`,
        snippet: `"${name}": "${cmd.slice(0, 80)}"`,
      })
    }
    return hits
  },
}

export const BUNDLED_RULES = [
  bundledBinary,
  bundledArchive,
  packedCode,
  packageInstallScript,
] as const
