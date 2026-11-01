# Injection sinks and test payloads

`${{ }}` is template substitution. The runner evaluates the expression, pastes the resulting text into
the step, and only then hands the step to bash, pwsh, node or Python. Whatever the attacker typed
becomes part of the program.

## Where substitution is dangerous

| Sink | Why | Fix |
| --- | --- | --- |
| `run:` (any shell) | text becomes shell source | `env:` variable, then `"$VAR"` |
| `actions/github-script` `script:` | text becomes JavaScript source | `context.payload.<...>` or `process.env.VAR` |
| `shell: python` / `node {0}` | same as `run:` | `os.environ["VAR"]` / `process.env.VAR` |
| `$GITHUB_ENV` writes | a newline in the value adds a new variable (e.g. `LD_PRELOAD`, `BASH_ENV`) for every later step | don't write untrusted text there; use step outputs or `env:` |
| `$GITHUB_OUTPUT` writes | a newline adds or overrides another output | random heredoc delimiter, or validate first |
| `$GITHUB_PATH` writes | prepends attacker-chosen directories to `PATH` | never from untrusted data |
| Composite action `run:` steps using `${{ inputs.x }}` | inputs are substituted the same way | `env: { X: ${{ inputs.x }} }` inside the composite action |

Not code, so safe for untrusted values: `if:`, `env:` values, `with:` inputs of JavaScript and Docker
actions (they receive the value as data), `concurrency.group`.

## Payloads to reason with

Run these through the step in your head. If any of them executes, changes control flow, or makes the
step crash on a legitimate input, the step is wrong.

| Context | Payload | Breaks |
| --- | --- | --- |
| Shell, any quoting | `$(touch /tmp/pwned)` | double quotes, unquoted, heredoc without quoted delimiter |
| Shell, single quotes | `x'; touch /tmp/pwned; echo '` | `'${{ ... }}'` |
| Shell | backtick `touch /tmp/pwned` backtick | double quotes, unquoted |
| Branch name (`github.head_ref`) | `zzz";echo${IFS}hello;#` | any shell use; branch names may contain `$`, `;`, `"`, `{}` |
| JS template literal | `${require('fs').writeFileSync('/tmp/pwned','')}` | `` `${{ ... }}` `` |
| JS template literal | backtick `+require('child_process').execSync('id')+` backtick | `` String.raw`${{ ... }}` `` too |
| JS quoted string | `'+require('fs').writeFileSync('/tmp/p','')+'` | `'${{ ... }}'`, `"${{ ... }}"` (with `"`) |
| JS any | a body containing a newline | quoted strings: SyntaxError, the step fails for ordinary users |
| `toJSON()` | `$(touch /tmp/pwned)` | JSON quoting escapes `"` and `\` but not `$`, backticks or `'`, so `t=${{ toJSON(...) }}` is still live shell |

Also handle the boring inputs: issue and PR bodies are `null` when empty (`context.payload.issue.body
?? ''`), titles may contain quotes, emoji and backticks, and labels arrays may be empty.

## Patterns that look safe and are not

```yaml
# "Sanitising" with tr/sed after substitution: the injection already happened.
- run: title=$(echo "${{ github.event.issue.title }}" | tr -d '`$')

# Passing through an intermediate step output that echoes the raw value:
- id: t
  run: echo "title=${{ github.event.pull_request.title }}" >> "$GITHUB_OUTPUT"   # injection here
- run: echo "${{ steps.t.outputs.title }}"                                        # and here
```

## The safe shapes

```yaml
- name: Announce the preview
  env:
    GH_TOKEN: ${{ github.token }}
    GH_REPO: ${{ github.repository }}
    PR: ${{ github.event.pull_request.number }}
    BRANCH: ${{ github.head_ref }}
  run: gh pr comment "$PR" --body "Preview for \`$BRANCH\` is building."
```

```yaml
- uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
  with:
    script: |
      const { body, user } = context.payload.comment
      if ((body ?? '').trim() === '/help') {
        await github.rest.issues.createComment({
          ...context.repo,
          issue_number: context.issue.number,
          body: `@${user.login} the bot understands /help and /assign-me.`, // runtime template: fine
        })
      }
```

Writing a multi-line value to an output safely:

```bash
delimiter="EOF_$(openssl rand -hex 16)"
{
  echo "notes<<$delimiter"
  printf '%s\n' "$NOTES"
  echo "$delimiter"
} >> "$GITHUB_OUTPUT"
```

GitHub's docs only require that the delimiter never appears on its own line inside the value; a
random one guarantees that for attacker-supplied text.
