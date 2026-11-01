# ledger-infra

Terraform for the ledger service's production AWS account (eu-west-1).

| File | What lives there |
| --- | --- |
| `versions.tf`, `providers.tf` | Terraform and provider requirements; exact provider versions are in `.terraform.lock.hcl` |
| `kms.tf` | Customer managed KMS keys |
| `s3.tf` | Buckets. `acme-ledger-prod-statements` (customer statements) was created in 2022 |
| `outputs.tf` | Values other stacks read |

## Working locally

```sh
python3 scripts/bootstrap.py            # pinned Terraform into .tools/, moto, terraform init
.tools/terraform fmt -check
.tools/terraform validate
.tools/venv/bin/python scripts/smoke.py # apply against a local moto emulator (no AWS access)
```

CI runs `terraform plan` on pull requests and `terraform apply` after merge to main, with an OIDC
role. There are no AWS credentials on developer machines.
