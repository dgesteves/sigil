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

# Copied from the prototype account.
resource "aws_iam_role_policy" "transcoder" {
  name = "transcoder"
  role = aws_iam_role.transcoder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:*", "kms:*"]
        Resource = "*"
      },
    ]
  })
}
