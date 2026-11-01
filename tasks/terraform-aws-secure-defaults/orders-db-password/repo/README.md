# orders-infra

Terraform for the orders service's production database (eu-west-1).

| File | What lives there |
| --- | --- |
| `versions.tf`, `providers.tf` | Terraform and provider requirements; exact provider versions are in `.terraform.lock.hcl` |
| `db.tf` | The orders PostgreSQL instance |
| `secrets.tf` | `orders/db`, the secret the orders service reads its connection settings from |
| `iam.tf` | The orders service's ECS task role (read access to `orders/db`) |

The network (subnet group, security groups) comes from the network stack.

## The orders/db secret

The orders service reads `orders/db` once at startup and expects a JSON object with `username`,
`password`, `host`, `port` and `dbname`. It does not re-read the secret, so a password change needs
a rolling restart of the service.

## CI

CI runs Terraform 1.17 with the providers pinned in `.terraform.lock.hcl`: `terraform plan` on pull
requests and `terraform apply` after merge to main. The pipeline exports `TF_VAR_db_master_password`
from the `ORDERS_DB_MASTER_PASSWORD` pipeline secret.

## Working locally

```sh
python3 scripts/bootstrap.py            # pinned Terraform into .tools/, moto, terraform init
.tools/terraform fmt -check
.tools/terraform validate
.tools/venv/bin/python scripts/smoke.py # apply against a local moto emulator (no AWS access)
```
