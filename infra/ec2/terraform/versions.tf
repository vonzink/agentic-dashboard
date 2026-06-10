terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "agentic-dashboard"
      Environment = var.environment
      ManagedBy   = "terraform"
      Track       = "ec2"
    }
  }
}
