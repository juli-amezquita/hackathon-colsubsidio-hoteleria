resource "aws_db_subnet_group" "principal" {
  name       = "${local.nombre}-db"
  subnet_ids = aws_subnet.privada[*].id
}

resource "random_password" "postgres" {
  length  = 32
  special = false # evita escapes al pasarla por cadena de conexión
}

# --------------------------------------------------------------------------
# PostgreSQL 17 (D-13)
#
# El modelo es append-only: las tablas del libro tienen UPDATE y DELETE
# REVOCADOS para app_role (migración 0004). La inmutabilidad vive aquí, en el
# motor, no en la capa de aplicación — para que un UPDATE por descuido falle
# en producción y no en la revisión de código.
# --------------------------------------------------------------------------
resource "aws_db_instance" "postgres" {
  identifier     = "${local.nombre}-postgres"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.clase_rds

  db_name  = "cci"
  username = "cci_admin"
  password = random_password.postgres.result
  port     = 5432

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.principal.name
  vpc_security_group_ids = [aws_security_group.datos.id]
  publicly_accessible    = false

  # El libro ES el registro de auditoría del inventario. Perderlo no es un
  # incidente de disponibilidad, es la pérdida de la evidencia.
  backup_retention_period   = var.entorno == "produccion" ? 30 : 7
  backup_window             = "07:00-08:00" # 02:00-03:00 hora de Colombia
  copy_tags_to_snapshot     = true
  deletion_protection       = var.entorno == "produccion"
  skip_final_snapshot       = var.entorno != "produccion"
  final_snapshot_identifier = var.entorno == "produccion" ? "${local.nombre}-final" : null

  multi_az                     = var.entorno == "produccion"
  performance_insights_enabled = var.entorno == "produccion"
  auto_minor_version_upgrade   = true

  # pg_trgm y pgcrypto los habilita la migración 0001, no un parámetro.
  parameter_group_name = aws_db_parameter_group.postgres.name

  tags = { Name = "${local.nombre}-postgres" }
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.nombre}-pg17"
  family = "postgres17"

  # Deja rastro de las consultas lentas; sin esto, "la API se puso lenta" no
  # se puede atribuir a nada (Principio VII).
  parameter {
    name  = "log_min_duration_statement"
    value = "200"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --------------------------------------------------------------------------
# Redis (D-18) — caché de aplicación, NUNCA memoria del proceso
#
# Con varias réplicas, una caché en memoria daría a cada una una versión
# distinta de la tolerancia vigente. Eso rompe el despliegue stateless.
#
# El saldo esperado se cachea AQUÍ, en el servidor, y jamás se sirve al
# cliente del Operador (FR-1.18).
# --------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "principal" {
  name       = "${local.nombre}-redis"
  subnet_ids = aws_subnet.privada[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.nombre}-redis"
  description          = "Cache de catalogo, saldos y tolerancias vigentes"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.nodo_redis
  port           = 6379

  num_cache_clusters         = var.entorno == "produccion" ? 2 : 1
  automatic_failover_enabled = var.entorno == "produccion"

  subnet_group_name  = aws_elasticache_subnet_group.principal.name
  security_group_ids = [aws_security_group.datos.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # Si Redis se cae, la API degrada a Postgres y el operario sigue contando
  # (Restricción 5). Por eso no se replica en el MVP.
  snapshot_retention_limit = var.entorno == "produccion" ? 5 : 0

  tags = { Name = "${local.nombre}-redis" }
}
