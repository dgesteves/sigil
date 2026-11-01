provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Service   = "media"
      ManagedBy = "terraform"
    }
  }
}
