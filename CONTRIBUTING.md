# Contributing to Sigil

Thanks for helping build the proving ground. There are four ways to contribute, and each one makes
results more trustworthy for everyone.

| You want to | Start here |
| --- | --- |
| Add a capability (skill, rule, command, hook, agent, MCP server…) | [Submit a capability](#submit-a-capability) |
| Write tasks that measure capabilities | [Write a task](#write-a-task) |
| Improve the scanner, adapters, lab or site | [Work on the code](#work-on-the-code) |
| Challenge a result or a task | Open an issue with the **result challenge** template |

## Submit a capability

1. Create `catalog/<type>/<namespace>/<slug>/` with a `sigil.yaml` and the native payload. A skill is a
   standard [Agent Skills](https://agentskills.io/specification) folder with `SKILL.md`; it stays
   portable, and Sigil compiles it for each agent.
2. Declare every permission it needs: network hosts, shell commands, environment variables, and
   whether it writes files. Undeclared access is a finding.
3. Point `proof.suites` at one or more task suites. Reusing an existing suite is fine; adding a new one
   is better.
4. Run the checks locally:

   ```sh
   pnpm install && pnpm --dir packages/sigil build
   pnpm sigil validate catalog/<type>/<namespace>/<slug>
   pnpm sigil scan catalog/<type>/<namespace>/<slug>
   ```

5. Open a pull request with the **capability** template. CI validates and scans it. A maintainer runs the
   lab, and another person reviews it. The page shows exactly what has and hasn't been checked at every
   step.

Third-party capabilities you don't want to host can be listed with a `source` block pinned to a full
commit SHA. The payload stays upstream; Sigil records its digest and evaluates it the same way.

### What makes a capability good

- It carries knowledge an agent doesn't reliably have: current APIs, unsafe defaults, subtle rules.
- It is specific. "Write clean code" measures as no effect; "create Postgres indexes concurrently,
  outside a transaction" can be proven.
- It is short at the top and deep underneath: a focused `SKILL.md`, with detail in `references/`.
- It is honest about limitations.

## Write a task

A task is `tasks/<suite>/<task>/` with:

- `task.yaml`: the prompt, the image, the setup command, the verify command and protected files;
- `repo/`: the starting state;
- `verify/`: hidden tests, copied in only after the agent finishes;
- `solution/`: a reference solution, as files overlaid on `repo/`.

Follow [the fairness rules](spec/METHODOLOGY.md#writing-fair-tasks), then prove the task is valid:

```sh
pnpm sigil task check tasks/<suite>/<task>
```

It must fail on the starting repo, pass with the solution, and pass the same way every time.

## Work on the code

```sh
pnpm install
pnpm check   # lint, typecheck, tests, build, validate the catalog
```

Read [AGENTS.md](AGENTS.md) first: it has the layout, the commands and the rules that are not
negotiable. Every scanner rule needs a positive fixture, a negative fixture and a false-positive note.
Every adapter needs a round-trip test. New dependencies need a reason in the pull request.

## Pull requests

- One logical change per pull request, with a conventional commit title (`feat(scan): …`).
- Include how you verified it.
- Be patient with reviews of capabilities: they get a careful read because people will run them.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
