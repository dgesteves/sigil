resource "random_id" "final_snapshot" {
  byte_length = 4
}

# Generated during each plan and apply and never written to the plan or state. It only reaches AWS
# through write-only arguments, and only when db_password_version changes.
ephemeral "random_password" "orders_db" {
  length           = 40
  special          = true
  override_special = "!#$%^&*()-_=+[]{}<>:?" # RDS rejects / " and @
}

resource "aws_db_instance" "orders" {
  identifier     = "orders-${var.environment}"
  engine         = "postgres"
  engine_version = "17.6"
  instance_class = var.db_instance_class

  allocated_storage     = 100
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name             = "orders"
  username            = "orders_admin"
  password_wo         = ephemeral.random_password.orders_db.result
  password_wo_version = var.db_password_version

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = var.db_security_group_ids
  multi_az               = true

  backup_retention_period   = 14
  deletion_protection       = true
  final_snapshot_identifier = "orders-${var.environment}-final-${random_id.final_snapshot.hex}"
}
