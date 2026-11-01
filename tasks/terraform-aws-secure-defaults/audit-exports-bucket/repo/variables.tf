variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

locals {
  name_prefix = "acme-ledger-${var.environment}"
}
