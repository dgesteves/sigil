# OIDC for AWS, Google Cloud and Azure

Every cloud login below needs `id-token: write` on the job and a trust policy on the cloud side that
names the repository **and** a ref or environment. A policy that trusts `repo:my-org/*` lets any
workflow in any repository of the org, including on a PR branch, assume the role.

Useful subject claims (`sub`):

- `repo:OWNER/REPO:ref:refs/heads/main` for pushes to main
- `repo:OWNER/REPO:environment:production` for jobs that declare `environment: production`
- `repo:OWNER/REPO:pull_request` for `pull_request` runs (rarely what you want for deploys)

Prefer environments for deploys: they add required reviewers and branch rules on top of the claim.

## AWS

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
    with:
      role-to-assume: arn:aws:iam::123456789012:role/deploy-site
      aws-region: eu-west-1
```

Trust policy condition on the IAM role: `token.actions.githubusercontent.com:aud` equals
`sts.amazonaws.com` and `token.actions.githubusercontent.com:sub` equals (not `StringLike` with `*`)
the subject above. Remove `aws-access-key-id`/`aws-secret-access-key` inputs and the secrets behind them.

## Google Cloud

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
    with:
      workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/github/providers/my-repo
      service_account: deployer@my-project.iam.gserviceaccount.com
```

Restrict the provider with an attribute condition such as
`assertion.repository == 'OWNER/REPO' && assertion.ref == 'refs/heads/main'`. Drop `credentials_json`.

## Azure

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906 # v3.1.0
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

Client, tenant and subscription IDs are identifiers, not secrets; `vars` is fine. Create a federated
credential on the app registration for the exact subject. Drop the `creds` JSON secret.

## When there is no OIDC

Store the narrowest credential the provider offers, in an environment secret behind required
reviewers, and rotate it. Never print it, never pass it to `pull_request_target` or `workflow_run`
jobs that touch PR data, and never pass it with `secrets: inherit`.
