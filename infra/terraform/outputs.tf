output "app_url" {
  description = "Where staff sign in"
  value       = local.domain_enabled ? "https://${var.app_hostname}" : "https://${aws_cloudfront_distribution.spa.domain_name}"
}

output "api_url" {
  value = local.domain_enabled ? "https://${var.api_hostname}" : "http://${aws_lb.main.dns_name}"
}

output "alb_dns_name" {
  description = "API endpoint (put behind Route53/your DNS)"
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  description = "SPA URL"
  value       = aws_cloudfront_distribution.spa.domain_name
}

output "cloudfront_distribution_id" {
  description = "For cache invalidation on deploys"
  value       = aws_cloudfront_distribution.spa.id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  description = "Run this task before each release"
  value       = aws_ecs_task_definition.migrate.family
}

output "spa_bucket" {
  value = aws_s3_bucket.spa.bucket
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_hosted_domain" {
  description = "Hosted UI base: https://<this>.auth.<region>.amazoncognito.com"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "anthropic_api_key_secret" {
  description = "Set the real key: aws secretsmanager put-secret-value --secret-id <this>"
  value       = aws_secretsmanager_secret.llm["anthropic-api-key"].name
}

output "openai_api_key_secret" {
  value = aws_secretsmanager_secret.llm["openai-api-key"].name
}

output "deepseek_api_key_secret" {
  value = aws_secretsmanager_secret.llm["deepseek-api-key"].name
}

output "public_subnet_ids" {
  description = "For the migration run-task network configuration"
  value       = aws_subnet.public[*].id
}

output "api_security_group_id" {
  description = "For the migration run-task network configuration"
  value       = aws_security_group.api.id
}
