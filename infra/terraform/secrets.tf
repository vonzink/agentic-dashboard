# Secrets live in Secrets Manager only — never in the repo, task
# definitions show ARNs, not values (docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md §6).

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.name_prefix}/${var.environment}/database-url"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
}

# LLM provider keys (Claude / ChatGPT / DeepSeek). Each is created with a
# placeholder; set the real value out-of-band for whichever you use:
#   aws secretsmanager put-secret-value --secret-id <name> --secret-string '<key>'
# Terraform never holds or overwrites the real values (ignore_changes).
locals {
  llm_secrets = ["anthropic-api-key", "openai-api-key", "deepseek-api-key"]
}

resource "aws_secretsmanager_secret" "llm" {
  for_each = toset(local.llm_secrets)
  name     = "${var.name_prefix}/${var.environment}/${each.key}"
}

resource "aws_secretsmanager_secret_version" "llm" {
  for_each      = aws_secretsmanager_secret.llm
  secret_id     = each.value.id
  secret_string = "REPLACE_ME"
  lifecycle {
    ignore_changes = [secret_string] # real values are set manually, never by terraform
  }
}
