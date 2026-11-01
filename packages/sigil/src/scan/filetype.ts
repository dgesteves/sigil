import { extname, posix } from 'node:path'
import type { FileRole } from './types.js'

/**
 * What a file really is, from its bytes first and its name second. Extensions lie: Trail of Bits hid a
 * ZIP with a shell script inside as `.instructions.docx.txt`.
 */
export type Sniffed =
  | { type: 'text' }
  | { type: 'executable'; format: string }
  | { type: 'bytecode'; format: string }
  | { type: 'archive'; format: string; office?: boolean }
  | { type: 'media'; format: string }
  | { type: 'binary' }

const has = (buf: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => buf[at + i] === b)

const OFFICE = new Set([
  '.docx',
  '.xlsx',
  '.pptx',
  '.docm',
  '.xlsm',
  '.pptm',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
])

export function sniff(buf: Uint8Array, path: string): Sniffed {
  const ext = extname(path).toLowerCase()
  if (has(buf, [0x7f, 0x45, 0x4c, 0x46])) return { type: 'executable', format: 'ELF' }
  if (
    has(buf, [0xfe, 0xed, 0xfa, 0xce]) ||
    has(buf, [0xfe, 0xed, 0xfa, 0xcf]) ||
    has(buf, [0xce, 0xfa, 0xed, 0xfe]) ||
    has(buf, [0xcf, 0xfa, 0xed, 0xfe])
  )
    return { type: 'executable', format: 'Mach-O' }
  if (has(buf, [0xca, 0xfe, 0xba, 0xbe]))
    // Fat Mach-O and Java class files share a magic; both are compiled code nobody can review.
    return ext === '.class'
      ? { type: 'bytecode', format: 'Java class' }
      : { type: 'executable', format: 'Mach-O universal or Java class' }
  if (has(buf, [0x4d, 0x5a]) && buf.length > 0x40) {
    const off = (buf[0x3c] ?? 0) | ((buf[0x3d] ?? 0) << 8) | ((buf[0x3e] ?? 0) << 16)
    if (has(buf, [0x50, 0x45, 0, 0], off)) return { type: 'executable', format: 'Windows PE' }
  }
  if (has(buf, [0x00, 0x61, 0x73, 0x6d])) return { type: 'executable', format: 'WebAssembly' }
  if (has(buf, [0x0d, 0x0a], 2) && (ext === '.pyc' || ext === '.pyo'))
    return { type: 'bytecode', format: 'Python bytecode' }
  if (ext === '.pyc' || ext === '.pyo') return { type: 'bytecode', format: 'Python bytecode' }

  if (has(buf, [0x50, 0x4b, 0x03, 0x04]) || has(buf, [0x50, 0x4b, 0x05, 0x06])) {
    if (ext === '.jar' || ext === '.war' || ext === '.apk' || ext === '.whl' || ext === '.egg')
      return { type: 'archive', format: ext.slice(1).toUpperCase() }
    return { type: 'archive', format: 'ZIP', office: OFFICE.has(ext) }
  }
  if (has(buf, [0x1f, 0x8b])) return { type: 'archive', format: 'gzip' }
  if (has(buf, [0x42, 0x5a, 0x68])) return { type: 'archive', format: 'bzip2' }
  if (has(buf, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { type: 'archive', format: 'xz' }
  if (has(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { type: 'archive', format: '7z' }
  if (has(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { type: 'archive', format: 'RAR' }
  if (has(buf, [0x28, 0xb5, 0x2f, 0xfd])) return { type: 'archive', format: 'zstd' }
  if (has(buf, [0x4d, 0x53, 0x43, 0x46])) return { type: 'archive', format: 'CAB' }
  if (has(buf, [0x75, 0x73, 0x74, 0x61, 0x72], 257)) return { type: 'archive', format: 'tar' }
  if (has(buf, [0x78, 0x61, 0x72, 0x21])) return { type: 'archive', format: 'xar (pkg)' }
  if (
    ext === '.dmg' ||
    ext === '.iso' ||
    ext === '.pkg' ||
    ext === '.msi' ||
    ext === '.deb' ||
    ext === '.rpm'
  )
    return { type: 'archive', format: ext.slice(1).toUpperCase() }

  const media = mediaFormat(buf)
  if (media) return { type: 'media', format: media }
  if (isText(buf)) return { type: 'text' }
  return { type: 'binary' }
}

function mediaFormat(buf: Uint8Array): string | undefined {
  if (has(buf, [0x89, 0x50, 0x4e, 0x47])) return 'PNG'
  if (has(buf, [0xff, 0xd8, 0xff])) return 'JPEG'
  if (has(buf, [0x47, 0x49, 0x46, 0x38])) return 'GIF'
  if (
    has(buf, [0x52, 0x49, 0x46, 0x46]) &&
    (has(buf, [0x57, 0x45, 0x42, 0x50], 8) || has(buf, [0x57, 0x41, 0x56, 0x45], 8))
  )
    return 'RIFF media'
  if (has(buf, [0x00, 0x00, 0x01, 0x00])) return 'ICO'
  if (has(buf, [0x42, 0x4d])) return 'BMP'
  if (has(buf, [0x25, 0x50, 0x44, 0x46])) return 'PDF'
  if (has(buf, [0x00, 0x01, 0x00, 0x00, 0x00]) || has(buf, [0x4f, 0x54, 0x54, 0x4f])) return 'font'
  if (has(buf, [0x77, 0x4f, 0x46, 0x46]) || has(buf, [0x77, 0x4f, 0x46, 0x32])) return 'font'
  if (has(buf, [0x49, 0x44, 0x33]) || has(buf, [0xff, 0xfb])) return 'MP3'
  if (has(buf, [0x66, 0x74, 0x79, 0x70], 4)) return 'MP4'
  if (has(buf, [0x4f, 0x67, 0x67, 0x53])) return 'Ogg'
  if (has(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'WebM'
  if (has(buf, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50])) return 'JPEG 2000'
  return undefined
}

/** No NUL bytes in the first 8 KB and mostly valid UTF-8, or a UTF-16 BOM. */
function isText(buf: Uint8Array): boolean {
  if (buf.length === 0) return true
  if (has(buf, [0xff, 0xfe]) || has(buf, [0xfe, 0xff])) return true
  const head = buf.subarray(0, 8192)
  if (head.includes(0)) return false
  const decoded = Buffer.from(head).toString('utf8')
  const bad = decoded.match(/�/g)?.length ?? 0
  return bad / Math.max(1, decoded.length) < 0.02
}

export function decodeText(buf: Buffer): string {
  if (has(buf, [0xff, 0xfe])) return buf.subarray(2).toString('utf16le')
  if (has(buf, [0xfe, 0xff])) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const s = buf.toString('utf8')
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/* ------------------------------------------------------------------------------------------------
 * Roles and languages.
 * ---------------------------------------------------------------------------------------------- */

const SCRIPT_EXT: Record<string, string> = {
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ksh': 'shell',
  '.fish': 'shell',
  '.command': 'shell',
  '.py': 'python',
  '.pyw': 'python',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'js',
  '.ts': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.tsx': 'js',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.pm': 'perl',
  '.php': 'php',
  '.lua': 'lua',
  '.applescript': 'applescript',
  '.vbs': 'vbscript',
  '.go': 'c-like',
  '.rs': 'c-like',
  '.java': 'c-like',
  '.kt': 'c-like',
  '.swift': 'c-like',
  '.c': 'c-like',
  '.h': 'c-like',
  '.cc': 'c-like',
  '.cpp': 'c-like',
  '.cs': 'c-like',
  '.r': 'r',
}

const CONFIG_EXT = new Set([
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.plist',
  '.xml',
  '.env',
  '.properties',
])
const CONFIG_NAMES = new Set([
  '.npmrc',
  '.yarnrc',
  '.pypirc',
  'pip.conf',
  'pip.ini',
  '.gitconfig',
  '.editorconfig',
  'Dockerfile',
  'Makefile',
  '.env',
  '.mcp.json',
  '.lsp.json',
])
const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown', '.mdc', '.txt', '.rst', '.prompt'])

export interface Classified {
  role: FileRole
  language?: string
}

/** Role of a text file. `entries` are the unit's agent entry points (SKILL.md, rules, commands). */
export function classify(path: string, text: string, entries: ReadonlySet<string>): Classified {
  const base = posix.basename(path)
  const ext = extname(base).toLowerCase()
  const shebang = /^#!\s*\S*?(?:env\s+(?:-S\s+)?)?(\w+)/.exec(text)?.[1]
  if (shebang) {
    if (/^(?:ba|z|k|da|fi)?sh$/.test(shebang)) return { role: 'script', language: 'shell' }
    if (/^python/.test(shebang)) return { role: 'script', language: 'python' }
    if (/^(?:node|deno|bun|tsx|ts-node)$/.test(shebang)) return { role: 'script', language: 'js' }
    if (/^(?:pwsh|powershell)$/.test(shebang)) return { role: 'script', language: 'powershell' }
    if (/^(?:ruby|perl|php|osascript)$/.test(shebang)) return { role: 'script', language: shebang }
  }
  const lang = SCRIPT_EXT[ext]
  if (lang) return { role: 'script', language: lang }
  if (entries.has(path)) return { role: 'entry' }
  if (CONFIG_NAMES.has(base) || CONFIG_EXT.has(ext) || /^\.env(?:\.|$)/.test(base))
    return { role: 'config' }
  if (MARKDOWN_EXT.has(ext)) return { role: 'doc' }
  // Extensionless files under bin/ or hooks/ are executables by convention.
  if (ext === '' && /(?:^|\/)(?:bin|hooks|scripts)\//.test(path))
    return { role: 'script', language: 'shell' }
  if (ext === '.html' || ext === '.htm' || ext === '.svg') return { role: 'data', language: 'html' }
  return { role: 'data' }
}

export function isMarkdown(path: string): boolean {
  return MARKDOWN_EXT.has(extname(path).toLowerCase()) && extname(path).toLowerCase() !== '.txt'
}
