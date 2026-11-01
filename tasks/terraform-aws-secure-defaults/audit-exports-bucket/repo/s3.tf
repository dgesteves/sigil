# Monthly customer statements, written by the statements job. Created in 2022.
resource "aws_s3_bucket" "statements" {
  bucket = "${local.name_prefix}-statements"

  versioning {
    enabled = true
  }
}

resource "aws_s3_bucket_acl" "statements" {
  bucket = aws_s3_bucket.statements.id
  acl    = "private"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "statements" {
  bucket = aws_s3_bucket.statements.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.statements.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "statements" {
  bucket = aws_s3_bucket.statements.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
