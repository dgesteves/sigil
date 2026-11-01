provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Service   = "orders"
      ManagedBy = "terraform"
    }
  }
}
