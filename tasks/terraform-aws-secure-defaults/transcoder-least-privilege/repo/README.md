# media-infra

Terraform for the media pipeline's production AWS account (eu-west-1).

| File | What lives there |
| --- | --- |
| `versions.tf`, `providers.tf` | Terraform and provider requirements; exact provider versions are in `.terraform.lock.hcl` |
| `kms.tf` | The media KMS key |
| `s3.tf` | The media bucket, `acme-media-prod` |
| `iam.tf` | The transcoder's ECS task role |

## The media bucket

| Prefix | Contents | Who uses it |
| --- | --- | --- |
| `uploads/<video-id>/source.<ext>` | Original uploads | written by the upload API, read by the transcoder |
| `renditions/<video-id>/<profile>.mp4` | Transcoded outputs | written by the transcoder, read by the CDN |
| `contracts/` | Signed talent contracts | legal and finance only |

Objects are encrypted with SSE-KMS using the media key, with S3 Bucket Keys enabled. Clients don't
send encryption headers; the bucket's default encryption applies.

## What the transcoder does

For each job it:

1. lists `uploads/` (ListObjectsV2 with `Prefix=uploads/`, paginated) to find sources it has not
   processed yet;
2. downloads the source object;
3. uploads one rendition per profile to `renditions/<video-id>/<profile>.mp4`. Renditions over 64 MB
   go up as multipart uploads, and a failed multipart upload is aborted. Re-running a job overwrites
   the renditions it wrote before.

It never deletes anything and never touches other prefixes or buckets.

## Working locally

```sh
python3 scripts/bootstrap.py            # pinned Terraform into .tools/, moto, terraform init
.tools/terraform fmt -check
.tools/terraform validate
.tools/venv/bin/python scripts/smoke.py # apply against a local moto emulator (no AWS access)
```

CI runs `terraform plan` on pull requests and `terraform apply` after merge to main.
