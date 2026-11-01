# Read by the orders service at startup (see iam.tf). JSON keys: username, password, host, port, dbname.
resource "aws_secretsmanager_secret" "orders_db" {
  name                    = "orders/db"
  description             = "Connection settings for the orders database"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "orders_db" {
  secret_id = aws_secretsmanager_secret.orders_db.id

  # Same ephemeral value as the DB in the same run; written only when the version changes.
  secret_string_wo = jsonencode({
    username = aws_db_instance.orders.username
    password = ephemeral.random_password.orders_db.result
    host     = aws_db_instance.orders.address
    port     = aws_db_instance.orders.port
    dbname   = aws_db_instance.orders.db_name
  })
  secret_string_wo_version = var.db_password_version
}
