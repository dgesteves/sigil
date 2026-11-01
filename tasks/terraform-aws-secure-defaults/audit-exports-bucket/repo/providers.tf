provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Service   = "ledger"
      ManagedBy = "terraform"
    }
  }
}
