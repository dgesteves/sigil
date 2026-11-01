data "aws_iam_policy_document" "transcoder_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Task role of the transcoder ECS service (the service itself lives in the ecs-services repo).
resource "aws_iam_role" "transcoder" {
  name               = "${local.name_prefix}-transcoder"
  assume_role_policy = data.aws_iam_policy_document.transcoder_assume.json
}

data "aws_iam_policy_document" "transcoder" {
  # ListObjectsV2 is authorised as s3:ListBucket on the bucket ARN; s3:prefix limits what it lists.
  statement {
    sid       = "ListUploads"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["uploads/*"]
    }
  }

  statement {
    sid       = "ReadUploads"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/uploads/*"]
  }

  # PutObject covers CreateMultipartUpload, UploadPart and CompleteMultipartUpload.
  statement {
    sid       = "WriteRenditions"
    actions   = ["s3:PutObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.media.arn}/renditions/*"]
  }

  # SSE-KMS: GetObject needs kms:Decrypt, PutObject needs kms:GenerateDataKey, multipart needs both.
  statement {
    sid       = "UseMediaKeyThroughS3"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.media.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "transcoder" {
  name   = "transcoder"
  role   = aws_iam_role.transcoder.id
  policy = data.aws_iam_policy_document.transcoder.json
}
