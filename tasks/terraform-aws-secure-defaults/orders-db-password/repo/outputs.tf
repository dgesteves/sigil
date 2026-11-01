output "db_address" {
  value = aws_db_instance.orders.address
}

output "db_secret_arn" {
  value = aws_secretsmanager_secret.orders_db.arn
}
