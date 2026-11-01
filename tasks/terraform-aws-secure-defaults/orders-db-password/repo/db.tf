resource "random_id" "final_snapshot" {
  byte_length = 4
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

  db_name  = "orders"
  username = "orders_admin"
  password = var.db_master_password

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = var.db_security_group_ids
  multi_az               = true

  backup_retention_period   = 14
  deletion_protection       = true
  final_snapshot_identifier = "orders-${var.environment}-final-${random_id.final_snapshot.hex}"
}
