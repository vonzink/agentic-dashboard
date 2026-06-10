# Cheapest deployment track: everything heavy runs on your existing EC2
# box via docker compose (see ../docker-compose.yml). AWS only provides
# the parts that are free or near-free: DNS, login, and optional S3.

data "aws_caller_identity" "current" {}

data "aws_route53_zone" "main" {
  name = var.route53_zone_name
}

# One record, one hostname: Caddy on the box serves the SPA and /api/*
# on the same origin and gets its own Let's Encrypt certificate.
resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.app_hostname
  type    = "A"
  ttl     = 300
  records = [var.ec2_public_ip]
}

# ---- Cognito (free at this scale) -------------------------------------------

resource "aws_cognito_user_pool" "main" {
  name = "agentic-dashboard-${var.environment}"

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

resource "aws_cognito_user_pool_client" "spa" {
  name         = "agentic-dashboard-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.app_hostname}", "http://localhost:5173"]
  logout_urls                          = ["https://${var.app_hostname}", "http://localhost:5173"]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 12

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "hours"
  }

  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user_group" "roles" {
  for_each = {
    viewer   = "Read-only access"
    operator = "Create tasks, run workflows, propose actions"
    reviewer = "Approve/reject/finalize AI outputs, execute approved actions"
    admin    = "Prompt, workflow, and company administration"
  }
  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.main.id
}

# ---- Optional S3 (documents and/or nightly DB backups) ------------------------

resource "aws_s3_bucket" "documents" {
  count  = var.create_documents_bucket ? 1 : 0
  bucket = "agentic-dashboard-${var.environment}-documents-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  count                   = var.create_documents_bucket ? 1 : 0
  bucket                  = aws_s3_bucket.documents[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  count  = var.create_documents_bucket ? 1 : 0
  bucket = aws_s3_bucket.documents[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  count  = var.create_documents_bucket ? 1 : 0
  bucket = aws_s3_bucket.documents[0].id
  rule {
    id     = "expire-old-db-backups"
    status = "Enabled"
    filter {
      prefix = "backups/"
    }
    expiration {
      days = 30
    }
  }
}

# Attach to the EC2 instance's IAM role to let the box reach the bucket
# (aws iam attach-role-policy --role-name <your-instance-role> --policy-arn <output>).
resource "aws_iam_policy" "documents_bucket" {
  count = var.create_documents_bucket ? 1 : 0
  name  = "agentic-dashboard-${var.environment}-documents-bucket"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.documents[0].arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.documents[0].arn
      },
    ]
  })
}
