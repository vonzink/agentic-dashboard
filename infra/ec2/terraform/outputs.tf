output "app_url" {
  value = "https://${var.app_hostname}"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_domain" {
  description = "Use as COGNITO/VITE_COGNITO domain base"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "documents_bucket" {
  value = var.create_documents_bucket ? aws_s3_bucket.documents[0].bucket : null
}

output "documents_bucket_policy_arn" {
  description = "Attach to the EC2 instance role for S3 document storage/backups"
  value       = var.create_documents_bucket ? aws_iam_policy.documents_bucket[0].arn : null
}
