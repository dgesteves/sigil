import { hostOf, isIPv4, isPrivateIPv4, URL_RE } from '../text.js'
import {
  all,
  CHAT_WEBHOOKS,
  EXFIL_HOSTS,
  type LineMatch,
  type LineRule,
  PASTE_HOSTS,
  secretPath,
  table,
} from './rule.js'

const READ_OP =
  /\b(?:cat|less|more|head|tail|bat|xxd|od|strings|cp|scp|rsync|tar|zip|base64|openssl|gpg|type|Get-Content|Read-Host|read|source|grep|awk|sed|jq)\b|\b(?:open|read|readFile|readFileSync|load|read_text|read_bytes|NamedTemporaryFile|Path)\s*\(|\$\(<|<\s*(?:~|\$\{?HOME)/

export const credentialAccess: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-040',
  name: 'credential-access',
  family: 'credentials',
  title: 'Reads credentials or other secrets outside the project',
  owasp: 'AST03',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'reads credentials or secrets from outside the project',
  help: "SSH and cloud keys (`~/.ssh/id_*`, `~/.aws/credentials`), CLI tokens (`~/.config/gh`, `~/.npmrc`), OS keychains (`security find-generic-password`, `secret-tool`), browser login stores and crypto wallets are outside any skill's job. Snyk found 280+ skills reading credentials beyond their function; ClawHavoc read `~/.clawdbot/.env`. Declare only the project files you need.",
  falsePositives:
    'A credentials-management skill will legitimately touch these paths; document it in sigil.yaml and suppress with a reason. Mentions inside a security/"never read" section are downgraded.',
  match(line) {
    const hit = secretPath(line.text)
    if (!hit) return []
    const m: LineMatch = { index: hit.index, message: `accesses ${hit.what} outside the project` }
    // Reading or copying it, or piping it somewhere, is worse than a bare mention.
    if (line.shell && (READ_OP.test(line.text) || /[|>]/.test(line.text))) m.bump = 0
    return [m]
  },
}

const METADATA =
  /\b(?:169\.254\.169\.254|metadata\.google\.internal|metadata\.goog\b|100\.100\.100\.200|\[fd00:ec2::254\]|metadata\.azure\.com)\b|\/(?:latest|computeMetadata\/v1|metadata\/instance)\/(?:meta-data|iam\/security-credentials|identity)\b|Metadata-Flavor:\s*Google|X-aws-ec2-metadata-token/i

export const cloudMetadata: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-041',
  name: 'cloud-metadata',
  family: 'credentials',
  title: 'Queries the cloud instance metadata service',
  owasp: 'AST03',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message:
    'queries the cloud instance metadata endpoint, which hands out temporary cloud credentials (SSRF target)',
  help: 'The link-local address 169.254.169.254 (and the GCP/Azure equivalents) returns IAM role credentials to anything that can reach it. A skill querying it is harvesting cloud credentials. No capability needs this; the runtime provides credentials through declared env vars.',
  falsePositives:
    'Documentation about SSRF that names the address is downgraded in a security section or when the mention check fires.',
  match(line) {
    return all(METADATA, line.text).slice(0, 1)
  },
}

// `env`/`printenv` as a command (not the `.env` filename), the whole environ object, or a Windows env dump.
const ENV_DUMP =
  /(?<![\w./-])(?:printenv|env)\b\s*(?:\||>|$)|\bset\b\s*(?:\|\s*(?:curl|nc|grep)|>)|\b(?:dict|list|json\.dumps?)\s*\(\s*os\.environ|\bos\.environ(?:\.copy\(\))?\s*(?:\)|,|\bfor\b|$)|\{\s*\*\*process\.env|\bGet-ChildItem\s+Env:|\bgci\s+env:/i
const ENV_SENDER =
  /\b(?:curl|wget|fetch|requests|httpx|urlopen|axios|nc|ncat|post|put|upload|send|sendBeacon|UploadString)\b|[|>]\s*(?:\/dev\/tcp|nc\b)/i

export const environmentExfil: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-042',
  name: 'environment-dump',
  family: 'credentials',
  title: 'Captures the whole environment block',
  owasp: 'AST03',
  severity: 'medium',
  suppressible: true,
  negationAware: true,
  table: table('medium', 'medium', 'low', 'low'),
  message: 'captures the entire environment, which usually holds tokens and keys',
  help: "Grabbing all of `env` / `os.environ` / `process.env` and sending or writing it leaks every secret the agent holds. Trail of Bits' `.pyc` sample dumped `os.environ`. Read the specific variables you declared in sigil.yaml instead of the whole block.",
  falsePositives:
    'Reading one named variable (`os.environ["FOO"]`, `process.env.FOO`) does not match. A bare `printenv` for debugging is medium; piping it to the network is caught by SIG-SEC-050.',
  match(line) {
    const m = ENV_DUMP.exec(line.text)
    if (!m) return []
    // Only a dump that is sent somewhere is worse than the baseline; a bare `printenv` is just medium.
    return [{ index: m.index, bump: ENV_SENDER.test(line.text) ? 1 : 0 }]
  },
}

export const CREDENTIAL_RULES = [credentialAccess, cloudMetadata, environmentExfil] as const

/* ------------------------------------------------------------------------------------------------
 * Exfiltration
 * ---------------------------------------------------------------------------------------------- */

// Things that actually transmit. The bare words `http`/`mail` are left out: they match too much prose.
const SENDER =
  /\b(?:curl|wget|xh|aria2c|nc|ncat|socat|telnet|requests\.(?:post|put|patch)|httpx\.(?:post|put|patch)|urllib\.request|urlopen|fetch\s*\(|axios\.(?:post|put)|XMLHttpRequest|navigator\.sendBeacon|Invoke-RestMethod|Invoke-WebRequest|Net\.WebClient|UploadString|UploadData|sendmail|ssmtp)\b|\/dev\/(?:tcp|udp)\//i
// Capturing something sensitive into the request: command output, a file upload, or a secret source.
const CAPTURE =
  /\$\(\s*(?:cat|head|tail|base64|gzip|env|printenv|whoami|hostname|uname|id|cat\s|ls\s|find\s|security\s|defaults\s+read)\b|`\s*(?:cat|base64|env|whoami|uname|hostname|id)\b|--data[^\n]{0,40}\$\(|--data-(?:binary|raw|urlencode)[^\n]{0,40}\$\(|-F\s+\S*@|-T\s+(?:~|\/|\$|\.)|--upload-file\s+(?:~|\/|\$|\.)|@(?:~\/|\/[A-Za-z]|\$\{?[A-Z]|\.env)|data\s*=\s*(?:open\(|f?["'][^"'\n]{0,40}\$)/i

export const networkExfil: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-050',
  name: 'network-exfiltration',
  family: 'exfiltration',
  title: 'Sends captured data or a file to the network',
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'sends captured data to a remote endpoint',
  help: 'A sender (`curl`, `requests.post`, `/dev/tcp`, `sendBeacon`) carrying command output, a file or env (`--data "$(cat …)"`, `-T file`, `@~/…`) is exfiltration. The destination raises severity: a raw IP, a paste site, a webhook catcher or a chat-bot API is almost always malicious.',
  falsePositives:
    "Posting to a declared, legitimate API host is downgraded. The destination allowlist is the manifest's `network`; conformance (SIG-SEC-090) reports undeclared hosts separately.",
  match(line) {
    if (!SENDER.test(line.text) || !CAPTURE.test(line.text)) return []
    const sender = SENDER.exec(line.text)!
    let bump = 0
    let why = ''
    for (const u of line.text.matchAll(URL_RE)) {
      const host = hostOf(u[0])
      if (!host) continue
      if (PASTE_HOSTS.test(u[0])) {
        bump = 1
        why = `paste site ${host}`
      } else if (EXFIL_HOSTS.test(u[0])) {
        bump = 1
        why = `collection endpoint ${host}`
      } else if (isIPv4(host) && !isPrivateIPv4(host)) {
        bump = 1
        why = `raw IP ${host}`
      }
    }
    if (CHAT_WEBHOOKS.test(line.text)) {
      bump = 1
      why = 'a chat-bot webhook'
    }
    return [
      { index: sender.index, bump, ...(why ? { message: `sends captured data to ${why}` } : {}) },
    ]
  },
}

export const chatWebhook: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-051',
  name: 'chat-bot-webhook',
  family: 'exfiltration',
  title: 'Posts to a Discord, Telegram or Slack bot endpoint',
  owasp: 'AST01',
  severity: 'medium',
  suppressible: true,
  negationAware: true,
  table: table('high', 'medium', 'low', 'low'),
  message: 'contacts a chat-bot API, a common exfiltration channel',
  help: 'Discord/Slack incoming webhooks and the Telegram Bot API are the usual out-of-band channel for stolen data (Unit 42 saw Polymarket skills exfiltrate wallet keys over Telegram). Legitimate notification use exists, so this is medium in prose and high in a script; declare the host and suppress with a reason if intended.',
  falsePositives:
    'A genuine notifier (CI posting build status to Slack) matches; declare the host in sigil.yaml and suppress.',
  match(line) {
    return all(CHAT_WEBHOOKS, line.text).slice(0, 1)
  },
}

// A resolver command (as a command, not a `--url-host` flag) whose hostname embeds captured data.
const DNS_EXFIL =
  /(?:^|[\s;&|(])(?:dig|drill|kdig|nslookup|host)\s+(?:[-+@]\S+\s+)*\S*\$\((?:cat|base64|whoami|hostname|uname|env|id)\b|\bgethostbyname\b[^\n]{0,60}?(?:\+\s*["']|base64|\.encode|\.hex\()|\bsocket\.gethostbyname\s*\(\s*(?:f["']|[^\n)]{0,40}?(?:\+|\.format\())/i

export const dnsExfil: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-052',
  name: 'dns-exfiltration',
  family: 'exfiltration',
  title: 'Encodes data into DNS lookups',
  owasp: 'AST01',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'encodes captured data into DNS queries to smuggle it past network controls',
  help: 'Putting command output or a secret into a hostname and resolving it (`dig $(whoami).attacker…`) exfiltrates over DNS, which egress proxies rarely inspect. Interactsh/oast.* hosts are the usual sink. No capability needs dynamic DNS of captured data.',
  falsePositives:
    'Ordinary `dig example.com` or a variable hostname from config does not match; the rule needs captured data in the query.',
  match(line) {
    const m = DNS_EXFIL.exec(line.text)
    return m ? [{ index: m.index }] : []
  },
}

export const EXFILTRATION_RULES = [networkExfil, chatWebhook, dnsExfil] as const
