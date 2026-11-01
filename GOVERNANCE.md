# Governance

## Principles

1. **Evidence over opinion.** Popularity, stars and install counts never decide trust. Results do.
2. **Independence.** Verification cannot be bought. No sponsor, employer or vendor gets favourable
   treatment, and maintainers disclose any affiliation with a capability they review.
3. **Neutrality.** No agent, model provider or framework is favoured. Every agent gets the same adapters
   and the same method.
4. **Openness.** The method, tasks, scanner rules, results and raw traces are public. Decisions that
   change them happen in public issues and pull requests.

## Roles

| Role | Can do |
| --- | --- |
| Contributor | Propose capabilities, tasks, rules, adapters and fixes through pull requests. |
| Reviewer | Review capabilities in a domain they know; approve or request changes. |
| Maintainer | Merge, run the lab in CI, revoke verification, change the method. |
| Lead maintainer | Final say when maintainers disagree; currently [@dgesteves](https://github.com/dgesteves). |

Reviewers are invited after several accepted contributions in a domain. Maintainers are invited by the
existing maintainers. Inactive maintainers (six months without activity) move to emeritus.

## Reviewing a capability

A capability is approved only by someone other than its author. The reviewer checks:

- the content does what its summary says, and the limitations are honest;
- the declared permissions match what it does;
- the security findings are resolved or justified;
- its proof suite is fair under [the task rules](spec/METHODOLOGY.md#writing-fair-tasks).

Approval is recorded in the evidence for that digest. A new version needs a new approval.

## Changing the method

Changes to the scoring rules, statistics, verdict thresholds or trust levels need a public proposal
issue, at least seven days of comment, and approval from two maintainers. The method version is bumped
and results record the version that produced them.

## Revocation

Any maintainer can revoke verification immediately when there is evidence of malicious or deceptive
behaviour. The reason is published. The author can appeal in a public issue.

## Code of conduct

Everyone follows the [code of conduct](CODE_OF_CONDUCT.md).
