# Monthly audit exports. New buckets have ACLs disabled and Block Public Access on by default
# (since April 2023); everything is still declared here so drift is detected and reverted.

resource "aws_kms_key" "audit_exports" {
  description             = "Encrypts the audit exports bucket"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "audit_exports" {
  name          = "alias/${local.name_prefix}-audit-exports"
  target_key_id = aws_kms_key.audit_exports.key_id
}

resource "aws_s3_bucket" "audit_exports" {
  bucket = "${local.name_prefix}-audit-exports"
}

resource "aws_s3_bucket_ownership_controls" "audit_exports" {
  bucket = aws_s3_bucket.audit_exports.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "audit_exports" {
  bucket = aws_s3_bucket.audit_exports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "audit_exports" {
  bucket = aws_s3_bucket.audit_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_exports" {
  bucket = aws_s3_bucket.audit_exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.audit_exports.arn
    }
    bucket_key_enabled = true
  }
}

data "aws_iam_policy_document" "audit_exports" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.audit_exports.arn,
      "${aws_s3_bucket.audit_exports.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit_exports" {
  bucket = aws_s3_bucket.audit_exports.id
  policy = data.aws_iam_policy_document.audit_exports.json

  depends_on = [aws_s3_bucket_public_access_block.audit_exports]
}
