resource "aws_kms_key" "statements" {
  description             = "Encrypts the customer statements bucket"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "statements" {
  name          = "alias/${local.name_prefix}-statements"
  target_key_id = aws_kms_key.statements.key_id
}
