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

# El origen permitido para CORS.
#
# Con el PWA servido desde la misma distribución, el navegador ni siquiera
# consulta CORS: es una petición del mismo origen. Se configura de todas formas
# porque el default es `localhost:5173` —el de desarrollo del frontend— y dejar
# eso en producción sería una autorización para un origen que no debería estar
# ahí, aunque hoy nadie la use.
resource "aws_ssm_parameter" "cors_origin" {
  count = var.habilitar_escalado ? 0 : 1

  name  = "${local.prefijo_ssm}/API_CORS_ORIGIN"
  type  = "String"
  value = "https://${aws_cloudfront_distribution.api[0].domain_name}"
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
#
# ⚠️ Los nombres son EXACTAMENTE los que lee `apps/api/src/config.ts`.
#
# No lo eran: aquí se declaraban `ORACLE_FUSION_USER` y `ORACLE_FUSION_PASSWORD`
# mientras el código leía `ERP_USUARIO` y `ERP_PASSWORD`. Se podían cargar las
# credenciales del ERP siguiendo el README al pie de la letra, verlas llegar al
# `.env` de la instancia, y que la aplicación no las viera nunca. El adaptador
# de Oracle no se podía configurar por la vía documentada.
resource "aws_ssm_parameter" "proveedores" {
  for_each = toset([
    "DEEPGRAM_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "XAI_API_KEY",
    "ERP_BASE_URL",
    "ERP_USUARIO",
    "ERP_PASSWORD",
  ])

  name  = "${local.prefijo_ssm}/${each.key}"
  type  = "SecureString"
  value = "PENDIENTE-cargar-con-aws-ssm-put-parameter"

  lifecycle {
    ignore_changes = [value]
  }
}

# Qué proveedor usa cada cosa. **Explícito, no por omisión.**
#
# Antes ninguno existía en SSM, así que producción caía a los valores por
# defecto de `config.ts` sin que nadie lo hubiera decidido: el sistema corría en
# modo simulado y no había forma de saberlo mirando la infraestructura. Un
# default es una suposición; esto es una declaración.
#
# No son secretos —son nombres de proveedor—, así que van como `String` y se
# pueden leer sin descifrar, que es justo lo que se quiere para auditarlos.
#
# Para encender uno: cargar primero su credencial y luego cambiar aquí. Si se
# hace al revés, la API **no arranca** y lo dice (`exigirCredencial`), que es
# mejor que arrancar y fallar en cada llamada.
resource "aws_ssm_parameter" "conmutadores" {
  for_each = {
    # Reconocimiento de voz suelto. La ruta de Deepgram no tiene consumidor y
    # su credencial nunca se cargó.
    PROVEEDOR_VOZ = "simulado"

    # El agente conversacional. GEMINI_API_KEY sí es real y el puente de voz la
    # usa: esto declara lo que de verdad está pasando.
    PROVEEDOR_AGENTE_VOZ = "gemini"

    # Quién PRONUNCIA. Oír y hablar son proveedores distintos: escuchar sigue
    # siendo Gemini Live, hablar es Polly.
    #
    # La capa gratuita de Gemini da DIEZ síntesis al día por modelo y un conteo
    # real las agota en los primeros minutos. Polly no tiene ese techo, dice el
    # texto EXACTO —no es un modelo conversacional que elija qué decir— y no
    # necesita credencial: la instancia firma con su rol de IAM.
    PROVEEDOR_TTS = "polly"

    # El árbitro que ordena la evidencia del caso. `determinista` NO es un
    # apaño: ordena los conteos y formula las preguntas sin modelo, y nunca
    # recomienda una cifra. Se queda aquí hasta que haya una clave real de
    # OpenRouter — con el marcador, encenderlo daría síntesis vacías.
    PROVEEDOR_ARBITRAJE = "determinista"

    # El 10% que la gramática no resuelve. Hoy el proveedor está registrado y
    # ningún módulo lo inyecta, así que encenderlo no cambiaría nada.
    PROVEEDOR_INTERPRETACION = "simulado"

    # Oracle Fusion. El adaptador nunca se ha probado contra una instancia real
    # y no hay una a la que apuntar.
    PROVEEDOR_ERP = "simulado"
  }

  name  = "${local.prefijo_ssm}/${each.key}"
  type  = "String"
  value = each.value
}
