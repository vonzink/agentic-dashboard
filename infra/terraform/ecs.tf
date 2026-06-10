resource "aws_ecr_repository" "api" {
  name                 = "${var.name_prefix}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name_prefix}-${var.environment}-api"
  retention_in_days = 90
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "disabled" # enable when worth the cost
  }
}

locals {
  api_environment = [
    { name = "APP_ENV", value = "production" },
    { name = "PORT", value = "4000" },
    { name = "AUTH_MODE", value = "cognito" },
    { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.main.id },
    { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.spa.id },
    { name = "COGNITO_REGION", value = var.aws_region },
    { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
    { name = "MODEL_PROVIDER", value = var.model_provider },
    { name = "REQUIRE_DIFFERENT_REVIEWER", value = tostring(var.require_different_reviewer) },
    { name = "INTEGRATION_EXECUTION_ENABLED", value = "false" }, # propose-only until adapters ship
  ]
  api_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
    { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.llm["anthropic-api-key"].arn },
    { name = "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.llm["openai-api-key"].arn },
    { name = "DEEPSEEK_API_KEY", valueFrom = aws_secretsmanager_secret.llm["deepseek-api-key"].arn },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential    = true
      portMappings = [{ containerPort = 4000, protocol = "tcp" }]
      environment  = local.api_environment
      secrets      = local.api_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

# One-off migration runner: same image, different command.
# Run before each release:
#   aws ecs run-task --cluster <cluster> --task-definition <this> \
#     --launch-type FARGATE --network-configuration '...'   (see infra/README.md)
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-${var.environment}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name        = "migrate"
      image       = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential   = true
      command     = ["node", "dist/db/migrate.js"]
      environment = [{ name = "APP_ENV", value = "production" }]
      secrets     = local.api_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "migrate"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true # public subnet without NAT; SG restricts ingress to the ALB
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }

  # Keep serving during deploys; wait for green before draining.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.main]
}
