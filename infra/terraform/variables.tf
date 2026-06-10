variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev | staging | prod)"
  type        = string
  default     = "dev"
}

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "agentic-dashboard"
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach the ALB. Internal tool: restrict to office/VPN ranges before go-live."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the ALB HTTPS listener. Empty = HTTP-only bootstrap mode (dev only; never run prod without TLS)."
  type        = string
  default     = ""
}

variable "api_image_tag" {
  description = "Image tag in the ECR repo to deploy"
  type        = string
  default     = "latest"
}

variable "api_cpu" {
  description = "Fargate CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Fargate memory (MiB)"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Number of API tasks"
  type        = number
  default     = 1
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Multi-AZ RDS (enable for prod)"
  type        = bool
  default     = false
}

variable "cognito_callback_urls" {
  description = "Allowed OAuth callback URLs for the SPA (CloudFront URL + http://localhost:5173 for dev)"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "cognito_logout_urls" {
  description = "Allowed logout redirect URLs for the SPA"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "cognito_domain_prefix" {
  description = "Globally-unique Cognito hosted-UI domain prefix (e.g. msfg-agentic-dev)"
  type        = string
  default     = "msfg-agentic-dev"
}

variable "model_provider" {
  description = "API model provider: mock (no spend) or anthropic (requires the API-key secret to be set)"
  type        = string
  default     = "mock"
}

variable "require_different_reviewer" {
  description = "Forbid reviewing your own AI runs (keep true outside dev)"
  type        = bool
  default     = true
}
