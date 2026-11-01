data "aws_iam_policy_document" "orders_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "orders_task" {
  name               = "orders-${var.environment}-task"
  assume_role_policy = data.aws_iam_policy_document.orders_task_assume.json
}

data "aws_iam_policy_document" "orders_task" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.orders_db.arn]
  }
}

resource "aws_iam_role_policy" "orders_task" {
  name   = "read-db-secret"
  role   = aws_iam_role.orders_task.id
  policy = data.aws_iam_policy_document.orders_task.json
}
