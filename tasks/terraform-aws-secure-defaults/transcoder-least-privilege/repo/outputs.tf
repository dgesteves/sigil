output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "transcoder_role_arn" {
  value = aws_iam_role.transcoder.arn
}
