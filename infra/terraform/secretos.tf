# --------------------------------------------------------------------------
# SSM Parameter Store — secretos y configuración
#
# Nunca en el repositorio, nunca en un .env commiteado (Principio V).
# Los valores de proveedores externos se cargan APARTE, con la CLI, para que
# ni siquiera pasen por el estado de Terraform:
#
#   aws ssm put-parameter --name /cci/mvp/DEEPGRAM_API_KEY \
#     --type SecureString --value '...' --overwrite
# --------------------------------------------------------------------------

locals {
  prefijo_ssm = "/${var.nombre}/${var.entorno}"
}

resource "random_password" "sesion" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "database_url" {
  name  = "${local.prefijo_ssm}/DATABASE_URL"
  type  = "SecureString"
  value = "postgres://${aws_db_instance.postgres.username}:${random_password.postgres.result}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}"
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "${local.prefijo_ssm}/REDIS_URL"
  type  = "SecureString"
  value = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}

resource "aws_ssm_parameter" "session_secret" {
  name  = "${local.prefijo_ssm}/SESSION_SECRET"
  type  = "SecureString"
  value = random_password.sesion.result
}

resource "aws_ssm_parameter" "bucket_evidencia" {
  name  = "${local.prefijo_ssm}/BUCKET_EVIDENCIA"
  type  = "String"
  value = aws_s3_bucket.evidencia.bucket
}

# Versión desplegada. La escribe el script de despliegue, no Terraform: cambiar
# de versión no debe exigir un `apply` ni tocar la infraestructura.
resource "aws_ssm_parameter" "imagen_api" {
  name  = "${local.prefijo_ssm}/IMAGEN_API"
  type  = "String"
  value = "PENDIENTE"

  lifecycle {
    ignore_changes = [value]
  }
}

# Marcadores para los proveedores externos. El valor real se carga con la CLI:
# así la credencial no queda en el estado de Terraform, que es un archivo más.
resource "aws_ssm_parameter" "proveedores" {
  for_each = toset([
    "DEEPGRAM_API_KEY",
    "OPENROUTER_API_KEY",
    "ORACLE_FUSION_USER",
    "ORACLE_FUSION_PASSWORD",
  ])

  name  = "${local.prefijo_ssm}/${each.key}"
  type  = "SecureString"
  value = "PENDIENTE-cargar-con-aws-ssm-put-parameter"

  lifecycle {
    ignore_changes = [value]
  }
}
