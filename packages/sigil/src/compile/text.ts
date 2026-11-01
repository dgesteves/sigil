import { stringify } from 'yaml'
import { parseFrontmatter } from '../core/frontmatter.js'

export interface Document {
  data: Record<string, unknown>
  body: string
}

/** Splits a markdown file into frontmatter and body. A file without frontmatter is all body. */
export function readDocument(text: string): Document {
  const fm = parseFrontmatter(text)
  return fm ? { data: fm.data, body: fm.body } : { data: {}, body: text }
}

/** Writes frontmatter + body. Keys with `undefined` values are dropped; no keys means no fence. */
export function writeDocument(data: Record<string, unknown>, body: string): string {
  const kept = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  if (Object.keys(kept).length === 0) return body
  return `---\n${stringify(kept, { lineWidth: 0 })}---\n${body}`
}

export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** `globs` as Cursor writes it (comma-separated string) or as a YAML list. */
export function globsOf(data: Record<string, unknown>, key = 'globs'): string[] {
  const v = data[key]
  const raw = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : []
  return raw
    .filter((g): g is string => typeof g === 'string')
    .map((g) => g.trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------------------------------------
 * Command bodies. Agents agree on `$ARGUMENTS` but not on positional numbering or shell injection,
 * so anything beyond `$ARGUMENTS` is reported instead of guessed.
 * ---------------------------------------------------------------------------------------------- */

export const usesArguments = (body: string) => /\$ARGUMENTS(?!\[)/.test(body)
export const usesPositional = (body: string) => /\$ARGUMENTS\[\d+\]|\$\d/.test(body)
/** Claude Code and OpenCode run !`cmd` before sending the prompt. */
export const usesShellInjection = (body: string) => /!`[^`\n]+`/.test(body)
/** Gemini CLI and Qwen Code interpret these sequences in command prompts. */
export const usesGeminiSyntax = (body: string) => /\{\{|!\{|@\{/.test(body)

/* ------------------------------------------------------------------------------------------------
 * Minimal TOML writer: strings, string arrays and keys are all Sigil emits.
 * ---------------------------------------------------------------------------------------------- */

export function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlBasic(key)
}

export function tomlBasic(s: string): string {
  let out = '"'
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

/** Multi-line literal string when the text allows it (readable prompts), basic string otherwise. */
export function tomlString(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: TOML literal strings forbid these
  const literalSafe = !s.includes("'''") && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s)
  if (s.includes('\n') && literalSafe && !s.replace(/\r\n/g, '\n').includes('\r')) {
    // A newline right after the opening delimiter is trimmed by TOML, so the text starts on line 2.
    return `'''\n${s}'''`
  }
  return tomlBasic(s)
}

export function tomlArray(items: readonly string[]): string {
  return `[${items.map(tomlBasic).join(', ')}]`
}
