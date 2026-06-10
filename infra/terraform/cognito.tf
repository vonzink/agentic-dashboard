resource "aws_cognito_user_pool" "main" {
  name = "${var.name_prefix}-${var.environment}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  admin_create_user_config {
    # Internal tool: admins invite staff; no self-signup.
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# SPA client: PKCE code flow, no client secret.
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.cognito_callback_urls
  logout_urls                          = var.cognito_logout_urls

  access_token_validity  = 1  # hours
  id_token_validity      = 1  # hours
  refresh_token_validity = 12 # hours — re-auth at least daily

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "hours"
  }

  prevent_user_existence_errors = "ENABLED"
}

# Group names match the API role hierarchy exactly (middleware/cognito.ts).
resource "aws_cognito_user_group" "roles" {
  for_each = {
    viewer   = "Read-only access"
    operator = "Create tasks, run workflows, propose actions"
    reviewer = "Approve/reject/finalize AI outputs, execute approved actions"
    admin    = "Prompt and workflow administration"
  }
  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.main.id
}
