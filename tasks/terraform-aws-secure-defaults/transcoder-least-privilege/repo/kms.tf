resource "aws_kms_key" "media" {
  description             = "Encrypts the media bucket"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "media" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.media.key_id
}
