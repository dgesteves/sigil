variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "db_instance_class" {
  type    = string
  default = "db.r7g.large"
}

# Owned by the network stack.
variable "db_subnet_group_name" {
  type    = string
  default = "orders-prod-db"
}

variable "db_security_group_ids" {
  type    = list(string)
  default = ["sg-0a1b2c3d4e5f60718"]
}

# Bump to rotate the master password: RDS and orders/db both get a new one in the same apply.
variable "db_password_version" {
  type    = number
  default = 1
}
