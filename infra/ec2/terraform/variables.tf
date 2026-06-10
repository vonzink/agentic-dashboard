variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "route53_zone_name" {
  description = "Existing Route 53 hosted zone"
  type        = string
  default     = "zvzsolutions.com"
}

variable "app_hostname" {
  description = "The single hostname for the dashboard (Caddy serves SPA + /api on it)"
  type        = string
  default     = "agentic.zvzsolutions.com"
}

variable "ec2_public_ip" {
  description = "Public IP of the EC2 box running docker compose"
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Globally-unique Cognito hosted-UI domain prefix"
  type        = string
  default     = "zvz-agentic"
}

variable "create_documents_bucket" {
  description = "Optional S3 bucket for document storage/backups (documents default to the box's disk)"
  type        = bool
  default     = true
}
