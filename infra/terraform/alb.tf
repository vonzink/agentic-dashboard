resource "aws_lb" "main" {
  name               = "${var.name_prefix}-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name_prefix}-${var.environment}-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/ai/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
}

# HTTPS when a cert is supplied; HTTP-only bootstrap otherwise (dev only).
resource "aws_lb_listener" "main" {
  load_balancer_arn = aws_lb.main.arn
  port              = local.alb_certificate_arn != "" ? 443 : 80
  protocol          = local.alb_certificate_arn != "" ? "HTTPS" : "HTTP"
  ssl_policy        = local.alb_certificate_arn != "" ? "ELBSecurityPolicy-TLS13-1-2-2021-06" : null
  certificate_arn   = local.alb_certificate_arn != "" ? local.alb_certificate_arn : null

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# When TLS is on, bounce port 80 to 443.
resource "aws_lb_listener" "http_redirect" {
  count             = local.alb_certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
