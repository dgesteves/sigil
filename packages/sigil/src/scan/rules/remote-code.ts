import type { Hit } from '../types.js'
import { FETCHER, PIPE, SINK, urlRisk } from './patterns.js'
import { type FileRule, first, type LineRule, PASTE_HOSTS, table } from './rule.js'

const STRICT = table('high', 'high', 'medium', 'low')

const PIPE_TO_SHELL = [
  new RegExp(`${FETCHER}[^\\n;]{0,400}?${PIPE}\\s*${SINK}`, 'i'),
  /(?:\b(?:ba|z|k)?sh|\bsource|(?:^|\s)\.)\s+<\s*\(\s*(?:curl|wget|fetch)\b/i,
  /(?:\b(?:ba|z|k)?sh\s+-c|\beval|\bexec|\bsource|\bpython[0-9.]*\s+-c|\bnode\s+-e)\s+["']?(?:\$\(|`)\s*(?:curl|wget|fetch)\b/i,
  /\bexec\s*\([^\n]{0,120}?\b(?:urlopen|requests\.get|httpx\.get|urllib\.request)\b/i,
  /\b(?:eval|new\s+Function)\s*\([^\n]{0,120}?\bfetch\s*\(|\beval\s*\(\s*await\b/i,
  /\beval\s*\(?\s*(?:URI\.open|Net::HTTP\.get|open\(\s*["']https?:)/i,
  /\beval\s*\(\s*file_get_contents\s*\(\s*["']https?:/i,
]

export const pipeToShell: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-001',
  name: 'pipe-to-shell',
  family: 'remote-code',
  title: 'Remote download piped into an interpreter',
  owasp: 'AST01',
  severity: 'critical',
  suppressible: true,
  table: STRICT,
  message:
    'pipes a download straight into an interpreter: the code that runs is fetched at run time, never reviewed or sealed',
  help: 'The fetched script can change at any time, and differs per caller if the server wants it to. ClawHavoc delivered the AMOS stealer this way. Vendor the script into the capability (so it is sealed by the digest) or pin it by hash and run it from a file.',
  falsePositives:
    'Official installers (`curl -fsSL https://bun.sh/install | bash`) are still flagged: the content is not sealed. Suppress with a reason if you accept the vendor risk.',
  match(line) {
    const risk = urlRisk(line.text)
    return first(PIPE_TO_SHELL, line.text, {
      bump: risk.bump,
      ...(risk.why
        ? { message: `pipes a download from a ${risk.why} straight into an interpreter` }
        : {}),
    })
  },
}

const PS_EXEC = [
  /\b(?:iex|Invoke-Expression)\b[^\n]{0,300}?\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadData|Net\.WebClient|Start-BitsTransfer)\b/i,
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b[^\n]{0,300}?\|\s*(?:iex|Invoke-Expression)\b/i,
  /\bcertutil(?:\.exe)?\b[^\n]{0,80}?\s[-/]urlcache\b/i,
  /\bbitsadmin(?:\.exe)?\b[^\n]{0,80}?\/transfer\b/i,
  /\bmshta(?:\.exe)?\s+["']?(?:https?|vbscript|javascript):/i,
  /\brundll32(?:\.exe)?\b[^\n]{0,80}?javascript:/i,
  /\bregsvr32(?:\.exe)?\b[^\n]{0,80}?\/i:\s*https?:/i,
]
const PS_ENCODED =
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,120}?\s-(?:e|ec|en|enc|encodedcommand|encoded\w*)\s+[A-Za-z0-9+/=]{12,}/i

export const powershellExec: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-002',
  name: 'windows-download-exec',
  family: 'remote-code',
  title: 'PowerShell or Windows LOLBin download-and-execute',
  owasp: 'AST01',
  severity: 'critical',
  suppressible: true,
  table: STRICT,
  message: 'downloads and executes code with PowerShell or a Windows system binary',
  help: '`iex (iwr …)`, `-EncodedCommand`, `certutil -urlcache`, `bitsadmin /transfer`, `mshta http…` and `regsvr32 /i:http…` are the Windows equivalents of `curl | sh` and the standard first stage of commodity malware. Ship the script inside the capability instead.',
  falsePositives:
    'Rare outside installers. Chocolatey and Scoop install one-liners use `iex (irm …)` and are flagged on purpose.',
  match(line) {
    const enc = PS_ENCODED.exec(line.text)
    if (enc)
      return [
        {
          index: enc.index,
          bump: 1,
          message: 'runs a base64-encoded PowerShell command (-EncodedCommand)',
        },
      ]
    return first(PS_EXEC, line.text, { bump: urlRisk(line.text).bump })
  },
}

const DOWNLOAD_TO_FILE =
  /\b(?:curl\b[^\n]{0,300}?\s(?:-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b)|wget\b(?![^\n]*\s-q?O\s*-)|aria2c\b|Invoke-WebRequest\b[^\n]{0,300}?-OutFile\b|iwr\b[^\n]{0,300}?-(?:OutFile|o)\b|Start-BitsTransfer\b|urlretrieve\s*\(|DownloadFile\s*\()/i
const RUN_FILE =
  /\bchmod\s+(?:-\w+\s+)*(?:[ugoa]*\+[rw]*x|[0-7]?[0-7]{2}[1357]|[0-7]?[1357][0-7]{2})\b|(?:^|[;&|]\s*|\s)\.\/[\w.-]+|\b(?:ba|z)?sh\s+(?:\/tmp\/|\$TMPDIR|\/var\/tmp\/|\$\{?TMP)|\bopen\s+\S+\.(?:dmg|pkg|app)\b|\binstaller\s+-pkg\b|\bhdiutil\s+attach\b|\bStart-Process\b|\bmsiexec\b/i
const DOWNLOAD_PROSE =
  /\b(?:download|get|grab|fetch|install)\b[^\n.]{0,200}?\b(?:and|then|,)\s*(?:then\s+)?(?:run|execute|launch|open|double-click|start)\b/i
const EXECUTABLE_URL =
  /(?:https?:\/\/\S+?\.(?:exe|dmg|pkg|msi|app|appimage|bin|run|scr|bat|cmd|ps1|command|deb|rpm)\b|\/releases\/download\/\S+\.(?:exe|dmg|pkg|msi|appimage|bin|run))/i
const ARCHIVE_URL =
  /(?:https?:\/\/\S+?\.(?:zip|7z|rar|tar\.gz|tgz|tar\.xz)\b|\/releases\/download\/)/i

export const downloadAndRun: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-003',
  name: 'download-and-run',
  family: 'remote-code',
  title: 'Downloads a file and makes it executable or runs it',
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  help: 'Downloading a binary or script, then `chmod +x` / `./file` / opening a `.dmg` or `.pkg`, runs code that is not part of the reviewed capability. ClawHavoc told users to download an "openclaw-core" prerequisite and run it. Bundle what you need, or document a package-manager install with a pinned version.',
  falsePositives:
    'Tool installers that fetch a pinned release binary are flagged too; prefer a package manager or verify a checksum in the same step and suppress with a reason.',
  check({ file }) {
    const hits: Hit[] = []
    const code = file.lines.filter((l) => l.code && !l.virtual)
    code.forEach((l, i) => {
      const run = RUN_FILE.exec(l.text)
      if (!run) return
      const window = code.slice(Math.max(0, i - 3), i + 1).filter((w) => w.kind === l.kind)
      if (window.some((w) => DOWNLOAD_TO_FILE.test(w.text))) {
        const sev = l.kind === 'example' ? 'low' : l.kind === 'reference' ? 'medium' : 'high'
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: sev,
          message: 'downloads a file and then makes it executable or runs it',
          snippet: l.raw,
        })
      }
    })
    // Prose: "Download [tool](…/releases/download/…/x.zip) and run the executable".
    const prose = file.lines.filter((l) => !l.code && !l.virtual)
    prose.forEach((l, i) => {
      if (!DOWNLOAD_PROSE.test(l.text)) return
      const window = prose
        .slice(Math.max(0, i - 2), i + 2)
        .map((w) => w.text)
        .join(' ')
      const exe = EXECUTABLE_URL.test(window)
      if (!exe && !ARCHIVE_URL.test(window)) return
      const base =
        l.kind === 'example' ? 'low' : l.kind === 'reference' ? 'medium' : exe ? 'high' : 'medium'
      hits.push({
        line: l.n,
        kind: l.kind,
        severity: base,
        message: exe
          ? 'tells the reader to download an executable and run it'
          : 'tells the reader to download an archive and run what is inside',
        snippet: l.raw,
      })
    })
    return hits
  },
}

const INSTALLER = String.raw`\b(?:npx|bunx|pnpm\s+(?:dlx|add|install|i)|yarn\s+(?:dlx|add)|npm\s+(?:exec|install|i|add)|bun\s+(?:add|install|x)|pip[0-9.]*\s+install|python[0-9.]*\s+-m\s+pip\s+install|uv\s+(?:pip\s+install|add|tool\s+install|tool\s+run|run\s+--with)|uvx|pipx\s+(?:install|run)|gem\s+install|cargo\s+install|composer\s+require)\b`
const URL_SOURCE = new RegExp(
  `${INSTALLER}[^\\n;&|]{0,200}?(?:\\s|=|@)((?:git\\+(?:https?|ssh)|https?:\\/\\/|git@|github:|gitlab:|bitbucket:)[^\\s'"]+)`,
  'i',
)
const CUSTOM_INDEX = new RegExp(
  `${INSTALLER}[^\\n;&|]{0,200}?\\s--?(?:index-url|extra-index-url|registry|find-links|trusted-host|i)[= ]\\s*['"]?(\\S+?)['"]?(?:\\s|$)`,
  'i',
)
const DEFAULT_INDEX =
  /^(?:https?:\/\/)?(?:pypi\.org|files\.pythonhosted\.org|registry\.npmjs\.org|registry\.yarnpkg\.com)(?:\/|$)/i
const PINNED = /[@#](?:[0-9a-f]{40})\b|#sha256=|--hash[= ]/i

export const remotePackageSource: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-004',
  name: 'remote-package-source',
  family: 'remote-code',
  title: 'Package installed from a URL, git ref or custom index',
  owasp: 'AST02',
  severity: 'high',
  suppressible: true,
  table: STRICT,
  message:
    'installs a package straight from a URL or git repository, bypassing the registry and any lockfile',
  help: 'Installing from `git+https://…`, a tarball URL or `github:user/repo` runs whatever that ref points at today; install scripts run with your privileges. A custom `--index-url` / `--registry` enables dependency confusion. Publish to the registry and pin an exact version, or pin a full commit SHA.',
  falsePositives:
    'Vendor package indexes such as `download.pytorch.org` are reported at medium. Git sources pinned to a 40-character commit are not reported.',
  match(line) {
    const src = URL_SOURCE.exec(line.text)
    if (src && !PINNED.test(src[1] ?? '')) return [{ index: src.index }]
    const idx = CUSTOM_INDEX.exec(line.text)
    if (idx && !DEFAULT_INDEX.test(idx[1] ?? ''))
      return [
        {
          index: idx.index,
          bump: -1,
          message: `installs packages from a non-default index (${idx[1]}): dependency confusion risk`,
        },
      ]
    return []
  },
}

/** Dependency manifests that pull code from URLs. Checked per file because the syntax is per format. */
export const dependencyFromUrl: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-004',
  name: 'remote-package-source',
  family: 'remote-code',
  title: 'Package installed from a URL, git ref or custom index',
  owasp: 'AST02',
  severity: 'high',
  suppressible: true,
  help: remotePackageSource.help,
  falsePositives: remotePackageSource.falsePositives,
  check({ file, config }) {
    const hits: Hit[] = []
    const base = file.path.split('/').at(-1) ?? ''
    if (base === 'package.json' && config?.data && typeof config.data === 'object') {
      const pkg = config.data as Record<string, unknown>
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        const deps = pkg[field]
        if (!deps || typeof deps !== 'object') continue
        for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
          if (typeof spec !== 'string' || PINNED.test(spec)) continue
          if (
            /^(?:git\+|git:|https?:|github:|gitlab:|bitbucket:)|^[\w-]+\/[\w.-]+(?:#.*)?$/.test(
              spec,
            )
          ) {
            const line = file.lines.find((l) => l.raw.includes(`"${name}"`))?.n ?? 1
            hits.push({
              line,
              kind: 'script',
              severity: 'high',
              message: `dependency "${name}" is fetched from ${spec}, not from the registry`,
              snippet: `"${name}": "${spec}"`,
            })
          }
        }
      }
    }
    if (/^requirements.*\.txt$|^constraints.*\.txt$/.test(base) || base === 'pyproject.toml') {
      for (const l of file.lines) {
        if (/^\s*#/.test(l.raw)) continue
        if (
          (/^\s*(?:-e\s+)?(?:git\+|https?:\/\/)/.test(l.text) ||
            /@\s*(?:git\+|https?:\/\/)/.test(l.text)) &&
          !PINNED.test(l.text)
        )
          hits.push({
            line: l.n,
            kind: 'script',
            severity: 'high',
            message: 'Python dependency is fetched from a URL or git ref, not from the index',
            snippet: l.raw,
          })
        const idx = /^\s*--(?:index-url|extra-index-url|find-links)\s+(\S+)/.exec(l.text)
        if (idx && !DEFAULT_INDEX.test(idx[1] ?? ''))
          hits.push({
            line: l.n,
            kind: 'script',
            severity: 'medium',
            message: `requirements use a non-default index (${idx[1]})`,
            snippet: l.raw,
          })
      }
    }
    return hits
  },
}

const PASTE_RUN = /\b(?:run|execute|paste|copy|terminal|follow|install|command)\b/i
const FOLLOW_REMOTE = [
  /\b(?:follow|obey|execute|run|apply|carry out)\s+(?:the\s+|any\s+|all\s+)?(?:instructions?|commands?|steps|directions)\s+(?:(?:found|listed|given|provided|described|located|hosted|published)\s+)?(?:at|in|on|from)\s+(?:\[[^\]]*\]\()?(?:https?:\/\/|the\s+(?:url|link|page))/i,
  /\b(?:fetch|download|load|read|retrieve|curl|wget|get|open)\b[^\n]{0,120}?https?:\/\/\S+[^\n]{0,120}?\b(?:and|then)\s+(?:follow|obey|execute|run|apply)\s+(?:the\s+|its\s+|any\s+|all\s+)?(?:instructions?|commands?|steps|contents?|directions|it)\b/i,
  /\b(?:always|first|before\s+(?:doing\s+)?anything(?:\s+else)?|on\s+every\s+(?:invocation|run|call|use|request)|mandatory|required\s+first\s+step)\b[^\n]{0,60}?\b(?:fetch|load|download|retrieve|pull|curl|wget)\b[^\n]{0,80}?https?:\/\//i,
]

export const remoteInstructions: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-005',
  name: 'remote-instructions',
  family: 'remote-code',
  title: 'Instructions loaded from a remote URL or paste site',
  owasp: 'AST05',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'medium', 'low', null),
  message:
    'tells the agent to fetch instructions from a URL and follow them: the reviewed skill is not the skill that runs',
  help: 'Text fetched at run time becomes part of the instructions but sits outside the digest, so it can change after review (OWASP AST05; Air Security\'s "Story of Skills"). Paste sites (rentry.co, glot.io, pastebin) were ClawHavoc\'s second stage. Put the instructions in the capability, or pin the content by hash.',
  falsePositives:
    'Links to documentation the agent reads for reference are not flagged unless the text says to follow or execute what is there.',
  match(line) {
    const paste = PASTE_HOSTS.exec(line.text)
    if (paste) {
      if (line.kind === 'script')
        return /\b(?:curl|wget|fetch|requests|urlopen|iwr|irm|Invoke-)/i.test(line.text)
          ? [{ index: paste.index, message: `fetches content from the paste site ${paste[0]}` }]
          : []
      return [
        {
          index: paste.index,
          bump: PASTE_RUN.test(line.text) ? 1 : 0,
          message: `points the reader at a paste site (${paste[0]}): a classic second-stage lure`,
        },
      ]
    }
    return first(FOLLOW_REMOTE, line.text)
  },
}

const PASSWORD_ARCHIVE = [
  /\b(?:extract|unzip|unpack|decompress|unrar|open)\w*\b[^\n]{0,100}?\b(?:pass(?:word|phrase|wd)?|pwd|pw)\b\s*[:=]?\s*[`'"*]*[\w!@#$%^&.-]{3,}/i,
  /\bunzip\b[^\n]{0,60}?\s-P\s*\S+/,
  /\b7z[az]?\b[^\n]{0,60}?\s-p\S+/,
  /\bunrar\b[^\n]{0,60}?\s-p\S+/,
  /\b(?:archive|zip|rar|7z)\b[^\n]{0,80}?\b(?:password|passphrase|pass)\s*(?:is|:)\s*\S+/i,
]

export const passwordArchive: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-006',
  name: 'password-protected-archive',
  family: 'remote-code',
  title: 'Password-protected archive to extract and run',
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  table: STRICT,
  message:
    'tells the reader to extract a password-protected archive: the password exists to stop antivirus and scanners from looking inside',
  help: 'ClawHavoc and Snyk\'s ToxicSkills samples shipped Windows payloads as password-protected ZIPs on GitHub releases ("extract using pass: openclaw"). A legitimate tool has no reason to hide its contents from scanners.',
  falsePositives: 'Encrypted backups handled by the user. Rare in skills.',
  match(line) {
    return first(PASSWORD_ARCHIVE, line.text)
  },
}

const UNPINNED_RUNNER =
  /\b(npx|bunx|pnpm\s+dlx|yarn\s+dlx|uvx|pipx\s+run|npm\s+exec|uv\s+tool\s+run)\s+(.+)$/i
const VALUE_FLAGS = new Set(['-p', '--package', '--from', '--with', '--python', '-c', '--call'])

/** The package a runner fetches and executes, and whether its version is pinned. */
export function runnerPackage(
  text: string,
): { index: number; spec: string; pinned: boolean } | undefined {
  const m = UNPINNED_RUNNER.exec(text)
  if (!m) return undefined
  const tokens = (m[2] ?? '').split(/\s+/)
  let spec: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.replace(/^['"]|['"]$/g, '')
    if (VALUE_FLAGS.has(t)) {
      spec = tokens[i + 1]?.replace(/^['"]|['"]$/g, '')
      break
    }
    if (t.startsWith('-')) continue
    spec = t
    break
  }
  if (!spec || /^[./~$]|:\/\/|^git\+|^[A-Z_]+=/.test(spec)) return undefined
  const version = /^@?[^@=]+(?:@|==)(.+)$/.exec(spec)?.[1]
  const pinned = Boolean(version && /^v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/.test(version))
  return { index: m.index, spec, pinned }
}

export const unpinnedRunner: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-007',
  name: 'unpinned-remote-exec',
  family: 'remote-code',
  title: 'Package runner executes an unpinned package',
  owasp: 'AST07',
  severity: 'low',
  suppressible: true,
  table: table('low', 'low', null, null),
  message:
    'runs a package with npx/uvx/dlx without pinning a version: whatever is published next is what runs',
  help: '`npx pkg`, `npx pkg@latest` and `uvx pkg` download and execute the newest release on every run, so a compromised maintainer account or a typosquat reaches every user without any change to the capability (OWASP AST07, update drift). Pin an exact version: `npx pkg@1.4.2`, `uvx pkg@1.4.2`.',
  falsePositives:
    'Well-known CLIs run through npx are still reported at low; pinning costs nothing.',
  match(line) {
    const pkg = runnerPackage(line.text)
    if (!pkg || pkg.pinned) return []
    return [
      {
        index: pkg.index,
        message: `runs ${pkg.spec} through a package runner without a pinned version`,
      },
    ]
  },
}

export const loadTimeExecution: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-008',
  name: 'load-time-execution',
  family: 'remote-code',
  title: 'Commands that run automatically when the skill loads',
  owasp: 'AST02',
  severity: 'medium',
  suppressible: true,
  help: 'Claude Code runs `!`command`` in skills and commands before the model sees the text, and skill frontmatter `hooks:` run on agent events while the skill is active. Neither the user nor the agent decides to run them. Keep them read-only and obvious (`git status`), and never hide them in comments.',
  falsePositives:
    'Read-only context commands such as `!`git diff`` are reported at low as an inventory item.',
  check({ file }) {
    const hits: Hit[] = []
    for (const l of file.lines) {
      if (l.virtual === 'preprocess') {
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: l.concealed ? 'medium' : 'low',
          message: l.concealed
            ? `runs \`${l.raw}\` automatically when loaded, from inside a hidden HTML comment`
            : `runs \`${l.raw}\` automatically when the skill or command loads`,
          snippet: l.raw,
        })
      } else if (l.virtual === 'hook' && (file.role === 'entry' || file.role === 'doc')) {
        hits.push({
          line: l.n,
          kind: 'script',
          severity: 'medium',
          message: `frontmatter registers a hook that runs \`${l.raw}\` on agent events`,
          snippet: l.raw,
        })
      }
    }
    return hits
  },
}

const DEFAULT_REGISTRY =
  /\b(?:registry\.npmjs\.org|registry\.yarnpkg\.com|pypi\.org|files\.pythonhosted\.org|npm\.pkg\.github\.com)\b/i
const REGISTRY_SETTING =
  /\b(?:registry|index-url|extra-index-url)\b\s*[:=]?\s*["']?(https?:\/\/[^\s"'`]+)/i
const REGISTRY_FILE = /(?:^|\/)(?:\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|pip\.conf|pip\.ini)$/i
const WRITES_REGISTRY_FILE =
  /(?:>>?\s*\S*(?:\.npmrc|\.yarnrc|\.pypirc|pip\.conf)|\b(?:npm|yarn|pnpm)\s+config\s+set\s+registry\b|\bpip\s+config\s+set\b[^\n]*index-url|\bnpm_config_registry\b)/i

export const registryRedirect: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-009',
  name: 'registry-redirect',
  family: 'remote-code',
  title: 'Redirects a package manager to a non-default registry',
  owasp: 'AST02',
  severity: 'high',
  suppressible: true,
  help: "Writing an `.npmrc`/`.yarnrc`/`pip.conf` or running `npm config set registry` to point at a non-default registry silently routes every future dependency install through a host the author controls (Trail of Bits' `dev-env-setup`; dependency confusion, OWASP AST02). Install from the public registry, or have the user configure a mirror themselves.",
  falsePositives:
    'A corporate-mirror setup skill does this on purpose; declare the host in sigil.yaml and suppress with a reason. A registry line pointing at the default public registry is not flagged.',
  check({ file }) {
    const isRegistryFile = REGISTRY_FILE.test(file.path)
    const writesRegistry =
      file.role === 'script' && file.lines.some((l) => l.code && WRITES_REGISTRY_FILE.test(l.text))
    if (!isRegistryFile && !writesRegistry) return []
    const hits: Hit[] = []
    for (const l of file.lines) {
      if (l.virtual) continue
      const m = REGISTRY_SETTING.exec(l.text)
      if (m && !DEFAULT_REGISTRY.test(m[1] ?? '')) {
        hits.push({
          line: l.n,
          kind: isRegistryFile ? 'script' : l.kind,
          severity: 'high',
          message: `points the package manager at a non-default registry: ${m[1]}`,
          snippet: l.raw,
        })
      }
    }
    // A script that writes a registry file from a variable still redirects, even if the host is not literal here.
    if (writesRegistry && hits.length === 0) {
      const w = file.lines.find((l) => l.code && WRITES_REGISTRY_FILE.test(l.text))
      if (w)
        hits.push({
          line: w.n,
          kind: 'script',
          severity: 'medium',
          message:
            'writes a package-manager registry config, redirecting where dependencies are fetched from',
          snippet: w.raw,
        })
    }
    return hits
  },
}

export const REMOTE_CODE_RULES = [
  pipeToShell,
  powershellExec,
  downloadAndRun,
  remotePackageSource,
  dependencyFromUrl,
  registryRedirect,
  remoteInstructions,
  passwordArchive,
  unpinnedRunner,
  loadTimeExecution,
] as const
