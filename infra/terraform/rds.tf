resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "db" {
  length  = 32
  special = false # keeps the DATABASE_URL un-escaped
}

resource "aws_db_instance" "main" {
  identifier        = "${var.name_prefix}-${var.environment}"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "agentic_dashboard"
  username = "agentic"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period   = 7
  deletion_protection       = var.environment == "prod"
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.name_prefix}-final" : null

  # Audit/approval data lives here — never auto-upgrade majors silently.
  allow_major_version_upgrade = false
  auto_minor_version_upgrade  = true
}
