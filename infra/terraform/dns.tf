# Custom domain on the existing Route 53 zone (zvzsolutions.com).
# App:  https://<app_hostname>      → CloudFront (SPA + /api/* behavior)
# API:  https://<api_hostname>      → ALB directly (also CloudFront's origin)
# Set route53_zone_name = "" to disable all of this (bare CloudFront/ALB).

locals {
  domain_enabled = var.route53_zone_name != ""
}

data "aws_route53_zone" "main" {
  count = local.domain_enabled ? 1 : 0
  name  = var.route53_zone_name
}

# ---- certificates -------------------------------------------------------------
# CloudFront requires its certificate in us-east-1; the ALB cert is regional.

resource "aws_acm_certificate" "app" {
  count             = local.domain_enabled ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.app_hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "api" {
  count             = local.domain_enabled ? 1 : 0
  domain_name       = var.api_hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "app_cert_validation" {
  for_each = {
    for dvo in(local.domain_enabled ? aws_acm_certificate.app[0].domain_validation_options : []) :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 300
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in(local.domain_enabled ? aws_acm_certificate.api[0].domain_validation_options : []) :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "app" {
  count                   = local.domain_enabled ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for r in aws_route53_record.app_cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "api" {
  count                   = local.domain_enabled ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

# Effective ALB cert: the validated api cert, or a manually supplied ARN.
locals {
  alb_certificate_arn = local.domain_enabled ? aws_acm_certificate_validation.api[0].certificate_arn : var.acm_certificate_arn
}

# ---- records -------------------------------------------------------------------

resource "aws_route53_record" "app" {
  count   = local.domain_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = var.app_hostname
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.spa.domain_name
    zone_id                = aws_cloudfront_distribution.spa.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  count   = local.domain_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = var.api_hostname
  type    = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
