terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state: uncomment and point at a state bucket before team use.
  # backend "s3" {
  #   bucket         = "msfg-terraform-state"
  #   key            = "agentic-dashboard/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "agentic-dashboard"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront certificates must live in us-east-1 regardless of var.aws_region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "agentic-dashboard"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
