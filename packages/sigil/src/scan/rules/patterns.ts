import { hostOf, isIPv4, isPrivateIPv4, URL_RE } from '../text.js'
import { EXFIL_HOSTS, PASTE_HOSTS } from './rule.js'

/** Interpreters that execute whatever is piped into them. */
export const SINK = String.raw`(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+(?:\S+=\S*\s+)*)?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:(?:ba|z|k|da|fi|tc|c)?sh|python[0-9.]*|node|perl|ruby|php|bun|deno|osascript|pwsh|powershell)\b`

/** Commands that download. */
export const FETCHER = String.raw`\b(?:curl|wget|fetch|aria2c|xh|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b`

/** A single pipe (not `||`). */
export const PIPE = String.raw`(?<!\|)\|(?!\|)`

/**
 * How suspicious the URLs on a line are: a raw public IP, a paste site, an exfiltration host or plain
 * HTTP each raise the severity of a fetch-and-run by one level.
 */
export function urlRisk(text: string): { bump: number; why?: string } {
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0]
    const host = hostOf(url)
    if (!host) continue
    if (isIPv4(host) && !isPrivateIPv4(host)) return { bump: 1, why: `raw IP ${host}` }
    if (PASTE_HOSTS.test(url)) return { bump: 1, why: `paste site ${host}` }
    if (EXFIL_HOSTS.test(url)) return { bump: 1, why: `collection host ${host}` }
    if (/^http:\/\//i.test(url) && !/^(?:localhost|127\.)/.test(host))
      return { bump: 1, why: 'plain HTTP' }
  }
  return { bump: 0 }
}
