# Secrets live in Secrets Manager only — never in the repo, task
# definitions show ARNs, not values (docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md §6).

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.name_prefix}/${var.environment}/database-url"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
}

# Created with a placeholder; set the real key out-of-band:
#   aws secretsmanager put-secret-value \
#     --secret-id <name> --secret-string 'sk-ant-...'
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name = "${var.name_prefix}/${var.environment}/anthropic-api-key"
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = "REPLACE_ME"
  lifecycle {
    ignore_changes = [secret_string] # real value is set manually, never by terraform
  }
}
